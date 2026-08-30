/* Dominoes — client module (isolated from Hidden Hunt / Word Chain / Code Breaker). */
(function () {
  const PIP_LAYOUTS = {
    0: [],
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]]
  };

  const SCREEN_HTML =
    '<div class="domTitleRow">' +
      '<h2>Dominoes</h2>' +
      '<div class="domMeta" id="domMeta"></div>' +
    '</div>' +
    '<div class="domTableArena" id="domTableArena" data-count="2">' +
      '<div class="domSeat seat-top" data-seat="top"></div>' +
      '<div class="domSeat seat-tl" data-seat="tl"></div>' +
      '<div class="domSeat seat-tr" data-seat="tr"></div>' +
      '<div class="domSeat seat-left" data-seat="left"></div>' +
      '<div class="domSeat seat-right" data-seat="right"></div>' +
      '<div class="domSeat seat-bl" data-seat="bl"></div>' +
      '<div class="domSeat seat-br" data-seat="br"></div>' +
      '<div class="domTableCenter">' +
        '<h2 id="domTurnIndicator"></h2>' +
        '<div class="domBoardWrap" id="domBoardWrap">' +
          '<div class="domBoardInner" id="domBoardInner"></div>' +
        '</div>' +
        '<div class="domEnds">' +
          '<span id="domLeftEnd">Left: —</span>' +
          '<span id="domBoneyard">Boneyard: 0</span>' +
          '<span id="domRightEnd">Right: —</span>' +
        '</div>' +
      '</div>' +
      '<div class="domSeat seat-bottom" data-seat="bottom"></div>' +
    '</div>' +
    '<div class="domHandSection">' +
      '<h3>Your hand</h3>' +
      '<div class="domHand" id="domHand"></div>' +
    '</div>' +
    '<div class="domSidePicker" id="domSidePicker">' +
      '<button type="button" id="domPlayLeft">Play Left</button>' +
      '<button type="button" id="domPlayRight">Play Right</button>' +
    '</div>' +
    '<div class="domActions">' +
      '<button type="button" id="domDrawBtn" disabled>Draw</button>' +
    '</div>' +
    '<p id="domMsg"></p>' +
    '<div class="domScoreDock">' +
      '<button type="button" id="domScoreToggle" class="domScoreToggle hidden">Score</button>' +
      '<div id="domScoreboard" class="domScoreboard hidden"></div>' +
    '</div>' +
    '<div id="domEndButtons" class="domEndButtons hidden">' +
      '<button type="button" id="domPlayAgainBtn">Play Again</button>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let active = false;
  let gameOver = false;
  let myTurn = false;
  let players = [];
  let hand = [];
  let validMoves = [];
  let board = null;
  let selectedTileId = null;
  let canDraw = false;
  let teamMode = false;
  let teams = null;
  let myTeam = null;
  let teammate = null;
  let winnerTeam = null;
  let teamScores = null;
  let matchScoreboard = null;
  let roundPoints = null;
  let lastTurnId = null;
  let panX = 0;
  let panY = 0;
  let scale = 1;
  let dragging = false;
  let dragStart = null;
  /** Explicit board size from natural-chain layout (for fit math). */
  let boardSize = { w: 200, h: 200 };
  /** After the player pans/zooms, leave the camera alone until the next round. */
  let lockView = false;

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let codeBreakerScreen;
  let dominoScreen;
  let domTableArena;
  let domTurnIndicator;
  let domBoardWrap;
  let domBoardInner;
  let domLeftEnd;
  let domRightEnd;
  let domBoneyard;
  let domHand;
  let domMsg;
  let domDrawBtn;
  let domSidePicker;
  let domPlayLeft;
  let domPlayRight;
  let domScoreboard;
  let domScoreToggle;
  let domEndButtons;
  let domPlayAgainBtn;
  let domMeta;
  let scoreOpen = false;

  function $(id) {
    return document.getElementById(id);
  }

  function bindDom() {
    lobbyScreen = $("lobbyScreen");
    placementScreen = $("placementScreen");
    gameScreen = $("gameScreen");
    wordChainScreen = $("wordChainScreen");
    codeBreakerScreen = $("codeBreakerScreen");
    dominoScreen = $("dominoScreen");
    if (!dominoScreen) return false;
    if (!dominoScreen.dataset.ready) {
      dominoScreen.innerHTML = SCREEN_HTML;
      dominoScreen.dataset.ready = "1";
    }
    domTableArena = $("domTableArena");
    domTurnIndicator = $("domTurnIndicator");
    domBoardWrap = $("domBoardWrap");
    domBoardInner = $("domBoardInner");
    domLeftEnd = $("domLeftEnd");
    domRightEnd = $("domRightEnd");
    domBoneyard = $("domBoneyard");
    domHand = $("domHand");
    domMsg = $("domMsg");
    domDrawBtn = $("domDrawBtn");
    domSidePicker = $("domSidePicker");
    domPlayLeft = $("domPlayLeft");
    domPlayRight = $("domPlayRight");
    domScoreboard = $("domScoreboard");
    domScoreToggle = $("domScoreToggle");
    domEndButtons = $("domEndButtons");
    domPlayAgainBtn = $("domPlayAgainBtn");
    domMeta = $("domMeta");
    return true;
  }

  /* ---- SVG tile rendering (programmatic double-six faces) ---- */

  function pipGroup(value, x, y, w, h) {
    const layout = PIP_LAYOUTS[value] || [];
    const r = Math.min(w, h) * 0.09;
    return layout.map(([px, py]) => {
      const cx = x + px * w;
      const cy = y + py * h;
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#1a1a1a"/>';
    }).join("");
  }

  let svgUid = 0;

  /** Build an SVG domino face. vertical=true → tall tile (hand / doubles on board). */
  function tileSvg(leftPip, rightPip, vertical) {
    const W = vertical ? 44 : 88;
    const H = vertical ? 88 : 44;
    const halfW = vertical ? W : W / 2;
    const halfH = vertical ? H / 2 : H;
    const radius = 6;
    const gradId = "domFace" + (++svgUid);
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H +
      '" width="' + W + '" height="' + H + '">';
    svg += '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#f7f3e8"/>' +
      '<stop offset="100%" stop-color="#e4dcc8"/>' +
      "</linearGradient></defs>";
    svg += '<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) +
      '" rx="' + radius + '" ry="' + radius +
      '" fill="url(#' + gradId + ')" stroke="#2a2a2a" stroke-width="1.5"/>';
    if (vertical) {
      svg += '<line x1="6" y1="' + (H / 2) + '" x2="' + (W - 6) + '" y2="' + (H / 2) +
        '" stroke="#333" stroke-width="1.5"/>';
      svg += pipGroup(leftPip, 4, 4, W - 8, halfH - 8);
      svg += pipGroup(rightPip, 4, halfH + 4, W - 8, halfH - 8);
    } else {
      svg += '<line x1="' + (W / 2) + '" y1="6" x2="' + (W / 2) + '" y2="' + (H - 6) +
        '" stroke="#333" stroke-width="1.5"/>';
      svg += pipGroup(leftPip, 4, 4, halfW - 8, H - 8);
      svg += pipGroup(rightPip, halfW + 4, 4, halfW - 8, H - 8);
    }
    svg += "</svg>";
    return svg;
  }

  function makeTileEl(leftPip, rightPip, options) {
    const opts = options || {};
    const vertical = !!opts.vertical;
    const el = document.createElement("div");
    el.className = "domTile svgHost" + (vertical ? "" : " horizontal") +
      (opts.extraClass ? " " + opts.extraClass : "");
    el.innerHTML = tileSvg(leftPip, rightPip, vertical);
    if (opts.tileId) el.dataset.tileId = opts.tileId;
    return el;
  }

  /* ---- Screen / pan ---- */

  function isPhoneLayout() {
    return window.matchMedia("(max-width: 720px)").matches;
  }

  function syncMobileLayout() {
    if (!dominoScreen) return;
    const phone = isPhoneLayout();
    dominoScreen.classList.toggle("dom-touch", phone);
    document.documentElement.classList.toggle("domino-phone-play", phone && active);
    document.body.classList.toggle("domino-phone-play", phone && active);
  }

  function showDominoScreen() {
    active = true;
    if (lobbyScreen) lobbyScreen.classList.add("hidden");
    if (placementScreen) placementScreen.classList.add("hidden");
    if (gameScreen) gameScreen.classList.add("hidden");
    if (wordChainScreen) wordChainScreen.classList.add("hidden");
    if (codeBreakerScreen) codeBreakerScreen.classList.add("hidden");
    dominoScreen.classList.remove("hidden");
    syncMobileLayout();
    requestAnimationFrame(() => {
      fitBoard();
      requestAnimationFrame(fitBoard);
    });
  }

  function hideDominoScreen() {
    active = false;
    clearScoreboard();
    hideEndButtons();
    if (dominoScreen) {
      dominoScreen.classList.add("hidden");
      dominoScreen.classList.remove("dom-touch");
    }
    document.documentElement.classList.remove("domino-phone-play");
    document.body.classList.remove("domino-phone-play");
  }

  function applyPan() {
    if (!domBoardInner) return;
    domBoardInner.style.transform =
      "translate(" + panX + "px," + panY + "px) scale(" + scale + ")";
  }

  function resetPan() {
    panX = 0;
    panY = 0;
    scale = 1;
    lockView = false;
    applyPan();
  }

  /** Fit the whole chain into the table. Skipped while the player has locked the view. */
  function fitBoard() {
    if (!domBoardWrap || !domBoardInner) return;
    if (lockView) return;
    const wrap = domBoardWrap.getBoundingClientRect();
    if (wrap.width < 8 || wrap.height < 8) return;
    const iw = Math.max(boardSize.w, 1);
    const ih = Math.max(boardSize.h, 1);
    const pad = isPhoneLayout() ? 20 : 32;
    const fit = Math.min(
      1.05,
      (wrap.width - pad) / iw,
      (wrap.height - pad) / ih
    );
    const minScale = isPhoneLayout() ? 0.28 : 0.32;
    scale = Math.max(minScale, fit);
    panX = -((iw * scale) / 2);
    panY = -((ih * scale) / 2);
    applyPan();
  }

  /**
   * Natural table-chain layout (visual only).
   * Grows from a center anchor (spinner / mid-chain) toward BOTH open ends.
   * Stays mostly straight; 90° turns only near soft edges or collisions.
   * Never forces a serpentine / zigzag row pattern.
   */
  function layoutNaturalChain(chain) {
    const LONG = 88;
    const SHORT = 44;
    const GAP = 2;
    const PAD = 28;
    const tiles = chain || [];
    if (!tiles.length) return { placed: [], width: 200, height: 140 };

    // Soft playfield — turn only when continuing would leave this area.
    const soft = { minX: -420, maxX: 420, minY: -280, maxY: 280 };

    const placed = new Array(tiles.length);
    const occupied = [];

    function dims(travelDir, isDouble) {
      const horiz = travelDir === 0 || travelDir === 2;
      if (horiz) {
        return isDouble
          ? { w: SHORT, h: LONG, vertical: true }
          : { w: LONG, h: SHORT, vertical: false };
      }
      return isDouble
        ? { w: LONG, h: SHORT, vertical: false }
        : { w: SHORT, h: LONG, vertical: true };
    }

    function rectAt(travelDir, isDouble, attachX, attachY) {
      const d = dims(travelDir, isDouble);
      let x;
      let y;
      if (travelDir === 0) {
        x = attachX;
        y = attachY - d.h / 2;
      } else if (travelDir === 1) {
        x = attachX - d.w / 2;
        y = attachY;
      } else if (travelDir === 2) {
        x = attachX - d.w;
        y = attachY - d.h / 2;
      } else {
        x = attachX - d.w / 2;
        y = attachY - d.h;
      }
      return { x: x, y: y, w: d.w, h: d.h, vertical: d.vertical };
    }

    function overlaps(a, b) {
      return !(
        a.x + a.w <= b.x + 0.5 ||
        b.x + b.w <= a.x + 0.5 ||
        a.y + a.h <= b.y + 0.5 ||
        b.y + b.h <= a.y + 0.5
      );
    }

    function hitsOccupied(r) {
      for (let i = 0; i < occupied.length; i++) {
        if (overlaps(r, occupied[i])) return true;
      }
      return false;
    }

    function insideSoft(r) {
      return (
        r.x >= soft.minX &&
        r.y >= soft.minY &&
        r.x + r.w <= soft.maxX &&
        r.y + r.h <= soft.maxY
      );
    }

    function expandSoft() {
      soft.minX -= 100;
      soft.maxX += 100;
      soft.minY -= 80;
      soft.maxY += 80;
    }

    function freeEnd(r, travelDir) {
      if (travelDir === 0) return { x: r.x + r.w + GAP, y: r.y + r.h / 2 };
      if (travelDir === 1) return { x: r.x + r.w / 2, y: r.y + r.h + GAP };
      if (travelDir === 2) return { x: r.x - GAP, y: r.y + r.h / 2 };
      return { x: r.x + r.w / 2, y: r.y - GAP };
    }

    /** Attach point for a 90° turn onto newDir from last tile traveling oldDir. */
    function cornerAttach(last, oldDir, newDir, isDouble) {
      const nd = dims(newDir, isDouble);
      // Outer-corner alignment keeps the connection obvious at the free end.
      if (oldDir === 0 && newDir === 1) {
        return { x: last.x + last.w - nd.w / 2, y: last.y + last.h + GAP };
      }
      if (oldDir === 0 && newDir === 3) {
        return { x: last.x + last.w - nd.w / 2, y: last.y - GAP };
      }
      if (oldDir === 1 && newDir === 0) {
        return { x: last.x + last.w + GAP, y: last.y + last.h - nd.h / 2 };
      }
      if (oldDir === 1 && newDir === 2) {
        return { x: last.x - GAP, y: last.y + last.h - nd.h / 2 };
      }
      if (oldDir === 2 && newDir === 1) {
        return { x: last.x + nd.w / 2, y: last.y + last.h + GAP };
      }
      if (oldDir === 2 && newDir === 3) {
        return { x: last.x + nd.w / 2, y: last.y - GAP };
      }
      if (oldDir === 3 && newDir === 0) {
        return { x: last.x + last.w + GAP, y: last.y + nd.h / 2 };
      }
      if (oldDir === 3 && newDir === 2) {
        return { x: last.x - GAP, y: last.y + nd.h / 2 };
      }
      // Fallback: continue from free end center.
      return freeEnd(last, newDir);
    }

    function scoreCandidate(r, travelDir, preferDir, turnPenalty) {
      let s = 0;
      if (hitsOccupied(r)) s -= 10000;
      if (!insideSoft(r)) s -= 850;
      if (travelDir === preferDir) s += 80;
      s -= turnPenalty;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      // Mild preference for unused open space (away from cluttered center once long).
      s -= (Math.abs(cx) + Math.abs(cy)) * 0.01;
      if (travelDir === 0) s += Math.max(0, soft.maxX - (r.x + r.w)) * 0.02;
      if (travelDir === 1) s += Math.max(0, soft.maxY - (r.y + r.h)) * 0.02;
      if (travelDir === 2) s += Math.max(0, r.x - soft.minX) * 0.02;
      if (travelDir === 3) s += Math.max(0, r.y - soft.minY) * 0.02;
      return s;
    }

    function pipsForDir(tile, travelDir, towardHigherIndex) {
      // leftPip faces toward chain[i-1], rightPip toward chain[i+1].
      // throughDir = direction along the chain from leftPip → rightPip.
      const throughDir = towardHigherIndex ? travelDir : (travelDir + 2) % 4;
      let left = tile.leftPip;
      let right = tile.rightPip;
      if (throughDir === 2 || throughDir === 3) {
        left = tile.rightPip;
        right = tile.leftPip;
      }
      return { left: left, right: right };
    }

    function commit(index, tile, rect, travelDir, towardHigherIndex) {
      const pips = pipsForDir(tile, travelDir, towardHigherIndex);
      const entry = {
        tile: tile,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        vertical: rect.vertical,
        left: pips.left,
        right: pips.right,
        dir: travelDir,
        isEnd: index === 0 || index === tiles.length - 1
      };
      placed[index] = entry;
      occupied.push(entry);
      return entry;
    }

    /**
     * Turn buffer for doubles (visual only):
     * Never use a double as the corner tile. Keep direction through the
     * double, place one more straight tile after it, then turn.
     */
    function forceStraightRect(fromEntry, preferDir, isDouble) {
      let straightPt = freeEnd(fromEntry, preferDir);
      let straight = rectAt(preferDir, isDouble, straightPt.x, straightPt.y);
      let guard = 0;
      while ((hitsOccupied(straight) || !insideSoft(straight)) && guard < 8) {
        expandSoft();
        straightPt = freeEnd(fromEntry, preferDir);
        straight = rectAt(preferDir, isDouble, straightPt.x, straightPt.y);
        guard += 1;
      }
      return straight;
    }

    function reserveFollowOnAfterDouble(doubleRect, preferDir) {
      // Ensure one normal tile can continue straight past a double.
      let pt = freeEnd(doubleRect, preferDir);
      let follow = rectAt(preferDir, false, pt.x, pt.y);
      let guard = 0;
      while (!insideSoft(follow) && guard < 8) {
        expandSoft();
        pt = freeEnd(doubleRect, preferDir);
        follow = rectAt(preferDir, false, pt.x, pt.y);
        guard += 1;
      }
    }

    function placeNext(index, tile, fromEntry, preferDir, towardHigherIndex) {
      const isDouble = !!tile.isDouble;
      const prevIsDouble = !!(fromEntry && fromEntry.tile && fromEntry.tile.isDouble);
      // Doubles stay in the straight run; the tile right after a double stays
      // straight too so the double is never the immediate corner.
      const mustStayStraight = isDouble || prevIsDouble;

      if (mustStayStraight) {
        const straight = forceStraightRect(fromEntry, preferDir, isDouble);
        if (!hitsOccupied(straight)) {
          if (isDouble) reserveFollowOnAfterDouble(straight, preferDir);
          return commit(index, tile, straight, preferDir, towardHigherIndex);
        }
        // Absolute last resort only: fall through to normal placement.
      }

      const straightPt = freeEnd(fromEntry, preferDir);
      const candidates = [];

      const straight = rectAt(preferDir, isDouble, straightPt.x, straightPt.y);
      candidates.push({
        d: preferDir,
        r: straight,
        s: scoreCandidate(straight, preferDir, preferDir, 0)
      });

      const turns = [(preferDir + 1) % 4, (preferDir + 3) % 4];
      for (let t = 0; t < turns.length; t++) {
        const nd = turns[t];
        const pt = cornerAttach(fromEntry, preferDir, nd, isDouble);
        const r = rectAt(nd, isDouble, pt.x, pt.y);
        candidates.push({
          d: nd,
          r: r,
          s: scoreCandidate(r, nd, preferDir, 25)
        });
      }

      candidates.sort((a, b) => b.s - a.s);

      // Keep going straight whenever it still fits — never zig-zag for style.
      const straightCand = candidates.find((c) => c.d === preferDir);
      let best = candidates[0];
      if (
        straightCand &&
        !hitsOccupied(straightCand.r) &&
        insideSoft(straightCand.r)
      ) {
        best = straightCand;
      }

      if (best.s < -5000) {
        expandSoft();
        if (straightCand && !hitsOccupied(straightCand.r)) {
          best = straightCand;
        } else {
          // Retry turns after soft expand.
          for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            if (!hitsOccupied(c.r)) {
              best = c;
              break;
            }
          }
          // Last resort: nudge soft and force straight even if slightly out.
          if (best.s < -5000 && straightCand) best = straightCand;
        }
      }

      return commit(index, tile, best.r, best.d, towardHigherIndex);
    }

    // Anchor near the spinner (first double) or mid-chain so both ends grow out.
    let anchorIdx = -1;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i].isDouble) {
        anchorIdx = i;
        break;
      }
    }
    if (anchorIdx < 0) anchorIdx = Math.floor((tiles.length - 1) / 2);

    const anchorTile = tiles[anchorIdx];
    const anchorDir = 0; // chain spine starts east/west through the table center
    const ad = dims(anchorDir, !!anchorTile.isDouble);
    const anchorRect = {
      x: -ad.w / 2,
      y: -ad.h / 2,
      w: ad.w,
      h: ad.h,
      vertical: ad.vertical
    };
    let rightEntry = commit(anchorIdx, anchorTile, anchorRect, anchorDir, true);
    let leftEntry = rightEntry;
    let rightDir = anchorDir;
    let leftDir = 2; // left end grows west

    for (let i = anchorIdx + 1; i < tiles.length; i++) {
      rightEntry = placeNext(i, tiles[i], rightEntry, rightDir, true);
      rightDir = rightEntry.dir;
    }
    for (let i = anchorIdx - 1; i >= 0; i--) {
      leftEntry = placeNext(i, tiles[i], leftEntry, leftDir, false);
      leftDir = leftEntry.dir;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }

    const ox = -minX + PAD;
    const oy = -minY + PAD;
    for (let i = 0; i < placed.length; i++) {
      placed[i].x += ox;
      placed[i].y += oy;
    }

    return {
      placed: placed,
      width: Math.max(180, maxX - minX + PAD * 2),
      height: Math.max(140, maxY - minY + PAD * 2)
    };
  }

  function wireBoardPan() {
    if (!domBoardWrap || domBoardWrap.dataset.panWired) return;
    domBoardWrap.dataset.panWired = "1";

    let pinchStartDist = 0;
    let pinchStartScale = 1;

    const onDown = (clientX, clientY) => {
      dragging = true;
      dragStart = { x: clientX, y: clientY, panX: panX, panY: panY };
      domBoardWrap.classList.add("dragging");
    };
    const onMove = (clientX, clientY) => {
      if (!dragging || !dragStart) return;
      const nx = dragStart.panX + (clientX - dragStart.x);
      const ny = dragStart.panY + (clientY - dragStart.y);
      if (nx !== panX || ny !== panY) lockView = true;
      panX = nx;
      panY = ny;
      applyPan();
    };
    const onUp = () => {
      dragging = false;
      dragStart = null;
      pinchStartDist = 0;
      domBoardWrap.classList.remove("dragging");
    };

    function touchDistance(touches) {
      const a = touches[0];
      const b = touches[1];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    domBoardWrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      onDown(e.clientX, e.clientY);
    });
    window.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
    window.addEventListener("mouseup", onUp);

    domBoardWrap.addEventListener("touchstart", (e) => {
      if (e.touches.length >= 2) {
        dragging = false;
        pinchStartDist = touchDistance(e.touches);
        pinchStartScale = scale;
        return;
      }
      if (!e.touches[0]) return;
      onDown(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    domBoardWrap.addEventListener("touchmove", (e) => {
      if (e.touches.length >= 2 && pinchStartDist > 0) {
        e.preventDefault();
        const dist = touchDistance(e.touches);
        const next = pinchStartScale * (dist / pinchStartDist);
        const minScale = isPhoneLayout() ? 0.28 : 0.35;
        const clamped = Math.min(1.8, Math.max(minScale, next));
        if (clamped !== scale) lockView = true;
        scale = clamped;
        applyPan();
        return;
      }
      if (!e.touches[0]) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    domBoardWrap.addEventListener("touchend", onUp);
    domBoardWrap.addEventListener("touchcancel", onUp);

    domBoardWrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const next = scale + (e.deltaY < 0 ? 0.08 : -0.08);
      const minScale = isPhoneLayout() ? 0.28 : 0.35;
      const clamped = Math.min(1.8, Math.max(minScale, next));
      if (clamped !== scale) lockView = true;
      scale = clamped;
      applyPan();
    }, { passive: false });

    window.addEventListener("resize", () => {
      if (!active) return;
      syncMobileLayout();
      requestAnimationFrame(fitBoard);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        if (!active) return;
        requestAnimationFrame(fitBoard);
      });
    }
  }

  /* ---- Render ---- */

  function hideEndButtons() {
    if (domEndButtons) {
      domEndButtons.classList.add("hidden");
      if (domPlayAgainBtn) {
        domPlayAgainBtn.disabled = false;
        domPlayAgainBtn.textContent = "Play Again";
      }
    }
  }

  function clearScoreboard() {
    scoreOpen = false;
    if (domScoreboard) {
      domScoreboard.classList.add("hidden");
      domScoreboard.classList.remove("open");
      domScoreboard.innerHTML = "";
    }
    if (domScoreToggle) {
      domScoreToggle.classList.add("hidden");
      domScoreToggle.setAttribute("aria-expanded", "false");
      domScoreToggle.textContent = "Score";
    }
  }

  function setScoreOpen(open) {
    scoreOpen = !!open;
    if (!domScoreboard || !domScoreToggle) return;
    domScoreboard.classList.toggle("hidden", !scoreOpen);
    domScoreboard.classList.toggle("open", scoreOpen);
    domScoreToggle.setAttribute("aria-expanded", scoreOpen ? "true" : "false");
    domScoreToggle.textContent = scoreOpen ? "Hide score" : "Score";
  }

  /** Clears Play Again controls. Scoreboard stays until the player leaves the lobby. */
  function hideEndUi(clearBoard) {
    hideEndButtons();
    if (clearBoard) clearScoreboard();
  }

  function sfx(name) {
    if (window.GameSfx && typeof window.GameSfx[name] === "function") {
      window.GameSfx[name]();
    }
  }

  function showEndUi(scores, winnerId, message, overMeta) {
    if (!domScoreboard) return;
    const meta = overMeta || {};
    let html =
      '<div class="domScoreHeader">' +
        "<h3>Scoreboard</h3>" +
        '<button type="button" class="domScoreClose" id="domScoreClose" aria-label="Close scoreboard">×</button>' +
      "</div>";

    if (meta.teamMode && meta.matchScoreboard) {
      // Match totals only: rounds won + score (winner gets opponent leftovers).
      // Do not list each player's leftover hand points.
      meta.matchScoreboard.forEach((ts) => {
        const win = meta.winnerTeam === ts.team;
        const rounds = ts.roundsWon === 1 ? "1 round won" : ts.roundsWon + " rounds won";
        html += '<div class="domTeamScore' + (win ? " winner" : "") + '">' +
          "<strong>Team " + ts.team + (win ? " ★" : "") + "</strong>" +
          "<span>" + rounds + " · score " + ts.score + "</span></div>";
      });
      if (meta.winnerTeam && meta.roundPoints != null) {
        html += '<p class="domRoundAward">This round: Team ' + meta.winnerTeam +
          " scored +" + meta.roundPoints + "</p>";
      }
    } else if (meta.matchScoreboard && !meta.teamMode) {
      meta.matchScoreboard.forEach((row) => {
        const win = row.id === winnerId;
        const rounds = row.roundsWon === 1 ? "1 round won" : row.roundsWon + " rounds won";
        html += '<div class="domScoreRow' + (win ? " winner" : "") + '">' +
          "<span>" + (row.name || "Player") + (win ? " ★" : "") + "</span>" +
          "<span>" + rounds + " · score " + row.score + "</span></div>";
      });
      if (winnerId && meta.roundPoints != null) {
        const w = meta.matchScoreboard.find((r) => r.id === winnerId);
        html += '<p class="domRoundAward">This round: ' +
          (w ? w.name : "Winner") + " scored +" + meta.roundPoints + "</p>";
      }
    } else if (meta.teamMode && meta.teamScores) {
      // Legacy fallback if matchScoreboard missing.
      meta.teamScores.forEach((ts) => {
        const win = meta.winnerTeam === ts.team;
        html += '<div class="domTeamScore' + (win ? " winner" : "") + '">' +
          "<strong>Team " + ts.team + (win ? " ★" : "") + "</strong>" +
          "<span>score " + ts.points + "</span></div>";
      });
    } else {
      (scores || []).forEach((row) => {
        const win = row.id === winnerId;
        html += '<div class="domScoreRow' + (win ? " winner" : "") + '">' +
          "<span>" + (row.name || "Player") + (win ? " ★" : "") + "</span>" +
          "<span>" + row.points + " points</span></div>";
      });
      const winner = (scores || []).find((r) => r.id === winnerId);
      html += '<div class="domScoreRow winner"><span>Winner</span><span>' +
        (winner ? winner.name : "—") + "</span></div>";
    }

    if (message) html += "<p>" + message + "</p>";
    domScoreboard.innerHTML = html;
    if (domScoreToggle) domScoreToggle.classList.remove("hidden");
    // Keep the table clear by default; player opens score when they want it.
    setScoreOpen(false);
    const closeBtn = $("domScoreClose");
    if (closeBtn) closeBtn.onclick = () => setScoreOpen(false);
    if (domEndButtons) domEndButtons.classList.remove("hidden");
  }

  function seatNamesForCount(n) {
    if (n <= 2) return ["bottom", "top"];
    if (n === 3) return ["bottom", "left", "right"];
    if (n === 4) return ["bottom", "left", "top", "right"];
    return ["bottom", "bl", "tl", "tr", "br"].slice(0, n);
  }

  function playersFromMe() {
    if (!socket || !players.length) return players.slice();
    const idx = players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return players.slice();
    return players.slice(idx).concat(players.slice(0, idx));
  }

  function clearSeats() {
    if (!domTableArena) return;
    domTableArena.querySelectorAll(".domSeat").forEach((seat) => {
      seat.innerHTML = "";
      seat.classList.add("empty");
    });
  }

  function flashSeatToast(playerId, text) {
    if (!domTableArena || !playerId) return;
    const chip = domTableArena.querySelector('.domPlayerChip[data-pid="' + playerId + '"]');
    if (!chip) return;
    const old = chip.querySelector(".seatToast");
    if (old) old.remove();
    const toast = document.createElement("div");
    toast.className = "seatToast";
    toast.textContent = text;
    chip.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
      toast.classList.add("hide");
      setTimeout(() => toast.remove(), 350);
    }, 1600);
  }

  function playerChipEl(p, currentTurnId) {
    const isMe = socket && p.id === socket.id;
    const turn = p.id === currentTurnId && !gameOver;
    const mate = teammate && p.id === teammate.id;
    const chip = document.createElement("div");
    chip.className = "domPlayerChip" +
      (turn ? " turn" : "") +
      (isMe ? " me" : "") +
      (mate ? " mate" : "");
    chip.dataset.pid = p.id;

    let label = p.name || "Player";
    if (isMe) label = "YOU";

    let teamLine = "";
    if (teamMode && p.team) {
      teamLine = '<div class="domTeamLine">TEAM ' + p.team +
        (isMe || mate ? (isMe ? " · you" : " · teammate") : "") +
        "</div>";
    }

    const turnBadge = turn
      ? '<div class="domTurnBadge">' + (isMe ? "YOUR TURN" : "TURN") + "</div>"
      : "";

    chip.innerHTML =
      turnBadge +
      '<div class="domName">' + label +
      (p.isBot ? ' <span class="botTag">BOT</span>' : "") +
      "</div>" +
      teamLine +
      '<div class="domCount">' + p.handCount + " dominoes</div>";
    return chip;
  }

  function renderPlayers(currentTurnId) {
    if (!domTableArena) return;
    if (currentTurnId) lastTurnId = currentTurnId;
    const turnId = currentTurnId || lastTurnId;
    const ordered = playersFromMe();
    const seats = seatNamesForCount(ordered.length);
    clearSeats();
    domTableArena.setAttribute("data-count", String(ordered.length));

    ordered.forEach((p, i) => {
      const seatName = seats[i];
      if (!seatName) return;
      const seat = domTableArena.querySelector('.domSeat[data-seat="' + seatName + '"]');
      if (!seat) return;
      seat.classList.remove("empty");
      seat.appendChild(playerChipEl(p, turnId));
    });
  }

  function renderBoard(animateId) {
    if (!domBoardInner || !board) return;
    const layout = layoutNaturalChain(board.chain || []);
    boardSize = { w: layout.width, h: layout.height };
    domBoardInner.style.width = layout.width + "px";
    domBoardInner.style.height = layout.height + "px";
    domBoardInner.innerHTML = "";
    layout.placed.forEach((p) => {
      const el = makeTileEl(p.left, p.right, {
        vertical: p.vertical,
        extraClass: "boardTile" +
          (p.isEnd ? " openEnd" : "") +
          (animateId && p.tile.id === animateId ? " playAnim" : ""),
        tileId: p.tile.id
      });
      el.style.left = Math.round(p.x) + "px";
      el.style.top = Math.round(p.y) + "px";
      el.style.width = p.w + "px";
      el.style.height = p.h + "px";
      domBoardInner.appendChild(el);
    });
    if (domLeftEnd) {
      domLeftEnd.textContent = board.leftEnd == null ? "Left: —" : "Left: " + board.leftEnd;
    }
    if (domRightEnd) {
      domRightEnd.textContent = board.rightEnd == null ? "Right: —" : "Right: " + board.rightEnd;
    }
    if (domBoneyard) {
      domBoneyard.textContent = "Boneyard: " + (board.boneyardCount || 0);
    }
    if (!lockView) {
      requestAnimationFrame(() => {
        fitBoard();
        requestAnimationFrame(fitBoard);
      });
    }
  }

  function movesForTile(tileId) {
    return validMoves.filter((m) => m.tileId === tileId);
  }

  function renderHand(animateDrawId) {
    if (!domHand) return;
    domHand.innerHTML = "";
    hand.forEach((tile) => {
      const moves = movesForTile(tile.id);
      const el = makeTileEl(tile.a, tile.b, {
        vertical: true,
        extraClass: "inHand" +
          (moves.length && myTurn && !gameOver ? " valid" : "") +
          (selectedTileId === tile.id ? " selected" : "") +
          (animateDrawId && tile.id === animateDrawId ? " drawAnim" : ""),
        tileId: tile.id
      });
      el.onclick = () => onHandClick(tile.id);
      domHand.appendChild(el);
    });
  }

  function renderChrome(data) {
    const currentTurnId = data.currentTurnId;
    const current = players.find((p) => p.id === currentTurnId);
    if (gameOver) {
      domTurnIndicator.textContent = "Round Over";
    } else if (myTurn) {
      if (board && board.mustPlayId) {
        domTurnIndicator.textContent = "Your turn — play " + board.mustPlayId.replace("-", "|");
      } else {
        domTurnIndicator.textContent = "Your Turn";
      }
    } else {
      domTurnIndicator.textContent = (current ? current.name : "Opponent") + "'s Turn";
    }
    if (domMeta) {
      domMeta.textContent = players.length + " players · Double-Six" +
        (teamMode ? " · Teams" : "");
    }
    if (domDrawBtn) {
      domDrawBtn.disabled = !canDraw || !myTurn || gameOver;
    }
    if (!myTurn || gameOver) hideSidePicker();
  }

  function applyState(data, opts) {
    const options = opts || {};
    currentRoom = data.room || currentRoom;
    players = data.players || players;
    myTurn = !!data.yourTurn;
    hand = data.hand || [];
    validMoves = data.validMoves || [];
    board = data.board || board;
    canDraw = !!data.canDraw;
    gameOver = !!data.over;
    if (data.teamMode != null) teamMode = !!data.teamMode;
    if (data.teams !== undefined) teams = data.teams;
    if (data.myTeam !== undefined) myTeam = data.myTeam;
    if (data.teammate !== undefined) teammate = data.teammate;
    if (data.winnerTeam !== undefined) winnerTeam = data.winnerTeam;
    if (data.teamScores !== undefined) teamScores = data.teamScores;
    if (data.matchScoreboard !== undefined) matchScoreboard = data.matchScoreboard;
    if (data.roundPoints !== undefined) roundPoints = data.roundPoints;
    if (gameOver) selectedTileId = null;
    renderPlayers(data.currentTurnId);
    renderBoard(options.animatePlayId);
    renderHand(options.animateDrawId);
    renderChrome(data);
    if (data.over && (data.matchScoreboard || data.scores)) {
      showEndUi(data.scores, data.winnerId, data.message, {
        teamMode,
        teamScores: data.teamScores || teamScores,
        winnerTeam: data.winnerTeam || winnerTeam,
        matchScoreboard: data.matchScoreboard || matchScoreboard,
        roundPoints: data.roundPoints != null ? data.roundPoints : roundPoints
      });
    }
  }

  /* ---- Interaction ---- */

  function hideSidePicker() {
    if (domSidePicker) domSidePicker.classList.remove("show");
    selectedTileId = null;
  }

  function showSidePicker() {
    if (domSidePicker) domSidePicker.classList.add("show");
  }

  function onHandClick(tileId) {
    if (!myTurn || gameOver) return;
    const moves = movesForTile(tileId);
    if (!moves.length) {
      domMsg.textContent = "That domino cannot be played right now.";
      return;
    }
    selectedTileId = tileId;
    renderHand();

    if (moves.length === 1 && moves[0].side === "center") {
      // "dominoPlayTile" — Dominoes only.
      socket.emit("dominoPlayTile", { roomCode: currentRoom, tileId, side: "center" });
      hideSidePicker();
      return;
    }

    const sides = new Set(moves.map((m) => m.side));
    if (sides.size === 1) {
      const side = moves[0].side;
      socket.emit("dominoPlayTile", { roomCode: currentRoom, tileId, side });
      hideSidePicker();
      return;
    }

    // Fits both ends — ask which side.
    showSidePicker();
    domMsg.textContent = "This domino fits both ends. Choose a side.";
  }

  function playSelectedSide(side) {
    if (!selectedTileId || !myTurn || gameOver) return;
    socket.emit("dominoPlayTile", {
      roomCode: currentRoom,
      tileId: selectedTileId,
      side
    });
    hideSidePicker();
  }

  function wireControls() {
    if (!domDrawBtn || domDrawBtn.dataset.wired) return;
    domDrawBtn.dataset.wired = "1";
    domDrawBtn.onclick = () => {
      if (!currentRoom || !canDraw || !myTurn || gameOver) return;
      // "dominoDraw" — Dominoes only.
      socket.emit("dominoDraw", { roomCode: currentRoom });
    };
    domPlayLeft.onclick = () => playSelectedSide("left");
    domPlayRight.onclick = () => playSelectedSide("right");
    domPlayAgainBtn.onclick = () => {
      if (!currentRoom || !gameOver) return;
      // "dominoPlayAgain" — Dominoes only.
      socket.emit("dominoPlayAgain", { roomCode: currentRoom });
      domPlayAgainBtn.disabled = true;
      domPlayAgainBtn.textContent = "Waiting for others...";
    };
    if (domScoreToggle) {
      domScoreToggle.onclick = () => setScoreOpen(!scoreOpen);
    }
    wireBoardPan();
  }

  /* ---- Socket ---- */

  function onStarted(data) {
    if (!bindDom()) {
      console.error("Dominoes screen missing from the page.");
      return;
    }
    wireControls();
    gameOver = false;
    selectedTileId = null;
    hideEndUi(false);
    hideSidePicker();
    resetPan();
    applyState(data);
    showDominoScreen();
    requestAnimationFrame(() => {
      fitBoard();
      requestAnimationFrame(fitBoard);
    });
    const lobbyTeams = $("dominoLobbyTeams");
    if (lobbyTeams) lobbyTeams.classList.add("hidden");
    const starter = (data.players || []).find((p) => p.id === data.currentTurnId);
    let msg = (starter ? starter.name : "A player") + " opens with the highest double.";
    if (data.teamMode && data.teammate) {
      msg += " Team mode — your teammate is " + data.teammate.name + ".";
    }
    domMsg.textContent = msg;
  }

  function init(sharedSocket) {
    socket = sharedSocket;

    // "dominoStarted" — Dominoes only.
    socket.on("dominoStarted", onStarted);

    // "dominoState" — Dominoes only.
    socket.on("dominoState", (data) => {
      if (!active && data && data.game === "dominoes") {
        // Late sync if started event was missed.
        if (!bindDom()) return;
        wireControls();
        showDominoScreen();
      }
      if (!active) return;
      const prevHandIds = new Set(hand.map((t) => t.id));
      applyState(data);
      if (data.hand) {
        const drawn = data.hand.find((t) => !prevHandIds.has(t.id));
        if (drawn) renderHand(drawn.id);
      }
      if (data.over && (data.matchScoreboard || data.scores)) {
        showEndUi(data.scores, data.winnerId, null, {
          teamMode: !!data.teamMode,
          teamScores: data.teamScores,
          winnerTeam: data.winnerTeam,
          matchScoreboard: data.matchScoreboard,
          roundPoints: data.roundPoints
        });
      }
    });

    // "dominoPlayed" — Dominoes only.
    socket.on("dominoPlayed", (data) => {
      if (!active) return;
      sfx("playCard");
      if (data.board) board = data.board;
      renderBoard(data.tile && data.tile.id);
      domMsg.textContent = (data.name || "Player") + " played " +
        (data.tile ? data.tile.a + "|" + data.tile.b : "a domino") + ".";
    });

    // "dominoDrawn" — Dominoes only.
    socket.on("dominoDrawn", (data) => {
      if (!active) return;
      sfx("draw");
      if (board) board.boneyardCount = data.boneyardCount;
      if (domBoneyard) domBoneyard.textContent = "Boneyard: " + data.boneyardCount;
      players = players.map((p) => p.id === data.by
        ? Object.assign({}, p, { handCount: data.handCount })
        : p);
      if (teams) {
        ["teamA", "teamB"].forEach((key) => {
          if (!teams[key] || !teams[key].players) return;
          teams[key].players = teams[key].players.map((p) => p.id === data.by
            ? Object.assign({}, p, { handCount: data.handCount })
            : p);
        });
      }
      renderPlayers(lastTurnId);
      flashSeatToast(data.by, "DREW A DOMINO");
      if (data.by !== socket.id) {
        domMsg.textContent = (data.name || "Player") + " drew from the boneyard.";
      } else {
        domMsg.textContent = "You drew a domino.";
      }
    });

    // "dominoPassed" — Dominoes only.
    socket.on("dominoPassed", (data) => {
      if (!active) return;
      sfx("skipTurn");
      flashSeatToast(data.by, "SKIPPED");
      domMsg.textContent = (data.name || "Player") + " passes.";
    });

    // "dominoOver" — Dominoes only.
    socket.on("dominoOver", (data) => {
      if (!active) return;
      sfx("gameOver");
      gameOver = true;
      myTurn = false;
      selectedTileId = null;
      hideSidePicker();
      if (data.teamMode != null) teamMode = !!data.teamMode;
      if (data.teams) teams = data.teams;
      if (data.winnerTeam !== undefined) winnerTeam = data.winnerTeam;
      if (data.teamScores) teamScores = data.teamScores;
      if (data.matchScoreboard) matchScoreboard = data.matchScoreboard;
      if (data.roundPoints != null) roundPoints = data.roundPoints;
      showEndUi(data.scores, data.winnerId, data.message, {
        teamMode: !!data.teamMode,
        teamScores: data.teamScores,
        winnerTeam: data.winnerTeam,
        matchScoreboard: data.matchScoreboard || matchScoreboard,
        roundPoints: data.roundPoints != null ? data.roundPoints : roundPoints
      });
      domTurnIndicator.textContent = "Round Over";
      if (domDrawBtn) domDrawBtn.disabled = true;
      domMsg.textContent = data.message || "Round over.";
    });

    // "dominoPlayAgainWait" — Dominoes only.
    socket.on("dominoPlayAgainWait", () => {
      if (!active || !domPlayAgainBtn) return;
      domPlayAgainBtn.textContent = "Waiting for others...";
    });

    // "dominoReset" — Dominoes only.
    socket.on("dominoReset", () => {
      if (!active) return;
      gameOver = false;
      resetPan();
      // Keep scoreboard visible until the player leaves the lobby.
      hideEndButtons();
      hideSidePicker();
      if (domScoreboard && !domScoreboard.classList.contains("hidden")) {
        const heading = domScoreboard.querySelector("h3");
        if (heading) heading.textContent = "Last round";
      }
      domMsg.textContent = "New round!";
    });

    // "dominoLobbyUpdate" — Dominoes only. Waiting for the lobby to fill.
    socket.on("dominoLobbyUpdate", (data) => {
      const statusEl = $("status");
      const codeEl = $("code");
      if (data && data.room && codeEl) codeEl.textContent = "Lobby Code: " + data.room;
      if (statusEl && data) {
        statusEl.textContent = "Waiting for players (" +
          data.players.length + "/" + data.maxPlayers + ")...";
      }
      if (data && data.room) currentRoom = data.room;
      // Team roster / switcher lives on the lobby screen (index.js also listens).
    });

    socket.on("playerLeft", () => {
      if (!active) return;
      hideDominoScreen();
      currentRoom = null;
      gameOver = false;
    });

    if (bindDom()) wireControls();
  }

  function isActive() {
    return active;
  }

  function showError(msg) {
    if (!active || !domMsg) return false;
    domMsg.textContent = msg;
    return true;
  }

  window.Dominoes = { init, isActive, showError };
})();
