'use strict';

function containRect(image, box) {
  const boxW = box.w || box.width || box.size;
  const boxH = box.h || box.height || box.size;
  if (!image || !boxW || !boxH) return { x: box.x, y: box.y, w: boxW, h: boxH };
  const scale = Math.min(boxW / image.width, boxH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return {
    x: box.x + (boxW - w) / 2,
    y: box.y + (boxH - h) / 2,
    w,
    h,
  };
}

function badgeRect(image, { x, titleY, hasTitle, fallbackY, height, gap = 36 }) {
  const h = height;
  const w = Math.round(image.width * (h / image.height));
  const y = hasTitle ? titleY + gap : fallbackY;
  return { x: Math.round(x - w / 2), y: Math.round(y), w, h };
}

module.exports = { containRect, badgeRect };
