/*
 * English dictionary service — validates words for Word Chain.
 * Uses the an-array-of-english-words package (loaded once at startup).
 */
const wordList = require("an-array-of-english-words");

const VALID_WORDS = new Set(
  wordList.map((w) => w.toLowerCase())
);

// Returns true when `word` is a known English dictionary word.
function isValidWord(word) {
  if (!word || typeof word !== "string") return false;
  const normalized = word.trim().toLowerCase();
  if (!/^[a-z]+$/.test(normalized)) return false;
  return VALID_WORDS.has(normalized);
}

function normalizeWord(word) {
  return word.trim().toLowerCase();
}

module.exports = { isValidWord, normalizeWord };
