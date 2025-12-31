/**
 * Description Helper Utility
 * 
 * Centralizes promotional text detection and description quality scoring.
 * Ensures clean, non-promotional descriptions for series metadata.
 */

const logger = require('./logger');

/**
 * Patterns that indicate promotional/boilerplate text
 */
const PROMOTIONAL_PATTERNS = [
  // HentaiSea patterns
  /^Watch\s+.+?\s+on\s+Hentaisea/i,
  /Hentaisea\.com\s+Subbed\s+for\s+free/i,
  /in\s+Best\s+HD\s+quality\s+and\s+fast\s+servers/i,
  /^Watch\s+.+?\s+Subbed\s+for\s+free/i,
  
  // HentaiMama patterns
  /^Stream\s+.+?\s+Episode\s+\d+/i,
  /^Watch\s+.+?\s+Episode\s+\d+/i,
  /We\s+have\s+thousands\s+of\s+hentai\s+videos/i,
  /Hentaimama\s+have\s+thousands/i,
  /Stream\s+and\s+Download\s+.+?\s+in\s+HD/i,
  /Watch\s+online\s+.+?\s+in\s+HD/i,
  /best\s+quality\s+only\s+at\s+Hentaimama/i,
  
  // HentaiTV patterns
  /^Watch\s+.+?\s+online\s+for\s+free/i,
  /^.+?\s+Episode\s+\d+\s+is:\s*$/i,
  /Watch\s+all\s+\d+\s+episodes?\s+in\s+HD\s+quality/i,
  
  // Generic promotional
  /download\s+for\s+free/i,
  /watch\s+for\s+free/i,
  /best\s+quality\s+streaming/i,
  /streaming\s+in\s+HD/i,
  /subbed\s+and\s+dubbed/i,
  /click\s+here\s+to\s+watch/i,
  /subscribe\s+to\s+our/i,
  /join\s+our\s+discord/i,
  /support\s+us\s+on\s+patreon/i,
];

/**
 * Minimum description length to be considered valid
 */
const MIN_DESCRIPTION_LENGTH = 30;

/**
 * Maximum description length before truncation
 */
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Check if a description is promotional/boilerplate text
 * @param {string} text - Description text to check
 * @returns {boolean} True if promotional
 */
function isPromotionalDescription(text) {
  if (!text || typeof text !== 'string') return true;
  
  const trimmed = text.trim();
  
  // Too short to be meaningful
  if (trimmed.length < MIN_DESCRIPTION_LENGTH) return true;
  
  // Check against promotional patterns
  for (const pattern of PROMOTIONAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  
  // Check for excessive promotional keywords
  const lowerText = trimmed.toLowerCase();
  const promoKeywords = ['hentaisea', 'hentaimama', 'hentai.tv', 'watch online', 'stream free', 'hd quality'];
  const keywordCount = promoKeywords.filter(kw => lowerText.includes(kw)).length;
  
  // If 2+ promotional keywords in a short description, it's probably promotional
  if (keywordCount >= 2 && trimmed.length < 150) {
    return true;
  }
  
  return false;
}

/**
 * Clean and validate a description
 * @param {string} text - Raw description text
 * @returns {string} Cleaned description or "No Description"
 */
function cleanDescription(text) {
  if (!text || typeof text !== 'string') {
    return 'No Description';
  }
  
  let cleaned = text.trim();
  
  // Remove leading "Episode X is:" patterns
  cleaned = cleaned.replace(/^.+?\s+Episode\s+\d+\s+is:\s*/i, '');
  
  // Remove URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, '');
  
  // Remove excessive whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Check if it's promotional after cleaning
  if (isPromotionalDescription(cleaned)) {
    return 'No Description';
  }
  
  // Truncate if too long (at word boundary)
  if (cleaned.length > MAX_DESCRIPTION_LENGTH) {
    cleaned = cleaned.substring(0, MAX_DESCRIPTION_LENGTH);
    const lastSpace = cleaned.lastIndexOf(' ');
    if (lastSpace > MAX_DESCRIPTION_LENGTH - 50) {
      cleaned = cleaned.substring(0, lastSpace);
    }
    cleaned = cleaned.trim() + '...';
  }
  
  return cleaned;
}

/**
 * Calculate a quality score for a description
 * Higher score = better quality description
 * @param {string} text - Description text
 * @returns {number} Quality score (0-100)
 */
function scoreDescription(text) {
  if (!text || typeof text !== 'string') return 0;
  
  const cleaned = text.trim();
  
  // Promotional = 0
  if (isPromotionalDescription(cleaned)) return 0;
  
  let score = 0;
  
  // Length bonus (up to 40 points)
  // Optimal length is 100-300 chars
  if (cleaned.length >= 100) score += 20;
  if (cleaned.length >= 200) score += 10;
  if (cleaned.length >= 300) score += 10;
  if (cleaned.length < 50) score -= 10;
  
  // Starts with capital letter (5 points)
  if (/^[A-Z]/.test(cleaned)) score += 5;
  
  // Contains character names (likely actual synopsis) (15 points)
  // Japanese names often have specific patterns
  if (/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/.test(cleaned)) score += 15;
  
  // Contains plot words (20 points)
  const plotWords = ['story', 'protagonist', 'main character', 'discovers', 'finds', 'becomes', 'must', 'journey', 'adventure', 'relationship'];
  const hasPlotWords = plotWords.some(word => cleaned.toLowerCase().includes(word));
  if (hasPlotWords) score += 20;
  
  // No promotional keywords (10 points)
  const promoKeywords = ['watch', 'stream', 'download', 'free', 'hd', 'subbed'];
  const hasPromoKeywords = promoKeywords.some(kw => cleaned.toLowerCase().includes(kw));
  if (!hasPromoKeywords) score += 10;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Select the best description from multiple sources
 * @param {Object} descriptions - Object mapping provider to description
 * @returns {string} Best description or "No Description"
 */
function selectBestDescription(descriptions) {
  if (!descriptions || typeof descriptions !== 'object') {
    return 'No Description';
  }
  
  // Priority order: HentaiMama > HentaiTV > HentaiSea
  const priorityOrder = ['hmm', 'htv', 'hse'];
  
  let bestDesc = null;
  let bestScore = 0;
  
  // First, try priority order with quality check
  for (const provider of priorityOrder) {
    const desc = descriptions[provider];
    if (desc) {
      const score = scoreDescription(desc);
      if (score > bestScore) {
        bestScore = score;
        bestDesc = desc;
      }
    }
  }
  
  // If we found a valid description, clean and return it
  if (bestDesc && bestScore > 0) {
    return cleanDescription(bestDesc);
  }
  
  return 'No Description';
}

module.exports = {
  isPromotionalDescription,
  cleanDescription,
  scoreDescription,
  selectBestDescription,
  MIN_DESCRIPTION_LENGTH,
  MAX_DESCRIPTION_LENGTH
};
