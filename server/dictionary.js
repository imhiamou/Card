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

module.exports = { isValidWord, normalizeWord, MIN_WORD_LENGTH };
