/*
 * English dictionary — Word Chain only.
 * Uses the DWYL word list via an-array-of-english-words.
 * Hidden Hunt never loads or calls this module.
 */
const wordList = require("an-array-of-english-words");

const VALID_WORDS = new Set(wordList.map((w) => w.toLowerCase()));

function normalizeWord(word) {
  return String(word || "").trim().toLowerCase();
}

function isValidWord(word) {
  const normalized = normalizeWord(word);
  if (!/^[a-z]+$/.test(normalized)) return false;
  return VALID_WORDS.has(normalized);
}

module.exports = { isValidWord, normalizeWord };
