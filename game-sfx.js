/* Lightweight Web Audio SFX for Dominoes / UNO (synthesized — no external assets). */
(function () {
  let ctx = null;

  function getCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function resume() {
    const c = getCtx();
    if (c && c.state === "suspended") c.resume().catch(function () {});
  }

  function tone(freq, dur, type, gain, when) {
    const c = getCtx();
    if (!c) return;
    resume();
    const t0 = (when != null ? when : 0) + c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain != null ? gain : 0.08, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, gain) {
    const c = getCtx();
    if (!c) return;
    resume();
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    const g = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    src.buffer = buf;
    g.gain.value = gain != null ? gain : 0.05;
    src.connect(filter);
    filter.connect(g);
    g.connect(c.destination);
    src.start();
  }

  /** Domino / UNO card play. */
  function playCard() {
    noiseBurst(0.045, 0.055);
    tone(220, 0.08, "triangle", 0.06);
    tone(330, 0.06, "sine", 0.035, 0.03);
  }

  /** Domino pass / UNO skip. */
  function skipTurn() {
    tone(420, 0.07, "square", 0.035);
    tone(280, 0.1, "triangle", 0.04, 0.05);
  }

  /** Soft draw / boneyard. */
  function draw() {
    tone(180, 0.05, "sine", 0.03);
  }

  /** Direction reverse. */
  function reverse() {
    tone(360, 0.06, "sawtooth", 0.03);
    tone(520, 0.08, "triangle", 0.035, 0.055);
  }

  /** Round / game over. */
  function gameOver() {
    tone(392, 0.1, "sine", 0.05);
    tone(523, 0.12, "sine", 0.05, 0.1);
    tone(659, 0.16, "sine", 0.045, 0.2);
  }

  // Unlock audio on first user gesture (mobile browsers).
  ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
    window.addEventListener(ev, resume, { once: true, passive: true });
  });

  window.GameSfx = {
    playCard: playCard,
    skipTurn: skipTurn,
    draw: draw,
    reverse: reverse,
    gameOver: gameOver,
    resume: resume
  };
})();
