/* Fit every UNO card into the hand box. No paging. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.UnoHandFit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function fit(count, boxW, boxH) {
    const n = Math.max(1, count | 0);
    const width = Math.max(80, boxW || 320);
    const height = Math.max(48, boxH || 160);
    const gap = 4;
    const ratio = 1.5;
    const pad = 8;
    let best = null;
    const maxRows = Math.min(n, 5);
    for (let rows = 1; rows <= maxRows; rows++) {
      const cols = Math.ceil(n / rows);
      const innerW = width - pad - gap * Math.max(0, cols - 1);
      const innerH = height - pad - gap * Math.max(0, rows - 1);
      if (innerW < cols || innerH < rows) continue;
      let tileW = Math.floor(innerW / cols);
      let tileH = Math.floor(innerH / rows);
      tileW = Math.min(tileW, Math.floor(tileH / ratio));
      tileW = Math.max(28, Math.min(72, tileW));
      tileH = Math.round(tileW * ratio);
      const usedW = tileW * cols + gap * Math.max(0, cols - 1);
      const usedH = tileH * rows + gap * Math.max(0, rows - 1);
      if (usedW > width - 2 || usedH > height - 2) continue;
      if (!best || tileW > best.width || (tileW === best.width && rows < best.rows)) {
        best = { cols: cols, rows: rows, width: tileW, height: tileH, gap: gap };
      }
    }
    if (best) return best;
    const cols = Math.max(1, Math.floor((width - pad) / 32));
    const rows = Math.ceil(n / cols);
    return { cols: cols, rows: rows, width: 28, height: 42, gap: 3 };
  }

  return { fit: fit };
});
