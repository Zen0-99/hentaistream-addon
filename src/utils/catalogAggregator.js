const logger = require('./logger');
const ratingNormalizer = require('./ratingNormalizer');
const { getMostRecentDate } = require('./dateParser');
const { selectBestDescription, isPromotionalDescription } = require('./descriptionHelper');

// Lazy load database to avoid circular dependencies
let databaseLoader = null;
function getDatabase() {
  if (!databaseLoader) {
    databaseLoader = require('./databaseLoader');
  }
  return databaseLoader;
}

/**
 * Get catalog from pre-bundled database
 * Much faster than scraping - instant load for historical content
 * 
 * @param {Object} options - Options for catalog retrieval
 * @param {string} options.provider - Filter by provider ('hmm', 'hse', 'htv', or null for all)
 * @param {string} options.genre - Filter by genre
 * @param {number} options.skip - Items to skip (pagination)
 * @param {number} options.limit - Items to return
 * @param {string} options.sortBy - Sort order ('popular', 'recent', 'rating')
 * @returns {Array|null} Array of series or null if database not ready
 */
function getCatalogFromDatabase(options = {}) {
  const db = getDatabase();
  if (!db.isReady()) {
    logger.debug('[Aggregator] Database not ready, will use scrapers');
    return null;
  }
  
  const { provider = null, genre = null, skip = 0, limit = 30, sortBy = 'popular', studio = null, year = null } = options;
  
  // Get base catalog (all or by provider)
  let items = provider ? db.getByProvider(provider) : db.getCatalog();
  
  if (!items || items.length === 0) {
    return null;
  }
  
  // Filter by genre if specified
  // Genre comes as display name like "3D", "Action", etc.
  // Match items where any genre starts with the search term (case-insensitive)
  // e.g., "3D" matches "3D Hentai", "3D Works", "3d", etc.
  if (genre) {
    const genreNormalized = genre.toLowerCase().trim();
    items = items.filter(item => {
      if (!item.genres || !Array.isArray(item.genres)) return false;
      return item.genres.some(g => {
        const gLower = g.toLowerCase().trim();
        // Match if genre equals, starts with, or contains the search term
        return gLower === genreNormalized || 
               gLower.startsWith(genreNormalized + ' ') || // "3d " matches "3d hentai"
               gLower.startsWith(genreNormalized + '-');   // "3d-" matches "3d-something"
      });
    });
    logger.debug(`[Aggregator] Genre filter "${genre}" matched ${items.length} items`);
  }
  
  // Filter by studio if specified (BEFORE pagination!)
  // Use exact match only - "Edge" should NOT match "Edge Systems" or "Etching Edge"
  if (studio) {
    const studioLower = studio.toLowerCase().trim();
    items = items.filter(item => {
      if (!item.studio) return false;
      const itemStudio = item.studio.toLowerCase().trim();
      return itemStudio === studioLower; // EXACT match only
    });
    logger.debug(`[Aggregator] Studio filter "${studio}" matched ${items.length} items`);
  }
  
  // Filter by year if specified (BEFORE pagination!)
  // Includes series with year field OR episodes released in that year
  if (year) {
    const targetYear = parseInt(year);
    if (!isNaN(targetYear)) {
      items = items.filter(item => {
        // Check explicit year field (normalize to number - database may have string or number)
        const itemYear = typeof item.year === 'string' ? parseInt(item.year) : item.year;
        if (itemYear === targetYear) return true;
        
        // Check releaseInfo for year
        if (item.releaseInfo) {
          const match = String(item.releaseInfo).match(/(\d{4})/);
          if (match && parseInt(match[1]) === targetYear) return true;
        }
        
        // Check lastUpdated date year
        if (item.lastUpdated) {
          const dateYear = new Date(item.lastUpdated).getFullYear();
          if (dateYear === targetYear) return true;
        }
        
        // Check episode release dates - include if ANY episode was released in this year
        if (item.episodes && Array.isArray(item.episodes)) {
          for (const ep of item.episodes) {
            if (ep.released) {
              const epYear = new Date(ep.released).getFullYear();
              if (epYear === targetYear) return true;
            }
          }
        }
        
        return false;
      });
      logger.debug(`[Aggregator] Year filter "${targetYear}" matched ${items.length} items`);
    }
  }
  
  // Sort based on sortBy option
  switch (sortBy) {
    case 'recent':
      items.sort((a, b) => {
        const dateA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
        const dateB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
        return dateB - dateA;
      });
      break;
    case 'rating':
      items.sort((a, b) => {
        const ratingA = a.rating || 0;
        const ratingB = b.rating || 0;
        return ratingB - ratingA;
      });
      break;
    case 'popular':
    default:
      // Popular = by view count (HTV) or rating (HMM) or metadata score
      items.sort((a, b) => {
        // Priority: viewCount > rating > metadataScore
        const scoreA = (a.viewCount || 0) + (a.rating || 0) * 10000 + (a.metadataScore || 0);
        const scoreB = (b.viewCount || 0) + (b.rating || 0) * 10000 + (b.metadataScore || 0);
        return scoreB - scoreA;
      });
  }
  
  // Apply pagination
  const result = items.slice(skip, skip + limit);
  
  logger.debug(`[Aggregator] Database returned ${result.length} items (skip=${skip}, limit=${limit}, total=${items.length})`);
  
  return result;
}

/**
 * Get the newest content date from the database
 * @returns {Date|null}
 */
function getNewestDatabaseDate() {
  const db = getDatabase();
  if (!db.isReady()) return null;
  return db.getNewestContentDate();
}

/**
 * Get database build date
 * @returns {Date|null}
 */
function getDatabaseBuildDate() {
  const db = getDatabase();
  if (!db.isReady()) return null;
  return db.getBuildDate();
}

/**
 * Check if an item is in the pre-bundled database
 * Used to decide whether to fetch metadata from scrapers
 * @param {string} id - Series ID
 * @returns {Object|null} Database item or null
 */
function getFromDatabase(id) {
  const db = getDatabase();
  if (!db.isReady()) return null;
  return db.getById(id);
}

/**
 * Check if database is available and ready
 */
function isDatabaseReady() {
  const db = getDatabase();
  return db.isReady();
}

/**
 * Search the database with relevance scoring
 * Partial matches work, but exact/closer matches are scored higher
 * 
 * @param {string} query - Search query (will be lowercased)
 * @param {Object} options - Search options
 * @param {number} options.limit - Max results to return (default: 50)
 * @returns {Array} Sorted array of matching series (best matches first)
 */
function searchDatabase(query, options = {}) {
  const db = getDatabase();
  if (!db.isReady()) {
    logger.debug('[Aggregator] Database not ready for search');
    return null;
  }
  
  const { limit = 50 } = options;
  const queryLower = query.toLowerCase().trim();
  
  if (!queryLower) {
    return [];
  }
  
  // Get all items from database
  const allItems = db.getCatalog();
  if (!allItems || allItems.length === 0) {
    return [];
  }
  
  // Score each item based on how well it matches the query
  const scored = [];
  
  for (const item of allItems) {
    const name = (item.name || '').toLowerCase();
    const description = (item.description || '').toLowerCase();
    const studio = (item.studio || '').toLowerCase();
    const genres = (item.genres || []).map(g => g.toLowerCase());
    
    let score = 0;
    
    // TITLE MATCHING (highest priority)
    if (name === queryLower) {
      // Exact title match = highest score
      score += 1000;
    } else if (name.startsWith(queryLower)) {
      // Title starts with query (e.g., "mama" matches "mama no tomo")
      score += 500;
    } else if (name.includes(queryLower)) {
      // Title contains query anywhere
      score += 200;
    }
    
    // WORD-LEVEL MATCHING (for multi-word queries)
    const queryWords = queryLower.split(/\s+/);
    const nameWords = name.split(/\s+/);
    
    // Check if all query words appear in title (in any order)
    const allWordsMatch = queryWords.every(qw => 
      nameWords.some(nw => nw.includes(qw))
    );
    if (allWordsMatch && queryWords.length > 1) {
      score += 150;
    }
    
    // Check for individual word matches
    for (const qw of queryWords) {
      if (nameWords.some(nw => nw === qw)) {
        score += 50; // Exact word match
      } else if (nameWords.some(nw => nw.startsWith(qw))) {
        score += 25; // Word starts with query word
      }
    }
    
    // STUDIO MATCHING (medium priority)
    if (studio === queryLower) {
      score += 300;
    } else if (studio.includes(queryLower)) {
      score += 100;
    }
    
    // GENRE MATCHING (lower priority)
    for (const genre of genres) {
      if (genre === queryLower) {
        score += 80;
      } else if (genre.includes(queryLower)) {
        score += 30;
      }
    }
    
    // DESCRIPTION MATCHING (lowest priority, just for discovery)
    if (description.includes(queryLower)) {
      score += 10;
    }
    
    // Only include items with a score > 0
    if (score > 0) {
      scored.push({ item, score });
    }
  }
  
  // Sort by score (highest first), then by rating as tiebreaker
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Tiebreaker: higher rated content first
    return (b.item.rating || 0) - (a.item.rating || 0);
  });
  
  // Return just the items, limited
  const results = scored.slice(0, limit).map(s => s.item);
  
  logger.info(`[Aggregator] Database search "${query}" found ${scored.length} matches, returning top ${results.length}`);
  
  return results;
}

/**
 * Normalize series name for matching across providers
 * @param {string} name - Series name
 * @returns {string} Normalized name
 */
function normalizeName(name) {
  if (!name) return '';
  
  return name
    .toLowerCase()
    .trim()
    // Remove special characters but keep spaces
    .replace(/[^\w\s-]/g, '')
    // Normalize multiple spaces to single space
    .replace(/\s+/g, ' ')
    // Remove common prefixes/suffixes
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/\s+(episode|ep|series|season|s)\s*\d*$/i, '');
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score (0-1)
 */
function similarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Check if two series are duplicates
 * @param {Object} series1 - First series
 * @param {Object} series2 - Second series
 * @returns {boolean} True if series are duplicates
 */
function isDuplicate(series1, series2) {
  const name1 = normalizeName(series1.name);
  const name2 = normalizeName(series2.name);
  
  // Exact match
  if (name1 === name2) return true;
  
  // Fuzzy match (90% similarity threshold)
  const score = similarity(name1, name2);
  return score >= 0.90;
}

/**
 * Calculate weighted average rating from multiple provider ratings
 * Uses priority-based system: HentaiMama > HentaiTV > HentaiSea > N/A
 * @param {Object} ratingBreakdown - Object with provider rating info
 *   Example: { hmm: { raw: 8.6, type: 'direct' }, htv: { raw: 5000, type: 'views' } }
 * @returns {Object} { rating: number|null, source: string, isNA: boolean }
 */
function calculateAverageRating(ratingBreakdown) {
  // Use the new priority-based system
  return ratingNormalizer.getPriorityRating(ratingBreakdown);
}

/**
 * Calculate metadata quality score for a series
 * Higher score = more complete metadata
 * HentaiMama items get bonus points as it's the primary source with actual ratings
 * @param {Object} series - Series object
 * @returns {number} Quality score
 */
function calculateMetadataScore(series) {
  let score = 0;
  
  // Check if this is a HentaiMama item (primary source bonus)
  const isHentaiMama = series.id && series.id.startsWith('hmm-');
  if (isHentaiMama) {
    score += 10; // Big bonus for being from primary source
  }
  
  // +3 for having a description (most important)
  if (series.description && series.description.length > 20) {
    score += 3;
    // Bonus for longer descriptions
    if (series.description.length > 100) score += 1;
    if (series.description.length > 200) score += 1;
  }
  
  // +1 per genre (max 5 points)
  if (series.genres && Array.isArray(series.genres)) {
    score += Math.min(series.genres.length, 5);
  }
  
  // +2 for having a poster
  if (series.poster && series.poster.length > 10) {
    score += 2;
  }
  
  // +1 for having a year
  if (series.year) {
    score += 1;
  }
  
  // +3 for having an actual rating (not view-based)
  // HentaiMama provides real user ratings which are more valuable
  if (series.rating && series.rating > 0) {
    score += 3;
    // Extra bonus for high ratings (8+)
    if (series.rating >= 8) score += 2;
  }
  
  return score;
}

/**
 * Merge duplicate series from multiple providers
 * Prefers the item with higher metadata quality score as primary
 * @param {Object} existing - Existing series in aggregated list
 * @param {Object} newSeries - New series from another provider
 * @returns {Object} Merged series with best metadata
 */
function mergeSeries(existing, newSeries) {
  // Extract provider prefix from IDs
  const getPrefixFromId = (id) => {
    const match = id.match(/^([a-z]+)-/);
    return match ? match[1] : 'unknown';
  };
  
  const existingPrefix = getPrefixFromId(existing.id);
  const newPrefix = getPrefixFromId(newSeries.id);
  
  // Calculate metadata scores to determine which should be primary
  const existingScore = calculateMetadataScore(existing);
  const newScore = calculateMetadataScore(newSeries);
  
  // Determine primary (higher score wins)
  let primary, secondary;
  if (newScore > existingScore) {
    // New series has better metadata - swap primary
    primary = { ...newSeries };
    secondary = existing;
    logger.debug(`Swapping primary: ${newSeries.name} (score: ${newScore}) > ${existing.name} (score: ${existingScore})`);
  } else {
    primary = existing;
    secondary = newSeries;
  }
  
  const primaryPrefix = getPrefixFromId(primary.id);
  const secondaryPrefix = getPrefixFromId(secondary.id);
  
  // Initialize arrays and objects if they don't exist
  if (!primary.providers) primary.providers = [primaryPrefix];
  if (!primary.providerSlugs) primary.providerSlugs = { [primaryPrefix]: primary.id.replace(`${primaryPrefix}-`, '') };
  if (!primary.ratingBreakdown) primary.ratingBreakdown = {};
  
  // Copy over existing provider data if swapping primary
  if (existing.providers) {
    existing.providers.forEach(p => {
      if (!primary.providers.includes(p)) primary.providers.push(p);
    });
  }
  if (existing.providerSlugs) {
    Object.assign(primary.providerSlugs, existing.providerSlugs);
  }
  if (existing.ratingBreakdown) {
    Object.assign(primary.ratingBreakdown, existing.ratingBreakdown);
  }
  
  // Add ratings from both (with type info for proper normalization)
  // HentaiMama has direct ratings, HentaiTV has view counts, HentaiSea has neither
  if (primary.rating !== undefined && primary.rating !== null && !primary.ratingBreakdown[primaryPrefix]) {
    primary.ratingBreakdown[primaryPrefix] = {
      raw: primary.rating,
      type: primary.ratingType || 'direct',
      voteCount: primary.voteCount || null  // Include vote count for minimum threshold check
    };
  }
  // Handle view counts from HentaiTV
  if (primary.viewCount !== undefined && primary.viewCount !== null && !primary.ratingBreakdown[primaryPrefix]) {
    primary.ratingBreakdown[primaryPrefix] = {
      raw: primary.viewCount,
      type: 'views'
    };
  }
  
  if (secondary.rating !== undefined && secondary.rating !== null) {
    secondary.ratingBreakdown = secondary.ratingBreakdown || {};
    secondary.ratingBreakdown[secondaryPrefix] = {
      raw: secondary.rating,
      type: secondary.ratingType || 'direct',
      voteCount: secondary.voteCount || null  // Include vote count for minimum threshold check
    };
  }
  // Handle view counts from secondary provider
  if (secondary.viewCount !== undefined && secondary.viewCount !== null) {
    secondary.ratingBreakdown = secondary.ratingBreakdown || {};
    secondary.ratingBreakdown[secondaryPrefix] = {
      raw: secondary.viewCount,
      type: 'views'
    };
  }
  
  // Merge rating breakdowns
  if (secondary.ratingBreakdown) {
    Object.assign(primary.ratingBreakdown, secondary.ratingBreakdown);
  }
  
  // Merge secondary provider data
  if (!primary.providers.includes(secondaryPrefix)) {
    primary.providers.push(secondaryPrefix);
  }
  primary.providerSlugs[secondaryPrefix] = secondary.id.replace(`${secondaryPrefix}-`, '');
  
  // Recalculate rating using priority-based system
  const ratingResult = calculateAverageRating(primary.ratingBreakdown);
  primary.rating = ratingResult.rating;
  primary.ratingSource = ratingResult.source;
  primary.ratingIsNA = ratingResult.isNA;
  
  // Keep best poster (prefer non-null, prefer primary's)
  if (!primary.poster && secondary.poster) {
    primary.poster = secondary.poster;
  }
  
  // Select best description using description helper
  // Prefers non-promotional descriptions with actual content
  const descriptions = [
    primary.description,
    secondary.description
  ].filter(d => d && d.length > 0);
  
  if (descriptions.length > 0) {
    primary.description = selectBestDescription(descriptions);
  }
  
  // Merge genres (deduplicate and filter out studio name)
  if (secondary.genres && Array.isArray(secondary.genres)) {
    if (!primary.genres) primary.genres = [];
    const allGenres = [...primary.genres, ...secondary.genres];
    // Filter out studio from genres (some scrapers include studio in genres array)
    const studioName = primary.studio || secondary.studio;
    const filteredGenres = studioName 
      ? allGenres.filter(g => g.toLowerCase() !== studioName.toLowerCase())
      : allGenres;
    primary.genres = [...new Set(filteredGenres)];
  }
  
  // Merge studio (prefer non-null, prefer properly capitalized)
  if (!primary.studio && secondary.studio) {
    primary.studio = secondary.studio;
  } else if (primary.studio && secondary.studio) {
    // Prefer Title Case over ALL CAPS
    const primaryAllCaps = primary.studio === primary.studio.toUpperCase();
    const secondaryAllCaps = secondary.studio === secondary.studio.toUpperCase();
    if (primaryAllCaps && !secondaryAllCaps) {
      primary.studio = secondary.studio;
    }
  }
  
  // Merge year (prefer non-null)
  if (!primary.year && secondary.year) {
    primary.year = secondary.year;
  }
  
  // Merge lastUpdated dates (keep most recent)
  primary.lastUpdated = getMostRecentDate(primary.lastUpdated, secondary.lastUpdated);
  
  // Store metadata score for sorting
  primary.metadataScore = calculateMetadataScore(primary);
  
  return primary;
}

/**
 * Aggregate catalogs from multiple providers
 * @param {Array<Object>} providerCatalogs - Array of { provider, catalog } objects
 * @returns {Array<Object>} Deduplicated, merged, and sorted catalog
 */
function aggregateCatalogs(providerCatalogs) {
  const startTime = Date.now();
  const aggregated = [];
  
  logger.info(`Aggregating catalogs from ${providerCatalogs.length} providers`);
  
  // Track how many items from each provider end up in final results
  const providerStats = {};
  
  for (const { provider, catalog } of providerCatalogs) {
    logger.info(`Processing ${catalog.length} series from ${provider}`);
    providerStats[provider] = { total: catalog.length, merged: 0, added: 0 };
    
    for (const series of catalog) {
      // Find if this series already exists in aggregated catalog
      const existingIndex = aggregated.findIndex(s => isDuplicate(s, series));
      
      if (existingIndex >= 0) {
        // Merge with existing series (may swap primary based on metadata quality)
        aggregated[existingIndex] = mergeSeries(aggregated[existingIndex], series);
        logger.debug(`Merged duplicate: ${series.name} from ${provider}`);
        providerStats[provider].merged++;
      } else {
        // Add as new series
        providerStats[provider].added++;
        const getPrefixFromId = (id) => {
          const match = id.match(/^([a-z]+)-/);
          return match ? match[1] : 'unknown';
        };
        
        const prefix = getPrefixFromId(series.id);
        
        // Build rating breakdown with proper type info
        const ratingBreakdown = {};
        if (series.rating !== undefined && series.rating !== null) {
          ratingBreakdown[prefix] = {
            raw: series.rating,
            type: series.ratingType || 'direct'
          };
        } else if (series.viewCount !== undefined && series.viewCount !== null) {
          ratingBreakdown[prefix] = {
            raw: series.viewCount,
            type: 'views'
          };
        }
        
        // Filter out studio from genres (some scrapers include studio in genres array)
        let filteredGenres = series.genres;
        if (series.studio && Array.isArray(series.genres)) {
          filteredGenres = series.genres.filter(g => 
            g.toLowerCase() !== series.studio.toLowerCase()
          );
        }
        
        // Clean up description if promotional
        let cleanedDescription = series.description;
        if (isPromotionalDescription(series.description)) {
          cleanedDescription = 'No Description';
        }
        
        const newSeries = {
          ...series,
          genres: filteredGenres,
          description: cleanedDescription,
          providers: [prefix],
          providerSlugs: {
            [prefix]: series.id.replace(`${prefix}-`, '')
          },
          ratingBreakdown: ratingBreakdown,
          metadataScore: calculateMetadataScore(series)
        };
        
        // Calculate initial rating using priority-based system
        const ratingResult = calculateAverageRating(newSeries.ratingBreakdown);
        newSeries.rating = ratingResult.rating;
        newSeries.ratingSource = ratingResult.source;
        newSeries.ratingIsNA = ratingResult.isNA;
        
        aggregated.push(newSeries);
      }
    }
  }
  
  // Sort by metadata completeness (more complete first), then alphabetically
  aggregated.sort((a, b) => {
    // First: sort by metadata score (higher = better)
    const scoreDiff = (b.metadataScore || 0) - (a.metadataScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
    
    // Second: sort by number of providers (more = more reliable)
    const providerDiff = (b.providers?.length || 1) - (a.providers?.length || 1);
    if (providerDiff !== 0) return providerDiff;
    
    // Third: alphabetical by name
    return (a.name || '').localeCompare(b.name || '');
  });
  
  const duration = Date.now() - startTime;
  
  // Log detailed provider stats
  logger.info(`📊 Aggregation stats:`);
  for (const [prov, stats] of Object.entries(providerStats)) {
    logger.info(`  ${prov}: ${stats.total} total → ${stats.added} added, ${stats.merged} merged`);
  }
  
  // Log ID prefix distribution
  const prefixCounts = {};
  for (const item of aggregated) {
    const prefix = item.id?.split('-')[0] || 'unknown';
    prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
  }
  logger.info(`📊 Final ID prefixes: ${JSON.stringify(prefixCounts)}`);
  
  logger.info(`Catalog aggregation complete: ${aggregated.length} unique series from ${providerCatalogs.length} providers (${duration}ms)`);
  
  return aggregated;
}

module.exports = {
  aggregateCatalogs,
  normalizeName,
  similarity,
  isDuplicate,
  calculateAverageRating,
  calculateMetadataScore,
  mergeSeries,
  // Database integration (new)
  getCatalogFromDatabase,
  getFromDatabase,
  isDatabaseReady,
  getNewestDatabaseDate,
  getDatabaseBuildDate,
  searchDatabase
};
