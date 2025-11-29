const logger = require('./logger');

/**
 * Parse episode number from various title formats
 * @param {string} title - Episode title
 * @returns {number|null} Episode number or null if not found
 */
function parseEpisodeNumber(title) {
  if (!title) return null;

  // Try various episode patterns
  const patterns = [
    /episode\s*(\d+)/i,
    /ep\.?\s*(\d+)/i,
    /^(\d+)/,  // Number at start
    /#(\d+)/,
    /\s-\s*(\d+)$/,  // Number at end after dash
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * Parse season and episode from combined string
 * @param {string} str - String like "1:5" or "S01E05"
 * @returns {Object} Object with season and episode numbers
 */
function parseSeasonEpisode(str) {
  if (!str) return { season: 1, episode: 1 };

  // Handle "season:episode" format
  const colonMatch = str.match(/(\d+):(\d+)/);
  if (colonMatch) {
    return {
      season: parseInt(colonMatch[1], 10),
      episode: parseInt(colonMatch[2], 10),
    };
  }

  // Handle "S01E05" format
  const seMatch = str.match(/S(\d+)E(\d+)/i);
  if (seMatch) {
    return {
      season: parseInt(seMatch[1], 10),
      episode: parseInt(seMatch[2], 10),
    };
  }

  return { season: 1, episode: 1 };
}

/**
 * Create video ID in Stremio format
 * @param {string} slug - Series slug
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @returns {string} Video ID like "slug:season:episode"
 */
function createVideoId(slug, season, episode) {
  return `${slug}:${season}:${episode}`;
}

/**
 * Parse video ID into components
 * @param {string} videoId - Video ID like "slug:1:5"
 * @returns {Object} Object with slug, season, and episode
 */
function parseVideoId(videoId) {
  const parts = videoId.split(':');
  
  if (parts.length < 3) {
    logger.warn(`Invalid video ID format: ${videoId}`);
    return { slug: videoId, season: 1, episode: 1 };
  }

  return {
    slug: parts.slice(0, -2).join(':'),  // Handle slugs with colons
    season: parseInt(parts[parts.length - 2], 10) || 1,
    episode: parseInt(parts[parts.length - 1], 10) || 1,
  };
}

/**
 * Extract slug from full ID (remove provider prefix)
 * @param {string} fullId - Full ID like "hanime-overflow"
 * @returns {string} Slug without provider prefix
 */
function extractSlug(fullId) {
  const match = fullId.match(/^[a-z]+-(.+)$/);
  return match ? match[1] : fullId;
}

/**
 * Sanitize series name for use in IDs
 * @param {string} name - Series name
 * @returns {string} Sanitized slug
 */
function createSlug(name) {
  if (!name) return '';
  
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')  // Remove special chars
    .replace(/\s+/g, '-')       // Replace spaces with hyphens
    .replace(/-+/g, '-')        // Replace multiple hyphens with single
    .trim();
}

/**
 * Parse runtime string to minutes
 * @param {string} runtime - Runtime string like "23 min" or "1h 30m"
 * @returns {string} Formatted runtime string
 */
function formatRuntime(runtime) {
  if (!runtime) return null;
  
  if (typeof runtime === 'number') {
    return `${runtime} min`;
  }
  
  // Already formatted
  if (runtime.includes('min') || runtime.includes('h')) {
    return runtime;
  }
  
  // Try to parse minutes
  const minutes = parseInt(runtime, 10);
  if (!isNaN(minutes)) {
    return `${minutes} min`;
  }
  
  return runtime;
}

/**
 * Parse release year from date string
 * @param {string} dateStr - Date string in various formats
 * @returns {string|null} Year string or null
 */
function parseReleaseYear(dateStr) {
  if (!dateStr) return null;
  
  const yearMatch = dateStr.match(/\d{4}/);
  return yearMatch ? yearMatch[0] : null;
}

/**
 * Format description with length limit
 * @param {string} description - Original description
 * @param {number} maxLength - Maximum length (default: 500)
 * @returns {string} Formatted description
 */
function formatDescription(description, maxLength = 500) {
  if (!description) return '';
  
  if (description.length <= maxLength) {
    return description.trim();
  }
  
  return description.substring(0, maxLength).trim() + '...';
}

/**
 * Clean and normalize genre/tag names
 * @param {Array<string>|string} genres - Genre or array of genres
 * @returns {Array<string>} Array of cleaned genre names
 */
function normalizeGenres(genres) {
  if (!genres) return [];
  
  const genreArray = Array.isArray(genres) ? genres : [genres];
  
  return genreArray
    .filter(g => g && typeof g === 'string')
    .map(g => g.trim())
    .filter(g => g.length > 0)
    .map(g => {
      // Capitalize first letter
      return g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
    });
}

/**
 * Build videos array for Stremio meta object
 * @param {string} seriesSlug - Series slug
 * @param {Array} episodes - Array of episode objects
 * @returns {Array} Array of video objects for Stremio
 */
function buildVideosArray(seriesSlug, episodes) {
  if (!episodes || !Array.isArray(episodes)) {
    return [];
  }

  return episodes.map((ep, index) => {
    const episodeNum = ep.episode || ep.number || index + 1;
    const season = ep.season || 1;
    const title = ep.title || `Episode ${episodeNum}`;

    return {
      id: createVideoId(seriesSlug, season, episodeNum),
      title: title,
      season: season,
      episode: episodeNum,
      released: ep.released || ep.releaseDate || null,
      thumbnail: ep.thumbnail || null,
      overview: ep.description || null,
    };
  });
}

module.exports = {
  parseEpisodeNumber,
  parseSeasonEpisode,
  createVideoId,
  parseVideoId,
  extractSlug,
  createSlug,
  formatRuntime,
  parseReleaseYear,
  formatDescription,
  normalizeGenres,
  buildVideosArray,
};
