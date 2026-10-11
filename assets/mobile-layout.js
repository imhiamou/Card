/*
 * Pure layout math for the Android app. The website and Electron build
 * do not call this. Dominoes and UNO use it only when html.gameweb-app
 * is set, to page a hand instead of scrolling the screen.
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

  return {
    tilePageSize: tilePageSize,
    pagePlan: pagePlan
  };
});
