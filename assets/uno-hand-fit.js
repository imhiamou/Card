/* Fit a UNO hand into one overlapping row. A second row is used only when
   one row would make the values unreadably small and the box is tall enough. */
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
    const gap = 0;
    const ratio = 1.56;
    const pad = 8;
    const minW = 36;
    const preferW = 48;
    const maxOverlap = 0.46;
    const limitW = Math.max(72, width - pad);
    const limitH = Math.max(52, height - pad);

    function layout(rows) {
      const cols = Math.ceil(n / rows);
      const rowBudget = Math.max(40, Math.floor((limitH - gap * Math.max(0, rows - 1)) / rows));
      let tileW = Math.min(96, Math.max(minW, Math.floor(rowBudget / ratio)));
      if (cols > 1) {
        const denom = cols - maxOverlap * (cols - 1);
        const fitW = Math.floor((limitW - gap * (cols - 1)) / denom);
        tileW = Math.min(tileW, Math.max(minW, fitW));
      } else {
        tileW = Math.min(tileW, limitW);
      }
      let tileH = Math.round(tileW * ratio);
      if (tileH * rows + gap * Math.max(0, rows - 1) > limitH) {
        tileH = Math.max(40, Math.floor((limitH - gap * Math.max(0, rows - 1)) / rows));
        tileW = Math.max(minW, Math.floor(tileH / ratio));
        tileH = Math.round(tileW * ratio);
      }
      let overlap = 0;
      if (cols > 1) {
        let guard = 0;
        while (guard < 80) {
          guard += 1;
          const cap = Math.floor(tileW * maxOverlap);
          const natural = tileW * cols + gap * (cols - 1);
          const need = natural > limitW ? Math.ceil((natural - limitW) / (cols - 1)) : 0;
          if (need <= cap) {
            overlap = need;
            break;
          }
          if (tileW <= minW) {
            overlap = cap;
            break;
          }
          tileW -= 1;
          tileH = Math.round(tileW * ratio);
        }
      }
      const usedW = tileW * cols + gap * Math.max(0, cols - 1) - overlap * Math.max(0, cols - 1);
      const usedH = tileH * rows + gap * Math.max(0, rows - 1);
      return {
        cols: cols,
        rows: rows,
        width: tileW,
        height: tileH,
        gap: gap,
        overlap: overlap,
        usedW: usedW,
        usedH: usedH
      };
    }

    const one = layout(1);
    let best = one;
    const oneCramped = one.width < preferW || one.usedW > limitW + 1;
    if (n > 8 && oneCramped && height >= 150) {
      const two = layout(2);
      const twoFits = two.usedW <= limitW + 1 && two.usedH <= limitH + 1 && two.height >= 52;
      if (twoFits && two.width >= one.width + 6) best = two;
    }
    return {
      cols: best.cols,
      rows: best.rows,
      width: best.width,
      height: best.height,
      gap: best.gap,
      overlap: best.overlap
    };
  }

  return { fit: fit };
});
