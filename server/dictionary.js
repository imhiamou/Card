/*
 * English dictionary — Word Chain only.
 * Hidden Hunt never loads or calls this module.
 *
 * Vocabulary: ~21k everyday English words (SCOWL size 10+20+35,
 * frequency-filtered, plus common language names players expect),
 * stored in server/data/common-words.json. Obscure / technical /
 * archaic terms from the old full DWYL list are not included.
 *
 * Two-letter words are excluded (minimum length 3).
 * Lookups stay O(1) via a Set.
 */
const wordList = require("./data/common-words.json");

const MIN_WORD_LENGTH = 3;

const VALID_WORDS = new Set(
  wordList
    .map((w) => String(w).toLowerCase())
    .filter((w) => w.length >= MIN_WORD_LENGTH)
);

function normalizeWord(word) {
  return String(word || "").trim().toLowerCase();
}

function isValidWord(word) {
  const normalized = normalizeWord(word);
  if (!/^[a-z]+$/.test(normalized)) return false;
  if (normalized.length < MIN_WORD_LENGTH) return false;
  return VALID_WORDS.has(normalized);
}

/*
 * Collapse regular English plurals to a shared family key so "dog" and
 * "dogs" (or "box" / "boxes", "baby" / "babies") count as the same used
 * word in Word Chain. Only strips a plural ending when the singular
 * form exists in the dictionary.
 */
function wordFamilyKey(word) {
  const w = normalizeWord(word);
  if (w.length < MIN_WORD_LENGTH) return w;

  const trials = [];
  if (w.length >= 5 && w.endsWith("ies")) {
    trials.push(w.slice(0, -3) + "y");
  }
  if (w.length >= 5 && /(ches|shes|xes|zes|sses)$/.test(w)) {
    trials.push(w.slice(0, -2));
  } else if (w.length >= 5 && w.endsWith("oes")) {
    trials.push(w.slice(0, -2));
  } else if (w.length >= 5 && w.endsWith("ves")) {
    trials.push(w.slice(0, -3) + "f");
    trials.push(w.slice(0, -3) + "fe");
  } else if (w.length >= 4 && w.endsWith("s") && !w.endsWith("ss")) {
    trials.push(w.slice(0, -1));
  }

  for (const singular of trials) {
    if (singular.length >= MIN_WORD_LENGTH && VALID_WORDS.has(singular)) {
      return singular;
    }
  }
  return w;
}

module.exports = { isValidWord, normalizeWord, MIN_WORD_LENGTH, wordFamilyKey };
