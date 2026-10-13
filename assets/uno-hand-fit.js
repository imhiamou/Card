/* Fit every UNO card into the hand box. A normal hand is one overlapping row. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.UnoHandFit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function layout(count, rows, limitW, limitH, minW, maxOverlapRatio) {
    const cols = Math.ceil(count / rows);
    const gap = cols <= 4 ? 8 : 4;
    const rowGap = 6;
    const ratio = 1.48;
    const maxH = Math.floor((limitH - rowGap * Math.max(0, rows - 1)) / rows);
    if (maxH < 52) return null;
    let tileW = Math.min(78, Math.floor(maxH / ratio));
    const slack = Math.max(0, cols - 1);
    const clearWidth = Math.floor((limitW - gap * slack) / cols);
    if (cols > 1 && clearWidth < tileW) {
      const denom = cols - maxOverlapRatio * slack;
      const overlapped = Math.floor((limitW - gap * slack) / denom);
      tileW = Math.min(tileW, Math.max(minW, overlapped));
    }
    if (tileW < minW) return null;
    let tileH = Math.round(tileW * ratio);
    if (tileH > maxH) {
      tileH = maxH;
      tileW = Math.max(minW, Math.floor(tileH / ratio));
      tileH = Math.round(tileW * ratio);
    }
    let overlap = 0;
    let guard = 0;
    while (guard < 24) {
      const natural = tileW * cols + gap * slack;
      overlap = natural > limitW && slack > 0 ? Math.ceil((natural - limitW) / slack) : 0;
      const cap = Math.floor(tileW * maxOverlapRatio);
      if (overlap <= cap && tileW * cols + (gap - overlap) * slack <= limitW + 1) break;
      if (tileW <= minW) return null;
      tileW -= 1;
      tileH = Math.round(tileW * ratio);
      guard += 1;
    }
    if (tileH * rows + rowGap * Math.max(0, rows - 1) > limitH) return null;
    return { cols: cols, rows: rows, width: tileW, height: tileH, gap: gap, overlap: overlap };
  }

  function fit(count, boxW, boxH) {
    const n = Math.max(1, count | 0);
    const width = Math.max(120, boxW || 320);
    const height = Math.max(72, boxH || 120);
    const limitW = Math.max(80, width - 8);
    const limitH = Math.max(52, height - 8);
    const fan = layout(n, 1, limitW, limitH, n > 10 ? 42 : 48, 0.38);
    if (fan && (n <= 9 || fan.width >= 46)) return fan;
    if (n > 8 && limitH >= 108) {
      const grid = layout(n, 2, limitW, limitH, 36, 0.28);
      if (grid) return grid;
    }
    if (fan) return fan;
    return layout(n, 1, limitW, limitH, 36, 0.42) || {
      cols: n,
      rows: 1,
      width: 36,
      height: 52,
      gap: 4,
      overlap: 12
    };
  }

  return { fit: fit };
});
