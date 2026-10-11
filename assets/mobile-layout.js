/*
 * Pure layout math for the Android app. The website and Electron build
 * do not call this. UNO pages a large hand. Dominoes uses fitHandTiles
 * so every tile stays visible without a pager.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GamewebMobileLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function tilePageSize(length, tile, gap, chrome) {
    const inner = Math.max(0, Number(length) - Number(chrome || 0));
    const slot = Number(tile) + Number(gap);
    if (!Number.isFinite(slot) || slot <= 0) return 1;
    return Math.max(1, Math.floor((inner + Number(gap)) / slot));
  }

  function pagePlan(count, page, pageSize, selectedIndex) {
    const size = Math.max(1, pageSize | 0);
    const total = Math.max(0, count | 0);
    const pages = Math.max(1, Math.ceil(total / size) || 1);
    let current = page | 0;
    if (selectedIndex >= 0) current = Math.floor(selectedIndex / size);
    if (current < 0) current = 0;
    if (current > pages - 1) current = pages - 1;
    const start = total ? current * size : 0;
    const end = Math.min(total, start + size);
    return {
      page: current,
      pages: pages,
      start: start,
      end: end,
      pageSize: size,
      total: total
    };
  }

  function fitHandTiles(count, width, height, options) {
    const opts = options || {};
    const gap = opts.gap == null ? 4 : Number(opts.gap);
    const minWidth = opts.minWidth == null ? 26 : Number(opts.minWidth);
    const maxWidth = opts.maxWidth == null ? 52 : Number(opts.maxWidth);
    const aspect = opts.aspect == null ? 2 : Number(opts.aspect);
    const n = Math.max(0, count | 0);
    const boxW = Math.max(0, Number(width) || 0);
    const boxH = Math.max(0, Number(height) || 0);
    if (!n || boxW < 1 || boxH < 1 || !(gap >= 0) || !(aspect > 0)) {
      return { width: 0, height: 0, columns: 0, rows: 0, gap: gap || 0 };
    }
    let best = null;
    let fallback = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const gapsW = gap * Math.max(0, cols - 1);
      const gapsH = gap * Math.max(0, rows - 1);
      const cellW = (boxW - gapsW) / cols;
      const cellH = (boxH - gapsH) / rows;
      if (!(cellW > 1) || !(cellH > 1)) continue;
      const tileW = Math.min(cellW, cellH / aspect, maxWidth);
      const tileH = tileW * aspect;
      const packed = {
        width: tileW,
        height: tileH,
        columns: cols,
        rows: rows,
        gap: gap
      };
      if (!fallback || tileW > fallback.width) fallback = packed;
      if (tileW + 0.01 < minWidth) continue;
      if (!best || tileW > best.width + 0.01 || (Math.abs(tileW - best.width) <= 0.01 && rows < best.rows)) {
        best = packed;
      }
    }
    if (best) return best;
    if (fallback) return Object.assign({ cramped: true }, fallback);
    return { width: 0, height: 0, columns: 0, rows: 0, gap: gap, cramped: true };
  }

  return {
    tilePageSize: tilePageSize,
    pagePlan: pagePlan,
    fitHandTiles: fitHandTiles
  };
});
