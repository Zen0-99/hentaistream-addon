/**
 * Configuration Parser
 * Handles encoding/decoding of addon configuration from URL query parameters
 * 
 * Format: ?providers=hmm,hse&bg=tentacle,ntr&en=1
 * Example: ?bg=tentacle,ntr&providers=hmm,hse&en=1
 */

const DEFAULT_CONFIG = {
  // All providers enabled by default
  providers: ['hmm', 'hse', 'htv'],
  // No blacklists by default
  blacklistGenres: [],
  blacklistStudios: [],
  // Show counts on filter options by default
  showCounts: true
};

/**
 * Parse configuration from query object (req.query)
 * @param {Object} query - Query parameters object from Express
 * @returns {Object} Parsed configuration object
 */
function parseConfig(query) {
  if (!query || typeof query !== 'object') {
    return { ...DEFAULT_CONFIG };
  }

  const config = { ...DEFAULT_CONFIG };

  try {
    // Providers
    if (query.providers) {
      config.providers = query.providers.split(',').filter(p => 
        ['hmm', 'hse', 'htv'].includes(p.toLowerCase())
      );
      // Ensure at least one provider
      if (config.providers.length === 0) {
        config.providers = ['hmm', 'hse', 'htv'];
      }
    }

    // Blacklist genres
    if (query.bg || query.blacklist_genres) {
      const value = query.bg || query.blacklist_genres;
      config.blacklistGenres = value.split(',').map(g => g.trim().toLowerCase());
    }

    // Blacklist studios
    if (query.bs || query.blacklist_studios) {
      const value = query.bs || query.blacklist_studios;
      config.blacklistStudios = value.split(',').map(s => s.trim().toLowerCase());
    }

    // Show counts toggle (default true, only set when explicitly disabled)
    if (query.showCounts === '0' || query.showCounts === 'false') {
      config.showCounts = false;
    }
  } catch (error) {
    console.error('Error parsing config:', error.message);
    return { ...DEFAULT_CONFIG };
  }

  return config;
}

/**
 * Encode configuration object to URL query string
 * @param {Object} config - Configuration object
 * @returns {string} Encoded query string (without leading ?)
 */
function encodeConfig(config) {
  const params = new URLSearchParams();

  // Only encode non-default values to keep URL short
  
  // Providers (only if not all enabled)
  if (config.providers && config.providers.length > 0 && config.providers.length < 3) {
    params.set('providers', config.providers.join(','));
  }

  // Blacklist genres (slugified)
  if (config.blacklistGenres && config.blacklistGenres.length > 0) {
    const genres = config.blacklistGenres.map(g => g.toLowerCase().replace(/\s+/g, '-')).join(',');
    params.set('bg', genres);
  }

  // Blacklist studios (slugified)
  if (config.blacklistStudios && config.blacklistStudios.length > 0) {
    const studios = config.blacklistStudios.map(s => s.toLowerCase().replace(/\s+/g, '-')).join(',');
    params.set('bs', studios);
  }

  return params.toString();
}

/**
 * Normalize string for comparison (lowercase, remove spaces/dashes)
 */
function normalizeForComparison(str) {
  return str.toLowerCase().replace(/[\s-]+/g, '');
}

/**
 * Check if a series should be filtered out based on config
 * @param {Object} series - Series object with genres, studio
 * @param {Object} config - Configuration object
 * @returns {boolean} True if series should be included, false if filtered out
 */
function shouldIncludeSeries(series, config) {
  // Check genre blacklist using EXACT matching to prevent false positives
  // e.g., blacklisting "3" should NOT block "3D", blacklisting "nurse" should NOT block "nurses"
  if (config.blacklistGenres && config.blacklistGenres.length > 0 && series.genres) {
    const seriesGenres = series.genres.map(g => normalizeForComparison(g));
    for (const blacklisted of config.blacklistGenres) {
      const normalizedBlacklisted = normalizeForComparison(blacklisted);
      // EXACT match only - no substring matching
      if (seriesGenres.some(g => g === normalizedBlacklisted)) {
        return false;
      }
    }
  }

  // Check studio blacklist - use substring matching for flexibility
  // Studio names can vary (e.g., "Studio ABC" vs "ABC Animation")
  if (config.blacklistStudios && config.blacklistStudios.length > 0 && series.studio) {
    const normalizedStudio = normalizeForComparison(series.studio);
    for (const blacklisted of config.blacklistStudios) {
      const normalizedBlacklisted = normalizeForComparison(blacklisted);
      // For studios, substring matching is acceptable and useful
      if (normalizedStudio.includes(normalizedBlacklisted) || normalizedBlacklisted.includes(normalizedStudio)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Get enabled scrapers based on config
 * @param {Object} config - Configuration object
 * @param {Object} scrapers - Object with scraper instances { hmm, hse, htv }
 * @returns {Array} Array of enabled scraper instances
 */
function getEnabledScrapers(config, scrapers) {
  const enabled = [];
  
  if (config.providers.includes('hmm') && scrapers.hmm) {
    enabled.push(scrapers.hmm);
  }
  if (config.providers.includes('hse') && scrapers.hse) {
    enabled.push(scrapers.hse);
  }
  if (config.providers.includes('htv') && scrapers.htv) {
    enabled.push(scrapers.htv);
  }

  return enabled;
}

/**
 * Check if a title looks like English (not Japanese)
 * @param {string} title - Title to check
 * @returns {boolean} True if title appears to be English
 */
function isEnglishTitle(title) {
  if (!title) return false;
  
  // Check for Japanese characters (Hiragana, Katakana, Kanji)
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  return !japaneseRegex.test(title);
}

/**
 * Select best title based on English preference
 * @param {Array<string>} titles - Array of possible titles
 * @param {boolean} preferEnglish - Whether to prefer English titles
 * @returns {string} Selected title
 */
function selectBestTitle(titles, preferEnglish) {
  if (!titles || titles.length === 0) return '';
  if (titles.length === 1) return titles[0];

  if (preferEnglish) {
    // Find first English title
    const englishTitle = titles.find(t => isEnglishTitle(t));
    if (englishTitle) return englishTitle;
  }

  // Return first title as fallback
  return titles[0];
}

module.exports = {
  DEFAULT_CONFIG,
  parseConfig,
  encodeConfig,
  shouldIncludeSeries,
  getEnabledScrapers,
  isEnglishTitle,
  selectBestTitle
};
