'use strict';

const sharp = require('sharp');
const { AttachmentBuilder } = require('discord.js');
const { assertDiscordImageAttachmentsAllowed } = require('./egressGuard');

async function optimizeOpaqueAttachment(buffer, baseName, {
  quality = 85,
  background = '#1f2125',
  minSavings = 0.05,
  maxWidth = 0, // >0: downscale to this width before encoding (egress cap; owner-approved for battle frames)
} = {}) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  try {
    let pipe = sharp(input);
    if (maxWidth > 0) pipe = pipe.resize({ width: maxWidth, withoutEnlargement: true });
    const jpeg = await pipe
      .flatten({ background })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (jpeg.length < input.length * (1 - minSavings)) {
      return { buffer: jpeg, name: `${baseName}.jpg`, optimized: true };
    }
  } catch {
    // Keep the original PNG if sharp cannot decode or encode the image.
  }
  return { buffer: input, name: `${baseName}.png`, optimized: false };
}

async function makeOptimizedAttachment(buffer, baseName, options) {
  assertDiscordImageAttachmentsAllowed(`${baseName} attachment fallback`);
  const image = await optimizeOpaqueAttachment(buffer, baseName, options);
  return {
    ...image,
    url: `attachment://${image.name}`,
    file: new AttachmentBuilder(image.buffer, { name: image.name }),
  };
}

module.exports = { optimizeOpaqueAttachment, makeOptimizedAttachment };
