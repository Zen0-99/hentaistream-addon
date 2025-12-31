/**
 * Rating Normalizer Utility
 * 
 * Priority-based rating system:
 * 1. HentaiMama (direct user ratings) - PRIMARY, always use if available AND has enough votes
 * 2. HentaiTV (view-based ratings) - SECONDARY fallback
 * 3. HentaiSea (trending position) - TERTIARY fallback
 * 4. "N/A" if no rating from any source or insufficient votes
 */

const logger = require('./logger');

// Configuration
const CONFIG = {
  // Minimum view threshold for view-based ratings to be valid
  VIEW_THRESHOLD: 1000,
  
  // Minimum vote count for direct ratings to be valid
  // If a rating has fewer than this many votes, show N/A
  MIN_VOTE_COUNT: 10,
  
  // View count to rating conversion (logarithmic scale)
  VIEWS: {
    multiplier: 1.5,
    maxValue: 7.5,  // Cap view-based ratings
    logBase: 10
  },
  
  // Trending rating cap (position-based, not user ratings)
  TRENDING_MAX: 7.0,
  
  // Provider priority order (first with valid rating wins)
  PRIORITY_ORDER: ['hmm', 'htv', 'hse']
};

/**
 * Normalize a direct rating (0-10 scale)
 * @param {number} rating - Direct rating value
 * @returns {number|null} Normalized rating (0-10) or null if invalid
 */
function normalizeDirectRating(rating) {
  if (typeof rating !== 'number' || isNaN(rating)) {
    return null;
  }
  // Clamp to 0-10 range
  return Math.max(0, Math.min(10, rating));
}

/**
 * Normalize view count to a rating
 * Uses logarithmic scale: more views = higher rating
 * 
 * @param {number} views - View count
 * @returns {number|null} Normalized rating or null if below threshold
 */
function normalizeViewCount(views) {
  if (typeof views !== 'number' || isNaN(views) || views < 0) {
    return null;
  }
  
  // Below threshold = no valid rating
  if (views < CONFIG.VIEW_THRESHOLD) {
    return null;
  }
  
  // Logarithmic scaling: log10(views) * multiplier, capped
  const normalized = Math.min(
    CONFIG.VIEWS.maxValue,
    Math.log10(views + 1) * CONFIG.VIEWS.multiplier
  );
  
  return Math.round(normalized * 10) / 10;
}

/**
 * Normalize a rating based on its type
 * @param {number} value - Raw rating/view value
 * @param {string} type - Type of rating: 'direct', 'views', 'trending'
 * @returns {number|null} Normalized rating (0-10) or null if invalid
 */
function normalizeRating(value, type = 'direct') {
  switch (type) {
    case 'direct':
      return normalizeDirectRating(value);
    
    case 'views':
      return normalizeViewCount(value);
    
    case 'trending':
      // Trending position converted to a rating, capped
      if (typeof value !== 'number' || isNaN(value)) return null;
      return Math.min(CONFIG.TRENDING_MAX, normalizeDirectRating(value));
    
    default:
      return normalizeDirectRating(value);
  }
}

/**
 * Get priority-based rating from rating breakdown
 * 
 * Priority order:
 * 1. HentaiMama direct rating (if available AND has enough votes)
 * 2. HentaiTV view-based rating (if views >= threshold)
 * 3. HentaiSea trending rating (fallback)
 * 4. null if no valid rating from any source
 * 
 * @param {Object} ratingBreakdown - Map of provider prefix to rating info
 * @param {number} voteCount - Optional vote count for direct ratings
 * @returns {Object} { rating: number|null, source: string|null, isNA: boolean }
 */
function getPriorityRating(ratingBreakdown, voteCount = null) {
  if (!ratingBreakdown || typeof ratingBreakdown !== 'object') {
    return { rating: null, source: null, isNA: true };
  }
  
  // Try each provider in priority order
  for (const provider of CONFIG.PRIORITY_ORDER) {
    const ratingInfo = ratingBreakdown[provider];
    if (!ratingInfo) continue;
    
    const raw = ratingInfo.raw;
    const type = ratingInfo.type || 'direct';
    const votes = ratingInfo.voteCount || voteCount;
    
    if (raw === null || raw === undefined) continue;
    
    // For direct ratings, require minimum vote count
    // This prevents showing ratings based on 1-2 votes as if they're reliable
    if (type === 'direct' && votes !== null && votes !== undefined) {
      if (votes < CONFIG.MIN_VOTE_COUNT) {
        logger.debug(`[RatingNormalizer] Skipping ${provider} rating (only ${votes} votes, need ${CONFIG.MIN_VOTE_COUNT})`);
        continue; // Skip this provider, try next
      }
    }
    
    // Normalize based on type
    let normalized;
    if (type === 'views') {
      normalized = normalizeViewCount(raw);
    } else if (type === 'trending') {
      normalized = Math.min(CONFIG.TRENDING_MAX, normalizeDirectRating(raw));
    } else {
      normalized = normalizeDirectRating(raw);
    }
    
    // If we got a valid rating from this provider, use it
    if (normalized !== null && normalized !== undefined) {
      return { 
        rating: normalized, 
        source: provider,
        isNA: false
      };
    }
  }
  
  // No valid rating from any source
  return { rating: null, source: null, isNA: true };
}

/**
 * Create a rating breakdown object for a series
 * @param {Object} ratings - Map of provider prefix to raw rating data
 * @returns {Object} Rating breakdown with raw, normalized values, and type
 */
function createRatingBreakdown(ratings) {
  const breakdown = {};
  
  for (const [provider, data] of Object.entries(ratings)) {
    if (!data || data.value === null || data.value === undefined) {
      breakdown[provider] = null;
      continue;
    }
    
    const type = data.type || 'direct';
    const normalized = normalizeRating(data.value, type);
    
    breakdown[provider] = {
      raw: data.value,
      normalized: normalized,
      type: type
    };
  }
  
  return breakdown;
}

/**
 * Format rating for display in Stremio
 * @param {number|null} rating - Normalized rating (0-10) or null
 * @param {boolean} isNA - Whether to show "N/A"
 * @returns {string} Formatted rating string (e.g., "★ 8.5" or "★ N/A")
 */
function formatRatingForDisplay(rating, isNA = false) {
  if (isNA || rating === null || rating === undefined) {
    return '★ N/A';
  }
  return `★ ${rating.toFixed(1)}`;
}

/**
 * Format detailed rating breakdown for metadata view
 * @param {Object} ratingBreakdown - Provider ratings breakdown
 * @returns {string} Formatted breakdown string
 */
function formatRatingBreakdown(ratingBreakdown) {
  if (!ratingBreakdown || Object.keys(ratingBreakdown).length === 0) {
    return '';
  }
  
  const providerNames = {
    hmm: 'HentaiMama',
    hse: 'HentaiSea',
    htv: 'HentaiTV',
  };
  
  const parts = [];
  
  for (const [provider, info] of Object.entries(ratingBreakdown)) {
    if (!info || info.normalized === null) continue;
    
    const name = providerNames[provider] || provider;
    
    if (info.type === 'views') {
      parts.push(`${name}: ${info.raw.toLocaleString()} views`);
    } else {
      parts.push(`${name}: ${info.normalized.toFixed(1)}/10`);
    }
  }
  
  return parts.join(' | ');
}

// Legacy function for backwards compatibility - now uses priority system
function calculateWeightedAverage(ratingBreakdown) {
  const { rating, isNA } = getPriorityRating(ratingBreakdown);
  return isNA ? null : rating;
}

module.exports = {
  normalizeRating,
  normalizeDirectRating,
  normalizeViewCount,
  getPriorityRating,
  calculateWeightedAverage,  // Legacy compatibility
  createRatingBreakdown,
  formatRatingForDisplay,
  formatRatingBreakdown,
  CONFIG
};
