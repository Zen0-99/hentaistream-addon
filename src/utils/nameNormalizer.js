/**
 * Name normalization utilities for matching provider titles to MAL
 */

/**
 * Normalize a series name for matching
 * @param {string} name - Series name
 * @returns {string} - Normalized name
 */
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[:\-–—]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Normalize spaces
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Distance
 */
function levenshteinDistance(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity percentage between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Similarity (0-100)
 */
function similarity(a, b) {
  const normA = normalize(a);
  const normB = normalize(b);
  
  if (normA === normB) return 100;
  
  const distance = levenshteinDistance(normA, normB);
  const maxLength = Math.max(normA.length, normB.length);
  
  if (maxLength === 0) return 100;
  
  return Math.round(((maxLength - distance) / maxLength) * 100);
}

/**
 * Check if two series names are likely the same
 * @param {string} name1 - First series name
 * @param {string} name2 - Second series name
 * @param {number} threshold - Similarity threshold (default: 90)
 * @returns {boolean} - Whether names match
 */
function isMatch(name1, name2, threshold = 90) {
  return similarity(name1, name2) >= threshold;
}

module.exports = {
  normalize,
  similarity,
  isMatch,
  levenshteinDistance
};
