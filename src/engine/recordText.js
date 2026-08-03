'use strict';

const { familyList } = require('../utils/fontRegistry');

const RECORD_LABELS = Object.freeze([
  'BEST RAID STK',
  'RAID STREAK',
  'RANK STREAK',
  'GLOBAL RANK #',
  'WIN RATE',
  'RANK',
]);

function resolvedFamily(font) {
  const value = String(font || 'DejaVu Sans');
  return value.includes(',') || value.startsWith('"') ? value : familyList(value);
}

function fontString(style, size, kind) {
  const weight = style[`${kind}_weight`] === 'bold' ? 'bold ' : '';
  return `${weight}${size}px ${resolvedFamily(style[`${kind}_font`])}`;
}

function recordValues(values) {
  if (Array.isArray(values)) return values.map((value) => value == null ? '-' : String(value));
  return RECORD_LABELS.map((_, index) => values?.[index] == null ? '-' : String(values[index]));
}

/**
 * Find one shared value size for the complete six-cell row. A half-pixel step
 * is intentional: the narrow fallback settles at 12.5px for Ascendant.
 */
function fitRecordValueSize(ctx, style, values) {
  const texts = recordValues(values);
  const minSize = Number(style.min_value_size ?? 12);
  const innerPadding = Number(style.value_inner_padding ?? 6);
  const innerWidth = Math.max(0, Number(style.box_w) - innerPadding * 2);
  let size = Number(style.value_size);
  if (!Number.isFinite(size) || size <= 0) throw new TypeError('record value_size must be positive');

  while (size > minSize) {
    ctx.font = fontString(style, size, 'value');
    if (texts.every((text) => ctx.measureText(text).width <= innerWidth)) return size;
    size = Math.max(minSize, size - 0.5);
  }

  ctx.font = fontString(style, minSize, 'value');
  const overflow = texts.find((text) => ctx.measureText(text).width > innerWidth);
  if (overflow != null) {
    const error = new RangeError(
      `record value ${JSON.stringify(overflow)} cannot fit at ${minSize}px in a ${innerWidth}px cell`
    );
    error.code = 'RECORD_VALUE_OVERFLOW';
    throw error;
  }
  return minSize;
}

/**
 * Draw the six record boxes without changing their authored geometry. Labels
 * use the configured size; values share the smallest size required by the row.
 */
function drawRecordRow(ctx, style, values) {
  const texts = recordValues(values);
  const valueSize = fitRecordValueSize(ctx, style, texts);
  const labelY = Number(style.label_y ?? 18);
  const valueY = Number(style.value_y ?? 40);

  for (let index = 0; index < style.cols.length; index += 1) {
    const col = style.cols[index];
    const x = col.x - style.box_w / 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + style.radius, style.y);
    ctx.arcTo(x + style.box_w, style.y, x + style.box_w, style.y + style.box_h, style.radius);
    ctx.arcTo(x + style.box_w, style.y + style.box_h, x, style.y + style.box_h, style.radius);
    ctx.arcTo(x, style.y + style.box_h, x, style.y, style.radius);
    ctx.arcTo(x, style.y, x + style.box_w, style.y, style.radius);
    ctx.closePath();
    ctx.fillStyle = style.box_fill;
    ctx.fill();
    if (style.box_outline) {
      ctx.strokeStyle = style.box_outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fontString(style, style.label_size, 'label');
    ctx.fillStyle = style.label_color;
    ctx.fillText(RECORD_LABELS[index] || col.label || '', col.x, style.y + labelY);
    ctx.font = fontString(style, valueSize, 'value');
    ctx.fillStyle = style.value_color;
    ctx.fillText(texts[index] ?? '-', col.x, style.y + valueY);
    ctx.restore();
  }
  return valueSize;
}

module.exports = { RECORD_LABELS, fitRecordValueSize, drawRecordRow };
