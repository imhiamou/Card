/*
 * Client rules for the room 1111 strategy inspector.
 * The server still decides whether a snapshot is returned.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DominoInspect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INSPECT_ROOM = "1111";
  const REFRESH_EVENTS = ["dominoState", "dominoPlayed", "dominoPassed", "dominoDrawn"];

  function normalizeRoom(code) {
    return String(code || "").trim().toUpperCase();
  }

  function inspectClick(roomCode, player, openBotId) {
    if (normalizeRoom(roomCode) !== INSPECT_ROOM) return { action: "none" };
    if (!player || !player.isBot) return { action: "none" };
    if (openBotId && openBotId === player.id) return { action: "close" };
    return { action: "open", botId: player.id };
  }

  function onTableEvent(panel, eventName) {
    const state = panel || { open: false, status: "ready", snapshot: null };
    if (!state.open) {
      return { open: false, botId: state.botId || null, status: state.status || "ready", snapshot: state.snapshot || null, error: null };
    }
    if (REFRESH_EVENTS.indexOf(eventName) < 0) return state;
    return beginEvaluation(state);
  }

  function panelFromSnapshot(botId, snapshot) {
    if (!snapshot) {
      return { open: true, botId: botId, status: "evaluating", snapshot: null, error: null };
    }
    const failed = snapshot.status === "error" || snapshot.available === false;
    return {
      open: true,
      botId: botId,
      status: failed ? "error" : "ready",
      snapshot: snapshot,
      error: failed ? (snapshot.error || snapshot.reason || "The decision failed.") : null
    };
  }

  function beginEvaluation(panel) {
    const current = panel || { open: false };
    if (!current.open) return current;
    return {
      open: true,
      botId: current.botId,
      status: "evaluating",
      snapshot: current.snapshot || null,
      error: null
    };
  }

  function completeEvaluation(panel, snapshot) {
    const botId = (snapshot && (snapshot.playerId || snapshot.botId)) || (panel && panel.botId) || null;
    const next = panelFromSnapshot(botId, snapshot);
    if (snapshot && snapshot.lastUpdatedAt && panel && panel.snapshot && panel.snapshot.lastUpdatedAt) {
      if (snapshot.lastUpdatedAt < panel.snapshot.lastUpdatedAt && (panel.snapshot.playerId || panel.snapshot.botId) === botId) {
        return panel;
      }
    }
    return next;
  }

  function failEvaluation(panel, error) {
    return {
      open: true,
      botId: panel && panel.botId,
      status: "error",
      snapshot: panel && panel.snapshot || null,
      error: error || "The decision snapshot was not received."
    };
  }

  function statusText(panel) {
    if (!panel) return "Ready";
    if (panel.status === "thinking" || panel.status === "evaluating") return "Evaluating";
    if (panel.status === "error") return panel.error || "The decision failed.";
    return "Ready";
  }

  function text(value) {
    if (value == null || value === "") return "unavailable";
    return String(value);
  }

  function tileText(tile, side) {
    if (!tile) return "unavailable";
    const face = "[" + tile.a + "|" + tile.b + "]";
    return side ? face + " on the " + side + " end" : face;
  }

  function linesOf(items) {
    if (!items || !items.length) return ["unavailable"];
    return items;
  }

  function renderModel(snapshot) {
    const snap = snapshot && typeof snapshot === "object" ? snapshot : {};
    const selected = snap.selected || (snap.plan && snap.plan.selected) || null;
    const mode = snap.mode || {};
    const plan = snap.plan || {};
    const partnership = snap.partnership || {};
    const opponents = snap.opponents || {};
    const comparison = snap.comparison || {};
    const confidence = snap.confidence || {};
    const players = Array.isArray(snap.players) ? snap.players : [];
    const legalMoves = Array.isArray(snap.legalMoves) ? snap.legalMoves : [];
    const candidates = Array.isArray(snap.candidateEvaluations) ? snap.candidateEvaluations : (snap.scores || []);
    const sections = [];

    sections.push({
      heading: "Legal moves",
      lines: legalMoves.length
        ? legalMoves.map((move) => (move.tileId || "tile") + " on the " + (move.side || "unknown") + " end")
        : ["unavailable"]
    });
    sections.push({
      heading: "Candidate evaluations",
      lines: candidates.length
        ? candidates.map((row) => (row.tileId || "tile") + " on the " + (row.side || "unknown") + " end, score " + text(row.score))
        : ["unavailable"]
    });

    sections.push({
      heading: "Current status",
      lines: [
        "Bot: " + text(snap.botId),
        "Team: " + text(snap.team),
        "Turn: " + text(snap.currentTurnId),
        "Board ends: " + text(snap.leftEnd) + " and " + text(snap.rightEnd),
        "Hands: " + (players.length
          ? players.map((player) => text(player.id) + " " + text(player.handCount)).join(", ")
          : "unavailable"),
        "Strategic mode: " + text(mode.label),
        "Mode reason: " + text(mode.reason),
        "Selected move: " + (selected
          ? tileText(selected.tile, selected.side) + (selected.conditional ? " (conditional). " + text(selected.assumption) : "")
          : "unavailable"),
        "Score: " + text(selected && selected.score),
        "Confidence: " + (confidence.kind === "sample-win-fraction"
          ? text(confidence.value) + " over " + text(confidence.samples) + " samples"
          : "unavailable")
      ]
    });

    const planLines = [];
    if (selected) {
      planLines.push("Selected next move: " + tileText(selected.tile, selected.side) +
        (selected.conditional ? " (conditional). " + text(selected.assumption) : "."));
    }
    (plan.continuation || []).forEach((step) => {
      planLines.push("Preferred continuation (conditional): " + tileText(step.tile, step.side) + ". " + text(step.assumption));
    });
    (plan.alternatives || []).forEach((alt) => {
      const move = alt.move || alt;
      planLines.push("Alternative line (conditional): " + tileText(move.tile, move.side) + ".");
    });
    if (plan.note) planLines.push(plan.note);
    sections.push({ heading: "Planned tile sequence", lines: linesOf(planLines) });

    const partnerLines = [];
    if (partnership.available === false) {
      partnerLines.push(text(partnership.reason));
    } else if (!partnership.playerId && partnership.available !== true) {
      partnerLines.push("unavailable");
    } else {
      partnerLines.push("Teammate: " + text(partnership.playerId) + ", tiles remaining " + text(partnership.handCount) + ".");
      (partnership.strong || []).forEach((note) => {
        partnerLines.push("Number " + note.pip + ": strong inferred support. Confidence: " + text(note.confidence) + ".");
      });
      (partnership.provenVoids || []).forEach((note) => {
        partnerLines.push("Number " + note.pip + ": proven void from a pass.");
      });
      (partnership.suspectedWeak || []).forEach((note) => {
        partnerLines.push("Number " + note.pip + ": probabilistic weakness, not a proven void.");
      });
      partnerLines.push("Preserves teammate numbers: " + ((partnership.preserves && partnership.preserves.length) ? partnership.preserves.join(", ") : "none recorded") + ".");
      partnerLines.push(text(partnership.helpNote));
    }
    sections.push({ heading: "Partnership analysis", lines: linesOf(partnerLines) });

    const opponentLines = [];
    (opponents.opponents || []).forEach((row) => {
      const proven = (row.provenVoids || []).map((note) => note.pip).join(", ") || "none";
      const weak = (row.suspectedWeak || []).map((note) => note.pip).join(", ") || "none";
      opponentLines.push(text(row.playerId) + ": proven voids " + proven + "; probabilistic weaknesses " + weak + ".");
    });
    if (opponents.mostDangerous) opponentLines.push("Most dangerous opponent: " + opponents.mostDangerous + ".");
    opponentLines.push("Forces a pass: " + (opponents.forcesPass ? "yes" : "no") + ".");
    opponentLines.push("Denies a likely winning response: " + (opponents.deniesWin ? "yes" : "no") + ".");
    if (!opponentLines.length) opponentLines.push("unavailable");
    sections.push({ heading: "Opponent analysis", lines: opponentLines });

    const why = (snap.components || []).map((part) => {
      return part.label + ": " + text(part.sign) + (part.value == null ? "" : " (" + part.value + ")");
    });
    if (snap.alternative) {
      why.push("Strongest alternative: " + tileText(snap.alternative.tile, snap.alternative.side) + " scored " + text(snap.alternative.score) + ".");
    }
    sections.push({ heading: "Why this move was selected", lines: linesOf(why) });

    sections.push({
      heading: "Winning override",
      lines: [text(comparison.text)]
    });

    const header = snap.status === "error" || snap.available === false
      ? (snap.error || snap.reason || "The decision failed.")
      : (snap.status === "evaluating" || snap.status === "thinking" ? "Evaluating" : "Ready");
    return {
      status: header,
      sections: sections
    };
  }

  return {
    INSPECT_ROOM: INSPECT_ROOM,
    normalizeRoom: normalizeRoom,
    inspectClick: inspectClick,
    onTableEvent: onTableEvent,
    panelFromSnapshot: panelFromSnapshot,
    beginEvaluation: beginEvaluation,
    completeEvaluation: completeEvaluation,
    failEvaluation: failEvaluation,
    statusText: statusText,
    renderModel: renderModel
  };
});
