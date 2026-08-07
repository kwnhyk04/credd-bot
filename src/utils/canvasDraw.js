'use strict';

/**
 * canvasDraw.js — shared 2D-canvas drawing primitives (Phase 1.2 dedup).
 *
 * Bodies are moved VERBATIM from their duplicated copies (5× roundRect,
 * 6× roundRectPath, 4× fitText, 2× hpColor — all byte-identical before the
 * move). roundRect and roundRectPath trace the same rounded-rectangle path;
 * both names are kept so every consumer keeps its original call sites.
 */

function hpColor(p) {
  if (p > 0.5) return '#43d675';
  if (p > 0.25) return '#f0b232';
  return '#f23f43';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Trim text with an ellipsis so it fits within maxW at the current ctx.font. */
function fitText(ctx, text, maxW) {
  if (maxW <= 0 || ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

module.exports = { hpColor, roundRect, roundRectPath, fitText };
