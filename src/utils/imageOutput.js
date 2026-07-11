'use strict';

const sharp = require('sharp');
const { AttachmentBuilder } = require('discord.js');
const { assertDiscordImageAttachmentsAllowed } = require('./egressGuard');
const {
  envBool, envBoundedInt, performanceLog,
} = require('./runtimeLogs');
const { withImageWorkSlot } = require('./imageWorkQueue');

function requestedFormat() {
  const raw = String(process.env.IMAGE_OUTPUT_FORMAT || '').trim().toLowerCase();
  return raw === 'jpg' || raw === 'jpeg' ? 'jpeg' : 'webp';
}

function specificWebpQualityEnv(imageType, command) {
  const type = String(imageType || '').toLowerCase();
  const cmd = String(command || '').toLowerCase();
  if (cmd === 'raid' && type === 'battle_frame') return 'RAID_BATTLE_FRAME_WEBP_QUALITY';
  if (cmd === 'raid' && type === 'battle_result') return 'RAID_BATTLE_RESULT_WEBP_QUALITY';
  if (type === 'profile') return 'PROFILE_IMAGE_WEBP_QUALITY';
  if (type === 'stats') return 'STATS_IMAGE_WEBP_QUALITY';
  if (type === 'boss_status' || type === 'boss_banner' || type.startsWith('boss')) return 'BOSS_IMAGE_WEBP_QUALITY';
  return null;
}

function webpQuality(logContext = {}) {
  const envName = specificWebpQualityEnv(logContext.imageType || logContext.command, logContext.command);
  if (envName && envName.startsWith('RAID_')) {
    return { quality: envBoundedInt(envName, 68, 1, 100), envName };
  }
  if (envName && ['PROFILE_IMAGE_WEBP_QUALITY', 'STATS_IMAGE_WEBP_QUALITY', 'BOSS_IMAGE_WEBP_QUALITY'].includes(envName)) {
    return { quality: envBoundedInt(envName, 68, 1, 100), envName };
  }
  const fallback = envBoundedInt('IMAGE_WEBP_QUALITY', 65, 1, 100);
  if (!envName) return { quality: fallback, envName: 'IMAGE_WEBP_QUALITY' };
  return { quality: envBoundedInt(envName, fallback, 1, 100), envName };
}

function aggressiveCompression() {
  return envBool('IMAGE_COMPRESSION_AGGRESSIVE', false);
}

function extensionFromName(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : 'png';
}

function imageContentType(name) {
  const ext = extensionFromName(name);
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'image/png';
}

function imageResult(buffer, baseName, ext, optimized) {
  return { buffer, name: `${baseName}.${ext}`, optimized, format: ext === 'jpg' ? 'jpeg' : ext };
}

function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  if (buffer.length >= 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 8
      && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buffer.length >= 3
      && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  return null;
}

function validateGeneratedImageBuffer(buffer, logContext = {}, expectedFormat = null) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Generated image output must be a Buffer.');
  if (buffer.length === 0) throw new Error('Generated image output is empty or already disposed.');
  const format = detectImageFormat(buffer);
  if (!format) throw new Error('Generated image output has an unsupported or invalid signature.');
  const expected = expectedFormat === 'jpg' ? 'jpeg' : expectedFormat;
  if (expected && format !== expected) {
    throw new Error(`Generated image format mismatch: expected ${expected}, detected ${format}.`);
  }
  performanceLog('generated image buffer validated', {
    ...logContext,
    bytes: buffer.length,
    format,
  });
  return format;
}

async function optimizeOpaqueAttachment(buffer, baseName, {
  quality = 85,
  background = '#1f2125',
  minSavings = 0.05,
  maxWidth = 0, // >0: downscale to this width before encoding (egress cap; owner-approved for battle frames)
  preserveTransparency = false,
  allowWebp = true,
  skipQueue = false,
  logContext = {},
} = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Generated image output must be a Buffer.');
  if (buffer.length === 0) throw new Error('Generated image output is empty or already disposed.');
  const input = buffer;
  const run = async () => {
    const image = await optimizeImageBuffer(input, baseName, {
      quality,
      background,
      minSavings,
      maxWidth,
      preserveTransparency,
      allowWebp,
      logContext,
    });
    validateGeneratedImageBuffer(image.buffer, logContext, extensionFromName(image.name));
    return image;
  };
  if (skipQueue) return run();
  return withImageWorkSlot(logContext.imageType || baseName, run, logContext);
}

async function optimizeImageBuffer(input, baseName, {
  quality,
  background,
  minSavings,
  maxWidth,
  preserveTransparency,
  allowWebp,
  logContext,
}) {
  const started = Date.now();
  const originalBytes = input.length;
  const aggressive = aggressiveCompression();
  const resize = (pipe) => (maxWidth > 0
    ? pipe.resize({ width: maxWidth, withoutEnlargement: true })
    : pipe);

  if (requestedFormat() === 'webp' && allowWebp) {
    try {
      const webp = webpQuality(logContext);
      let pipe = resize(sharp(input));
      if (!preserveTransparency) pipe = pipe.flatten({ background });
      const webpBuffer = await pipe
        .webp({
          quality: webp.quality,
          effort: aggressive ? 6 : 5,
          smartSubsample: true,
        })
        .toBuffer();
      const result = imageResult(webpBuffer, baseName, 'webp', true);
      performanceLog('image optimized', {
        ...logContext,
        imageType: logContext.imageType || baseName,
        originalBytes,
        optimizedBytes: webpBuffer.length,
        format: 'webp',
        quality: webp.quality,
        envName: webp.envName,
        durationMs: Date.now() - started,
      });
      return result;
    } catch {
      // Fall through to JPEG/PNG fallback.
    }
  }

  if (preserveTransparency) {
    try {
      const png = await resize(sharp(input))
        .png({
          compressionLevel: aggressive ? 9 : 8,
          adaptiveFiltering: true,
          palette: aggressive,
        })
        .toBuffer();
      const result = png.length < input.length ? imageResult(png, baseName, 'png', true) : imageResult(input, baseName, 'png', false);
      performanceLog('image optimized', {
        ...logContext,
        imageType: logContext.imageType || baseName,
        originalBytes,
        optimizedBytes: result.buffer.length,
        format: 'png',
        durationMs: Date.now() - started,
      });
      return result;
    } catch {
      performanceLog('image optimized', {
        ...logContext,
        imageType: logContext.imageType || baseName,
        originalBytes,
        optimizedBytes: input.length,
        format: 'png',
        durationMs: Date.now() - started,
      });
      return imageResult(input, baseName, 'png', false);
    }
  }

  try {
    let pipe = sharp(input);
    if (maxWidth > 0) pipe = pipe.resize({ width: maxWidth, withoutEnlargement: true });
    const jpegQuality = aggressive ? Math.min(quality, 80) : quality;
    const jpeg = await pipe
      .flatten({ background })
      .jpeg({
        quality: jpegQuality,
        mozjpeg: true,
        progressive: aggressive,
      })
      .toBuffer();
    if (jpeg.length < input.length * (1 - minSavings)) {
      const result = imageResult(jpeg, baseName, 'jpg', true);
      performanceLog('image optimized', {
        ...logContext,
        imageType: logContext.imageType || baseName,
        originalBytes,
        optimizedBytes: jpeg.length,
        format: 'jpeg',
        durationMs: Date.now() - started,
      });
      return result;
    }
  } catch {
    // Keep the original PNG if sharp cannot decode or encode the image.
  }
  performanceLog('image optimized', {
    ...logContext,
    imageType: logContext.imageType || baseName,
    originalBytes,
    optimizedBytes: input.length,
    format: 'png',
    durationMs: Date.now() - started,
  });
  return imageResult(input, baseName, 'png', false);
}

function attachmentFromOptimizedImage(image, baseName, logContext = {}) {
  if (!image || typeof image !== 'object') throw new TypeError('Generated image result is missing.');
  const ext = extensionFromName(image.name);
  const name = `${baseName}.${ext}`;
  const format = validateGeneratedImageBuffer(image.buffer, logContext, ext);
  assertDiscordImageAttachmentsAllowed(`${baseName} attachment fallback`, {
    ...logContext,
    imageType: logContext.imageType || baseName,
    bytes: image.buffer.length,
    format,
  });
  performanceLog('image output bytes', {
    ...logContext,
    imageType: logContext.imageType || baseName,
    bytes: image.buffer.length,
  });
  return {
    ...image,
    name,
    url: `attachment://${name}`,
    file: new AttachmentBuilder(image.buffer, { name }),
  };
}

async function makeOptimizedAttachment(buffer, baseName, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Generated image output must be a Buffer.');
  const input = buffer;
  const logContext = options.logContext || {};
  assertDiscordImageAttachmentsAllowed(`${baseName} attachment fallback`, {
    ...logContext,
    imageType: logContext.imageType || baseName,
    bytes: input.length,
  });
  const image = await optimizeOpaqueAttachment(input, baseName, options);
  const format = validateGeneratedImageBuffer(image.buffer, logContext, extensionFromName(image.name));
  performanceLog('image output bytes', {
    ...logContext,
    imageType: logContext.imageType || baseName,
    bytes: image.buffer.length,
    format,
  });
  return {
    ...image,
    url: `attachment://${image.name}`,
    file: new AttachmentBuilder(image.buffer, { name: image.name }),
  };
}

async function renderOptimizedAttachment(render, baseName, options = {}) {
  const logContext = options.logContext || {};
  const image = await withImageWorkSlot(logContext.imageType || baseName, async () => {
    const buffer = await render();
    return optimizeOpaqueAttachment(buffer, baseName, { ...options, skipQueue: true });
  }, logContext);
  return attachmentFromOptimizedImage(image, baseName, logContext);
}

module.exports = {
  optimizeOpaqueAttachment,
  makeOptimizedAttachment,
  renderOptimizedAttachment,
  attachmentFromOptimizedImage,
  imageContentType,
  extensionFromName,
  detectImageFormat,
  validateGeneratedImageBuffer,
};
