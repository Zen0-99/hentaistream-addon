/**
 * Metadata utility functions for transforming API data to Stremio format
 */

const parser = require('./parser');
const logger = require('./logger');

/**
 * Transform API metadata to Stremio meta object
 * @param {Object} apiData - Raw metadata from API
 * @param {string} provider - Provider name (hanime, hh, etc.)
 * @returns {Object} Stremio-formatted meta object
 */
function toStremioMeta(apiData, provider) {
  if (!apiData) {
    logger.warn('Invalid API data for metadata transformation');
    return null;
  }

  const id = `${provider}-${apiData.slug || apiData.id}`;
  const name = apiData.name || apiData.title || 'Unknown';
  const poster = apiData.poster_url || apiData.poster || apiData.cover_url || apiData.thumbnail;
  const background = apiData.background_url || apiData.background || poster;
  const description = parser.formatDescription(apiData.description || apiData.synopsis || '');
  const releaseInfo = parser.parseReleaseYear(apiData.released_at || apiData.release_date || apiData.created_at);
  const genres = parser.normalizeGenres(apiData.tags || apiData.genres || apiData.categories || []);

  return {
    id,
    type: 'series',
    name,
    poster,
    background,
    logo: apiData.logo_url || null,
    description,
    releaseInfo,
    genres,
    runtime: parser.formatRuntime(apiData.duration || apiData.runtime),
    director: apiData.brand || apiData.studio ? [apiData.brand || apiData.studio] : undefined,
    cast: apiData.characters || undefined,
    imdbRating: apiData.rating || apiData.score || undefined,
    links: apiData.external_links || undefined,
    videos: apiData.episodes ? parser.buildVideosArray(apiData.slug || apiData.id, apiData.episodes) : [],
    behaviorHints: {
      defaultVideoId: apiData.episodes && apiData.episodes.length > 0 
        ? parser.createVideoId(apiData.slug || apiData.id, 1, 1)
        : undefined,
    },
  };
}

/**
 * Transform API catalog item to Stremio catalog meta preview
 * @param {Object} item - Raw catalog item from API
 * @param {string} provider - Provider name
 * @returns {Object} Stremio-formatted catalog item
 */
function toCatalogMeta(item, provider) {
  if (!item) return null;

  const id = `${provider}-${item.slug || item.id}`;
  const name = item.name || item.title || 'Unknown';
  const poster = item.poster_url || item.poster || item.cover_url || item.thumbnail;
  const genres = parser.normalizeGenres(item.tags || item.genres || []).slice(0, 3);  // Limit to 3 for previews

  return {
    id,
    type: 'series',
    name,
    poster,
    genres,
    description: parser.formatDescription(item.description || '', 200),  // Shorter for catalog
    posterShape: 'poster',
  };
}

/**
 * Extract poster URL with fallback
 * @param {Object} data - Data object with potential poster fields
 * @param {string} fallback - Fallback URL
 * @returns {string} Poster URL
 */
function extractPosterUrl(data, fallback = null) {
  return (
    data.poster_url ||
    data.poster ||
    data.cover_url ||
    data.thumbnail ||
    data.image ||
    fallback ||
    'https://via.placeholder.com/300x450?text=No+Poster'
  );
}

/**
 * Validate required meta fields
 * @param {Object} meta - Meta object to validate
 * @returns {boolean} True if valid
 */
function validateMeta(meta) {
  if (!meta) return false;

  const required = ['id', 'type', 'name'];
  const hasRequired = required.every(field => meta[field]);

  if (!hasRequired) {
    logger.warn('Meta object missing required fields:', { meta });
    return false;
  }

  return true;
}

/**
 * Merge metadata from multiple sources
 * @param {Object} primary - Primary metadata source
 * @param {Object} secondary - Secondary metadata source
 * @returns {Object} Merged metadata
 */
function mergeMeta(primary, secondary) {
  if (!secondary) return primary;
  if (!primary) return secondary;

  return {
    ...secondary,
    ...primary,
    // Merge arrays
    genres: [...new Set([...(primary.genres || []), ...(secondary.genres || [])])],
    cast: [...new Set([...(primary.cast || []), ...(secondary.cast || [])])],
    // Prefer primary for critical fields
    id: primary.id,
    type: primary.type,
    name: primary.name || secondary.name,
  };
}

/**
 * Add additional metadata fields for rich display
 * @param {Object} meta - Base meta object
 * @param {Object} additionalData - Additional data to add
 * @returns {Object} Enhanced meta object
 */
function enhanceMeta(meta, additionalData = {}) {
  return {
    ...meta,
    // Add popularity/view count if available
    popularityScore: additionalData.views || additionalData.popularity,
    // Add content ratings
    contentRating: additionalData.censorship || additionalData.rating,
    // Add language info
    language: additionalData.language || 'Japanese',
    // Add website link
    website: additionalData.url || additionalData.website,
  };
}

module.exports = {
  toStremioMeta,
  toCatalogMeta,
  extractPosterUrl,
  validateMeta,
  mergeMeta,
  enhanceMeta,
};
