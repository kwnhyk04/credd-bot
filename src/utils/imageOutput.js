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
  return raw === 'webp' ? 'webp' : 'auto';
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
    return { quality: envBoundedInt(envName, 42, 1, 100), envName };
  }
  if (envName && ['PROFILE_IMAGE_WEBP_QUALITY', 'STATS_IMAGE_WEBP_QUALITY', 'BOSS_IMAGE_WEBP_QUALITY'].includes(envName)) {
    return { quality: envBoundedInt(envName, 50, 1, 100), envName };
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
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const run = () => optimizeImageBuffer(input, baseName, {
    quality,
    background,
    minSavings,
    maxWidth,
    preserveTransparency,
    allowWebp,
    logContext,
  });
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
          effort: aggressive ? 6 : 4,
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
  const ext = extensionFromName(image.name);
  const name = `${baseName}.${ext}`;
  assertDiscordImageAttachmentsAllowed(`${baseName} attachment fallback`, {
    ...logContext,
    imageType: logContext.imageType || baseName,
    bytes: image.buffer.length,
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
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const logContext = options.logContext || {};
  assertDiscordImageAttachmentsAllowed(`${baseName} attachment fallback`, {
    ...logContext,
    imageType: logContext.imageType || baseName,
    bytes: input.length,
  });
  const image = await optimizeOpaqueAttachment(input, baseName, options);
  performanceLog('image output bytes', {
    ...logContext,
    imageType: logContext.imageType || baseName,
    bytes: image.buffer.length,
  });
  return {
    ...image,
    url: `attachment://${image.name}`,
    file: new AttachmentBuilder(image.buffer, { name: image.name }),
  };
}

module.exports = {
  optimizeOpaqueAttachment,
  makeOptimizedAttachment,
  attachmentFromOptimizedImage,
  imageContentType,
  extensionFromName,
};
