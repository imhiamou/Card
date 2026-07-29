/*
 * English dictionary — Word Chain only.
 * Uses the DWYL word list via an-array-of-english-words.
 * Hidden Hunt never loads or calls this module.
 *
 * Two-letter words are excluded (minimum length 3).
 */
const wordList = require("an-array-of-english-words");

const MIN_WORD_LENGTH = 3;

const VALID_WORDS = new Set(
  wordList
    .map((w) => w.toLowerCase())
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
