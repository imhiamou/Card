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
    if (!panel) return "";
    if (panel.status === "thinking" || panel.status === "evaluating") {
      return panel.snapshot
        ? "Thinking. Showing the last completed plan."
        : "Thinking. I am still evaluating the available moves.";
    }
    if (panel.status === "error") return panel.error || "The decision failed.";
    return "";
  }

  const STRATEGIES = {
    "Going for the win": ["Playing for myself", "I am trying to empty my hand and win."],
    "Supporting teammate": ["Helping my teammate", "I am trying to give my teammate better moves."],
    "Blocking opponents": ["Blocking opponents", "I am trying to leave numbers my opponents probably cannot play."],
    "Controlling the board": ["Controlling the board", "I am trying to keep the open ends favorable for my team."],
    "Winning the block": ["Playing for a block", "I am trying to create a blocked round that favors my team."],
    "Defensive recovery": ["Defending", "I am trying to reduce our chances of losing."],
    "Establishing a number": ["Controlling the board", "I am trying to keep the open ends favorable for my team."]
  };

  function text(value) {
    if (value == null || value === "") return "unavailable";
    return String(value);
  }

  function face(tile) {
    if (!tile || tile.a == null || tile.b == null) return null;
    return "[" + tile.a + "|" + tile.b + "]";
  }

  function tileText(tile, side) {
    const label = face(tile);
    if (!label) return "unavailable";
    return side ? label + " on the " + side + " end" : label;
  }

  function linesOf(items) {
    if (!items || !items.length) return ["unavailable"];
    return items;
  }

  function joinPips(list) {
    const pips = [];
    (list || []).forEach((item) => {
      const pip = item && typeof item === "object" ? item.pip : item;
      if (pip == null || pips.indexOf(pip) >= 0) return;
      pips.push(pip);
    });
    if (!pips.length) return "";
    if (pips.length === 1) return String(pips[0]);
    if (pips.length === 2) return pips[0] + " and " + pips[1];
    return pips.slice(0, -1).join(", ") + ", and " + pips[pips.length - 1];
  }

  function selectedMove(snap) {
    if (!snap) return null;
    return snap.selected || snap.selectedMove || (snap.plan && snap.plan.selected) || null;
  }

  function matchedEnd(snap, selected) {
    if (!selected) return null;
    if (selected.side === "left") return snap.leftEnd;
    if (selected.side === "right") return snap.rightEnd;
    return null;
  }

  function openPip(snap, selected) {
    const tile = selected && selected.tile;
    const end = matchedEnd(snap, selected);
    if (!tile || end == null) return null;
    if (tile.a === end) return tile.b;
    if (tile.b === end) return tile.a;
    return null;
  }

  function opponentFacts(snap) {
    const rows = (snap.opponents && snap.opponents.opponents) || [];
    const proven = [];
    const weak = [];
    rows.forEach((row) => {
      (row.provenVoids || []).forEach((note) => {
        if (proven.indexOf(note.pip) < 0) proven.push(note.pip);
      });
      (row.suspectedWeak || []).forEach((note) => {
        if (weak.indexOf(note.pip) < 0) weak.push(note.pip);
      });
    });
    return {
      proven: proven,
      weak: weak,
      forcesPass: !!(snap.opponents && snap.opponents.forcesPass),
      deniesWin: !!(snap.opponents && snap.opponents.deniesWin)
    };
  }

  function strategyFor(mode, calculating) {
    if (calculating && (!mode || !mode.label)) {
      return { label: "Thinking", aim: "I am still evaluating the available moves." };
    }
    const known = mode && STRATEGIES[mode.label];
    if (known) return { label: known[0], aim: known[1] };
    if (calculating) return { label: "Thinking", aim: "I am still evaluating the available moves." };
    return { label: "Best legal move", aim: "I am choosing the highest ranked legal play." };
  }

  function teammateSentence(snap, selected, open, tileFace) {
    const partnership = snap.partnership || {};
    const voids = (partnership.provenVoids || []).map((note) => note.pip);
    const kept = partnership.preserves || [];
    if (open != null && voids.indexOf(open) >= 0) {
      return "My teammate has passed on " + joinPips(voids) + ". I am not treating " + open + " as a number they can play.";
    }
    if (kept.length && tileFace) {
      return "I want to play " + tileFace + (open != null ? " and keep " + open + " open" : "") +
        " because I believe my teammate can use it.";
    }
    if (voids.length) {
      return "My teammate has passed on " + joinPips(voids) + ", so I am trying to avoid leaving those numbers open for them.";
    }
    if (partnership.helpsEmpty) return "I am leaving ends my teammate is more likely to be able to play.";
    if (typeof partnership.replyProbability === "number" && partnership.replyProbability >= 0.5 && open != null) {
      return "I am keeping " + open + " open because my teammate looks able to answer it.";
    }
    return "I am trying to give my teammate better moves.";
  }

  function opponentSentence(snap, open, parts, mode) {
    const facts = opponentFacts(snap);
    if (open != null && facts.proven.indexOf(open) >= 0) {
      return "I am trying to leave " + open + " open because an opponent previously passed on it.";
    }
    if (parts.oppOut < 0 || facts.deniesWin) return "I am avoiding a move that could let an opponent finish.";
    if (parts.forcePass > 0 || facts.forcesPass) return "I am trying to leave a number the next opponent probably cannot play.";
    if (open != null && facts.weak.indexOf(open) >= 0) {
      return "I am trying to leave " + open + " open. An opponent may be weak there, but that is not a proven pass.";
    }
    if (facts.proven.length) {
      return "Opponents have passed on " + joinPips(facts.proven) + ", so I am trying not to feed them a number they can use.";
    }
    if (mode && mode.label === "Blocking opponents") {
      return "I am trying to leave numbers my opponents probably cannot play.";
    }
    if (mode && mode.label === "Defensive recovery") return "I am trying to reduce our chances of losing.";
    return "I do not have an opponent tactic for this move yet.";
  }

  function objectives(snap, selected, mode) {
    const lines = [];
    const parts = (selected && selected.parts) || {};
    const tileFace = selected && selected.tile ? face(selected.tile) : null;
    const open = openPip(snap, selected);
    const kind = snap.comparison && snap.comparison.kind;
    if (parts.immediateWin > 0 && tileFace) {
      lines.push("Playing " + tileFace + " empties my hand, so I am prioritizing my own finish.");
    } else if (kind === "own-finish") {
      lines.push("I have a good chance to empty my hand, so I am prioritizing my own finish.");
    }
    if (kind === "partnership" || (mode && mode.label === "Supporting teammate")) {
      lines.push(teammateSentence(snap, selected, open, tileFace));
    } else if (mode && (mode.label === "Blocking opponents" || mode.label === "Defensive recovery")) {
      lines.push(opponentSentence(snap, open, parts, mode));
    } else if (mode && mode.label === "Controlling the board" && open != null && tileFace) {
      lines.push("I want to play " + tileFace + " and keep " + open + " open so I still have a follow-up.");
    } else if (mode && mode.label === "Winning the block") {
      lines.push("I am trying to create a blocked round that favors my team.");
    } else if (mode && mode.label === "Going for the win" && !lines.length && tileFace) {
      lines.push("I am playing " + tileFace + " to get closer to emptying my hand.");
    }
    if (!lines.length && tileFace) lines.push("I am playing " + tileFace + " because it is the highest ranked legal move.");
    if (!lines.length && selected && selected.side) {
      lines.push("I selected a move on the " + selected.side + " end using the strategic plan and public probabilities.");
    }
    if (!lines.length) lines.push("I do not have a recorded objective for this position yet.");
    return lines.slice(0, 2);
  }

  function nextMoveLine(snap, selected, calculating, error) {
    if (!selected || (!selected.tile && !selected.side)) {
      if (calculating) return "Calculating next move...";
      if (error) return error;
      return "No move has been selected.";
    }
    if (!selected.tile) {
      return "Selected action: play on the " + selected.side + " end. Tile identity is withheld from client diagnostics.";
    }
    const label = face(selected.tile);
    let line = "Next move: \"" + label + "\"";
    if (selected.side === "center") line += " → open the board";
    else if (selected.side === "left" || selected.side === "right") {
      const end = matchedEnd(snap, selected);
      line += end == null ? " → the " + selected.side + " end" : " → play on \"" + end + "\"";
    }
    if (selected.conditional) line += ". This can change before it is my turn.";
    return line;
  }

  function continuationLines(snap, selected, calculating) {
    const steps = (snap.plan && snap.plan.continuation) || snap.plannedContinuation || [];
    if (!selected || !selected.tile) {
      return [calculating ? "Calculating next move..." : "I am choosing one move at a time."];
    }
    if (!steps.length) return ["I am choosing one move at a time."];
    const lines = ["This follow-up only holds if nobody else changes the ends."];
    lines.push("1. Play " + face(selected.tile) + ".");
    const open = openPip(snap, selected);
    let number = 2;
    if (open != null) {
      lines.push(number + ". Try to keep \"" + open + "\" open.");
      number += 1;
    }
    steps.forEach((step) => {
      lines.push(number + ". Then " + (face(step.tile) || "the next tile") + " if the ends stay the same.");
      number += 1;
    });
    return lines;
  }

  function helpLevel(snap, mode) {
    const partnership = snap.partnership || {};
    if (partnership.available === false) return "No";
    const kind = snap.comparison && snap.comparison.kind;
    const label = mode && mode.label;
    if (kind === "own-finish" || label === "Going for the win") return "No";
    if (kind === "partnership" || label === "Supporting teammate") return "Yes";
    const parts = (selectedMove(snap) && selectedMove(snap).parts) || {};
    if ((parts.mateReply || 0) + (parts.mateSuit || 0) > 0) return "Partly";
    return "No";
  }

  function teammateBlock(snap, selected, mode) {
    const partnership = snap.partnership || {};
    if (!selected && partnership.available !== true && partnership.available !== false) {
      return { help: "No", number: "None", reason: "No teammate information yet." };
    }
    const help = helpLevel(snap, mode);
    const open = openPip(snap, selected);
    const kept = partnership.preserves || [];
    let number = "None";
    if ((help === "Yes" || help === "Partly") && kept.length) number = String(kept[0]);
    else if (help === "Yes" && open != null) number = String(open);
    let reason = "This move is not mainly for my teammate.";
    if (partnership.available === false) reason = partnership.reason || "This table has no teammate.";
    else if (help === "No" && (snap.comparison && snap.comparison.kind) === "own-finish") {
      reason = "I am prioritizing my own finish over a move that would help my teammate more.";
    } else if (help === "No" && mode && mode.label === "Going for the win") {
      reason = "Emptying my hand comes first.";
    } else if (help === "Yes") {
      reason = teammateSentence(snap, selected, open, selected && selected.tile ? face(selected.tile) : null);
    } else if (help === "Partly") {
      reason = "The move helps my teammate some, but that is not the main reason I chose it.";
    }
    return {
      help: help,
      number: number,
      reason: reason
    };
  }

  function opponentBlock(snap, selected, mode) {
    const facts = opponentFacts(snap);
    const open = openPip(snap, selected);
    const parts = (selected && selected.parts) || {};
    let lacks = "No proven pass yet.";
    if (facts.proven.length) lacks = "Passed on " + joinPips(facts.proven) + ".";
    else if (facts.weak.length) lacks = "No proven gap. Might be weak on " + joinPips(facts.weak) + ", which is not a proven pass.";
    let exploit = "None";
    if (open != null && facts.proven.indexOf(open) >= 0) exploit = String(open);
    else if (open != null && facts.weak.indexOf(open) >= 0) exploit = open + " (not proven)";
    return {
      lacks: lacks,
      exploit: exploit,
      tactic: opponentSentence(snap, open, parts, mode)
    };
  }

  function whyBlock(snap, selected, mode, help) {
    const parts = (selected && selected.parts) || {};
    const ranked = [
      ["immediateWin", "Gives me a strong chance to finish."],
      ["pointBonus", "Picks up points from the tiles still out."],
      ["forcePass", "Can force a pass."],
      ["mateReply", "Gives my teammate a better chance to play."],
      ["mateSuit", "Keeps a number my teammate seems to hold."],
      ["ownOuts", "Leaves me more ways to play next."],
      ["stuckDouble", "Keeps a double from getting stuck."],
      ["shedPips", "Gets a heavier tile out of my hand."],
      ["dumpDouble", "Gets a double out of my hand."],
      ["blockEquity", "Moves a blocked round in our favor."],
      ["intentKeep", "Keeps a number my teammate has been choosing."],
      ["mateFinish", "Gives my teammate a chance to finish."],
      ["oppVoidExploit", "Leaves a number an opponent has passed on."],
      ["oppFeed", "Avoids handing an opponent their number."]
    ];
    let advantage = null;
    let best = 0;
    ranked.forEach((entry) => {
      const value = parts[entry[0]];
      if (typeof value === "number" && value > best) {
        best = value;
        advantage = entry[1];
      }
    });
    if (!advantage) {
      advantage = selected && selected.tile
        ? "This is the highest ranked legal play."
        : "No advantage has been recorded.";
    }
    const reply = snap.partnership && snap.partnership.replyProbability;
    let risk = null;
    if (typeof reply === "number" && reply < 0.4 && help !== "Yes") {
      risk = "My teammate might not be able to play the resulting end.";
    } else if (parts.oppOut < 0) {
      risk = "An opponent might still be able to finish.";
    } else if (typeof parts.blockEquity === "number" && parts.blockEquity < 0) {
      risk = "A blocked round may not favor our team.";
    } else if (parts.denyNext < 0 && (!mode || mode.label !== "Blocking opponents")) {
      risk = "The next opponent may still have an answer.";
    }
    return { advantage: advantage, risk: risk };
  }

  function advancedSections(snap) {
    const selected = selectedMove(snap);
    const mode = snap.mode || snap.strategicMode || {};
    const plan = snap.plan || {};
    const partnership = snap.partnership || snap.teammateAnalysis || {};
    const opponents = snap.opponents || snap.opponentAnalysis || {};
    const comparison = snap.comparison || {};
    const confidence = snap.confidence || {};
    const players = Array.isArray(snap.players) ? snap.players : [];
    const legalMoves = Array.isArray(snap.legalMoves) ? snap.legalMoves : [];
    const candidates = Array.isArray(snap.candidateEvaluations) ? snap.candidateEvaluations : (snap.scores || []);
    const search = snap.searchStats || {};
    const sections = [];
    if (snap.historyConsistency) {
      const consistency = snap.historyConsistency;
      sections.push({
        heading: "History consistency",
        lines: consistency.contradictionCount
          ? ["Contradictory public-history events: " + consistency.contradictionCount].concat(
              (consistency.contradictions || []).map((item) =>
                "Player " + text(item.playerId) + " played a tile containing " + text(item.number) +
                " after a no-draw pass ruled that number out (history index " + text(item.moveIndex) + ")."
              )
            )
          : ["No contradictions found in the recorded pass/play history."]
      });
    }
    if (snap.inventory && Array.isArray(snap.inventory.byPip)) {
      sections.push({
        heading: "Tile counts",
        lines: snap.inventory.byPip.map((row) => {
          return row.pip + ": in hand " + row.inHand + ", played " + row.played + ", unseen " + row.unseen;
        })
      });
    }
    if (snap.summary && snap.summary.teammateIntention) {
      const intent = snap.summary.teammateIntention;
      sections.push({
        heading: "Teammate intention",
        lines: [
          "Preferred number: " + text(intent.preferred),
          "Confidence: " + text(intent.confidence),
          "Last move likely forced: " + (intent.lastMoveForced ? "yes" : "no")
        ].concat((intent.byPip || []).reduce((lines, row, pip) => {
          if (!(row.confidence || row.deliberate || row.forced || row.changedAway)) return lines;
          lines.push("Number " + pip + ": chance " + text(row.pAtLeastOne) +
            ", deliberate " + text(row.deliberate) + ", forced " + text(row.forced) +
            ", changed away " + text(row.changedAway));
          return lines;
        }, []))
      });
    }
    sections.push({
      heading: "Candidate moves",
      lines: candidates.length
        ? candidates.map((row) => (row.tileId || "tile") + " on the " + (row.side || "unknown") + " end, score " + text(row.score))
        : ["unavailable"]
    });
    sections.push({
      heading: "Legal moves",
      lines: legalMoves.length
        ? legalMoves.map((move) => (move.tileId || "tile") + " on the " + (move.side || "unknown") + " end")
        : ["unavailable"]
    });
    sections.push({
      heading: "Evaluation components",
      lines: linesOf((snap.components || []).map((part) => {
        return part.label + ": " + text(part.sign) + (part.value == null ? "" : " (" + part.value + ")");
      }))
    });
    sections.push({
      heading: "Search statistics",
      lines: [
        "Stage: " + text(search.stage || snap.stage),
        "Samples: " + text(search.samples != null ? search.samples : snap.samples),
        "Conflicts: " + text(search.conflicts != null ? search.conflicts : snap.conflicts),
        "Nodes: " + text(search.nodes != null ? search.nodes : snap.nodes),
        "Time: " + text(search.ms != null ? search.ms : snap.ms) + " ms",
        "Interrupted: " + (search.interrupted ? "yes" : "no"),
        "Confidence: " + (confidence.kind === "sample-win-fraction"
          ? text(confidence.value) + " over " + text(confidence.samples) + " samples"
          : "unavailable")
      ]
    });
    sections.push({
      heading: "Recorded position",
      lines: [
        "Bot: " + text(snap.playerId || snap.botId),
        "Team: " + text(snap.teamId || snap.team),
        "Turn: " + text(snap.currentTurnId),
        "Board ends: " + text(snap.leftEnd) + " and " + text(snap.rightEnd),
        "Hands: " + (players.length
          ? players.map((player) => text(player.id) + " " + text(player.handCount)).join(", ")
          : "unavailable"),
        "Recorded mode: " + text(mode.label),
        "Mode reason: " + text(mode.reason),
        "Selected move: " + (selected ? tileText(selected.tile, selected.side) : "unavailable"),
        "Score: " + text(selected && selected.score)
      ]
    });
    const planLines = [];
    (plan.continuation || snap.plannedContinuation || []).forEach((step) => {
      planLines.push("Conditional follow-up: " + tileText(step.tile, step.side) + ". " + text(step.assumption));
    });
    (plan.alternatives || []).forEach((alt) => {
      const move = alt.move || alt;
      planLines.push("Alternative: " + tileText(move.tile, move.side) + " scored " + text(move.score) + ".");
    });
    if (snap.alternative) {
      planLines.push("Strongest alternative: " + tileText(snap.alternative.tile, snap.alternative.side) + " scored " + text(snap.alternative.score) + ".");
    }
    if (plan.note) planLines.push(plan.note);
    sections.push({ heading: "Alternative moves", lines: linesOf(planLines) });
    const partnerLines = [];
    if (partnership.available === false) partnerLines.push(text(partnership.reason));
    else if (!partnership.playerId && partnership.available !== true) partnerLines.push("unavailable");
    else {
      partnerLines.push("Teammate: " + text(partnership.playerId) + ", tiles remaining " + text(partnership.handCount) + ".");
      (partnership.provenVoids || []).forEach((note) => partnerLines.push("Passed on " + note.pip + " (proven)."));
      (partnership.suspectedWeak || []).forEach((note) => partnerLines.push("Weak on " + note.pip + " (not proven)."));
      (partnership.strong || []).forEach((note) => partnerLines.push("Number " + note.pip + " looks strong. Confidence: " + text(note.confidence) + "."));
      partnerLines.push("Preserves: " + ((partnership.preserves && partnership.preserves.length) ? partnership.preserves.join(", ") : "none") + ".");
      partnerLines.push(text(partnership.helpNote));
    }
    sections.push({ heading: "Partnership beliefs", lines: linesOf(partnerLines) });
    const opponentLines = [];
    (opponents.opponents || []).forEach((row) => {
      const proven = (row.provenVoids || []).map((note) => note.pip).join(", ") || "none";
      const weak = (row.suspectedWeak || []).map((note) => note.pip).join(", ") || "none";
      opponentLines.push(text(row.playerId) + ": proven gaps " + proven + "; uncertain gaps " + weak + ".");
    });
    if (opponents.mostDangerous) opponentLines.push("Most dangerous opponent: " + opponents.mostDangerous + ".");
    opponentLines.push("Forces a pass: " + (opponents.forcesPass ? "yes" : "no") + ".");
    opponentLines.push("Denies a likely winning response: " + (opponents.deniesWin ? "yes" : "no") + ".");
    sections.push({ heading: "Opponent beliefs", lines: linesOf(opponentLines) });
    sections.push({
      heading: "Detailed reasoning",
      lines: [text(comparison.text || snap.reasoning)]
    });
    return sections;
  }

  function planView(snapshot, options) {
    const opts = options || {};
    const calculating = opts.status === "evaluating" || opts.status === "thinking";
    const snap = snapshot && typeof snapshot === "object" ? snapshot : {};
    const failed = snap.status === "error" || snap.available === false;
    const error = opts.error || (failed ? (snap.error || snap.reason || "The decision failed.") : null);
    const selected = selectedMove(snap);
    const mode = snap.mode || snap.strategicMode || {};
    const recorded = strategyFor(selected ? mode : null, false);
    const strategy = calculating
      ? { label: "Thinking", aim: "I am still evaluating the available moves." }
      : recorded;
    const teammate = teammateBlock(snap, selected, mode);
    const opponents = opponentBlock(snap, selected, mode);
    const why = whyBlock(snap, selected, mode, teammate.help);
    const summary = snap.summary || {};
    if (summary.risk) why.risk = summary.risk;
    const objective = [];
    if (summary.noticed) objective.push(summary.noticed);
    if (selected) objectives(snap, selected, mode).forEach((line) => objective.push(line));
    else if (!objective.length) {
      objective.push(calculating
        ? "I am still evaluating the available moves."
        : "I do not have a recorded objective for this position yet.");
    }
    const expectation = summary.expect ? [summary.expect] : [];
    const sections = [];
    sections.push({
      heading: "Bot's Plan",
      lines: [strategy.label + ". " + strategy.aim]
    });
    if (calculating && selected) {
      sections.push({
        heading: "Last completed plan",
        lines: [recorded.label + ". " + recorded.aim]
      });
    }
    sections.push({ heading: "What I am looking for", lines: objective });
    sections.push({ heading: "Next move", lines: [nextMoveLine(snap, selected, calculating, error)] });
    sections.push({
      heading: "What happens next",
      lines: expectation.concat(continuationLines(snap, selected, calculating))
    });
    sections.push({
      heading: "Teammate",
      lines: [
        "Helping teammate: " + teammate.help + ".",
        "Useful number: " + teammate.number + ".",
        teammate.reason
      ]
    });
    sections.push({
      heading: "Opponents",
      lines: [
        "Known gaps: " + opponents.lacks,
        "Number to use: " + opponents.exploit + ".",
        opponents.tactic
      ]
    });
    const whyLines = ["Advantage: " + why.advantage];
    if (why.risk) whyLines.push("Risk: " + why.risk);
    sections.push({ heading: "Why this move", lines: whyLines });
    const nextTurn = snap.nextTurn || {};
    const nextLines = (nextTurn.lines && nextTurn.lines.length)
      ? nextTurn.lines
      : ["No intervening turns were simulated for this decision."];
    const committed = snap.strategy || {};
    const planLines = committed.lines && committed.lines.length
      ? committed.lines
      : ["No committed number plan was recorded for this decision."];
    sections.push({ heading: "Strategic plan", lines: planLines });
    sections.push({ heading: "Next turn prediction", lines: nextLines });
    const advanced = advancedSections(snap);
    sections.push({ heading: "Advanced details", advanced: true, sections: advanced, lines: [] });
    const header = error
      ? error
      : (calculating ? "Thinking" : strategy.label);
    return {
      status: header,
      calculating: calculating,
      error: error,
      strategy: strategy,
      sections: sections,
      advanced: advanced
    };
  }

  function renderModel(snapshot, options) {
    try {
      return planView(snapshot, options);
    } catch (err) {
      return {
        status: "The diagnostic snapshot could not be shown.",
        calculating: false,
        error: "The diagnostic snapshot could not be shown.",
        strategy: { label: "Best legal move", aim: "I am choosing the highest ranked legal play." },
        sections: [{ heading: "Why this move", lines: ["The diagnostic snapshot could not be shown."] }],
        advanced: []
      };
    }
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
    planView: planView,
    renderModel: renderModel
  };
});
