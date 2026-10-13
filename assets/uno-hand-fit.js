/* Fit every UNO card into the hand box. One or two rows. No paging. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.UnoHandFit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function fit(count, boxW, boxH) {
    const n = Math.max(1, count | 0);
    const width = Math.max(120, boxW || 320);
    const height = Math.max(72, boxH || 160);
    const gap = 6;
    const ratio = 1.48;
    const pad = 12;
    const minW = 40;
    let best = null;
    const maxRows = Math.min(2, n);
    for (let rows = 1; rows <= maxRows; rows++) {
      const cols = Math.ceil(n / rows);
      const innerW = width - pad - gap * Math.max(0, cols - 1);
      const innerH = height - pad - gap * Math.max(0, rows - 1);
      if (innerW < cols || innerH < rows) continue;
      let tileW = Math.floor(innerW / cols);
      const tileHLimit = Math.floor(innerH / rows);
      tileW = Math.min(72, tileW, Math.floor(tileHLimit / ratio));
      if (tileW < minW) continue;
      const tileH = Math.round(tileW * ratio);
      const usedW = tileW * cols + gap * Math.max(0, cols - 1);
      const usedH = tileH * rows + gap * Math.max(0, rows - 1);
      if (usedW > width - pad || usedH > height - pad) continue;
      if (!best || tileW > best.width || (tileW === best.width && rows < best.rows)) {
        best = { cols: cols, rows: rows, width: tileW, height: tileH, gap: gap, overlap: 0 };
      }
    }
    if (best) return best;

    const rows = height >= 150 && n > 7 ? 2 : 1;
    const cols = Math.ceil(n / rows);
    const limitW = Math.max(72, width - pad);
    const limitH = Math.max(52, height - pad);
    const maxOverlapRatio = 0.42;
    let tileH = Math.min(72, Math.floor((limitH - gap * Math.max(0, rows - 1)) / rows));
    let tileW = Math.min(52, Math.max(36, Math.floor(tileH / ratio)));
    tileH = Math.round(tileW * ratio);
    if (tileH * rows + gap * Math.max(0, rows - 1) > limitH) {
      tileH = Math.max(52, Math.floor((limitH - gap * Math.max(0, rows - 1)) / rows));
      tileW = Math.max(36, Math.floor(tileH / ratio));
      tileH = Math.round(tileW * ratio);
    }
    let overlap = 0;
    if (cols > 1) {
      const denom = cols - maxOverlapRatio * (cols - 1);
      const fitW = Math.floor((limitW - gap * (cols - 1)) / denom);
      if (fitW < tileW) tileW = Math.max(36, fitW);
      tileH = Math.round(tileW * ratio);
      const natural = tileW * cols + gap * (cols - 1);
      if (natural > limitW) {
        overlap = Math.ceil((natural - limitW) / (cols - 1));
        overlap = Math.min(overlap, Math.floor(tileW * maxOverlapRatio));
      }
    }
    return { cols: cols, rows: rows, width: tileW, height: tileH, gap: gap, overlap: overlap };
  }

  return { fit: fit };
});
