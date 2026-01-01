const cache = require('../../cache');
const logger = require('../../utils/logger');
const hentaimamaScraper = require('../../scrapers/hentaimama');
const oppaiStreamScraper = require('../../scrapers/oppaistream');
const hentaiseaScraper = require('../../scrapers/hentaisea');
const hentaitvScraper = require('../../scrapers/hentaitv');
const { 
  aggregateCatalogs, 
  isDuplicate, 
  mergeSeries, 
  calculateAverageRating, 
  getCatalogFromDatabase, 
  isDatabaseReady,
  getNewestDatabaseDate,
  getDatabaseBuildDate,
  searchDatabase
} = require('../../utils/catalogAggregator');
const ratingNormalizer = require('../../utils/ratingNormalizer');
const { isWithinWeek, isWithinMonth, compareDatesNewestFirst } = require('../../utils/dateParser');
const { shouldIncludeSeries, DEFAULT_CONFIG } = require('../../utils/configParser');
const { genreMatcher } = require('../../utils/genreMatcher');

// Scraper map for easy lookup
const SCRAPER_MAP = {
  hmm: hentaimamaScraper,
  hse: hentaiseaScraper,
  htv: hentaitvScraper
};

/**
 * Format a series object to Stremio meta format
 * Used for both database and scraper results
 * @param {Object} series - Series object from database or aggregator
 * @returns {Object} Stremio-compatible meta object
 */
function formatSeriesMeta(series) {
  const formatted = { ...series };
  
  // IMPORTANT: For Stremio to display metas properly, we need type='series'
  formatted.type = 'series';
  
  // Use runtime field for rating display (to avoid IMDb logo)
  // Priority-based system: HentaiMama > HentaiTV > HentaiSea > N/A
  if (series.ratingIsNA) {
    formatted.runtime = `★ N/A`;
  } else if (series.rating !== null && series.rating !== undefined && !isNaN(series.rating)) {
    formatted.runtime = `★ ${series.rating.toFixed(1)}`;
  } else {
    formatted.runtime = `★ N/A`;
  }
  
  // releaseInfo should only contain year
  if (series.year) {
    formatted.releaseInfo = series.year.toString();
  }
  
  // Ensure genres array is passed through
  const genres = (series.genres && Array.isArray(series.genres) && series.genres.length > 0) 
    ? series.genres 
    : [];
  formatted.genres = genres.length > 0 ? genres : undefined;
  
  // Build links array with BOTH studio and genres
  const studioLinks = series.studio ? [{
    name: series.studio,
    category: 'Studio',
    url: `stremio:///search?search=${encodeURIComponent(series.studio)}`
  }] : [];
  
  const genreLinks = genres.map(genre => ({
    name: genre,
    category: 'Genres',
    url: `stremio:///search?search=${encodeURIComponent(genre)}`
  }));
  
  // Combine: genres first, then studio
  const allLinks = [...genreLinks, ...studioLinks];
  if (allLinks.length > 0) {
    formatted.links = allLinks;
  }
  
  return formatted;
}

/**
 * Genre name to slug mapping for HentaiMama
 * Maps display names (from GENRE_OPTIONS in manifest) to actual URL slugs
 * This fixes issues like "Animal Girls" -> "animal-ears" (not "animal-girls")
 */
const GENRE_SLUG_MAP = {
  // Special mappings where display name != URL slug
  'animal girls': 'animal-ears',
  'boob job': 'paizuri',
  'tits fuck': 'paizuri',
  'blow job': 'blowjob',
  'hand job': 'handjob',
  'foot job': 'footjob',
  'cream pie': 'creampie',
  'double penetration': 'dp',
  'group sex': 'gangbang',
  'large breasts': 'big-boobs',
  'big boobs': 'big-boobs',
  'big bust': 'big-boobs',
  'female teacher': 'teacher',
  'female doctor': 'doctor',
  'internal cumshot': 'creampie',
  'oral sex': 'blowjob',
  'school girl': 'school-girls',
  'schoolgirl': 'school-girls',
  'step daughter': 'step-family',
  'step mother': 'step-family',
  'step sister': 'step-family',
  'sex toys': 'toys',
  'three some': 'threesome',
  'cute & funny': 'cute-funny',
  // Note: Most genres use simple kebab-case conversion
};

/**
 * Convert genre display name to URL slug for a provider
 * Uses genreMatcher for proper slug mapping
 * @param {string} genreName - Display name like "Animal Girls" or "3D (1737)"
 * @param {string} provider - Provider name (hentaimama, hentaisea, hentaitv)
 * @returns {string} URL slug like "animal-ears"
 */
function genreNameToSlug(genreName, provider = 'hentaimama') {
  if (!genreName) return null;
  
  // IMPORTANT: Remove count suffix like " (1737)" before converting to slug
  const cleanName = genreName.replace(/\\s*\\(\\d+\\)$/, '').trim();
  
  // Use genreMatcher for provider-specific slug mapping
  return genreMatcher.getSlugForProvider(cleanName, provider);
}

/**
 * Get all available scrapers for catalog aggregation
 * HentaiMama is the PRIMARY source (first in array) - it has the best ratings
 * @param {Object} userConfig - User configuration with enabled providers
 * @returns {Array<Object>} Array of scraper instances
 */
function getAllScrapers(userConfig = DEFAULT_CONFIG) {
  const scrapers = [];
  
  // HentaiMama FIRST - it's the primary source with actual star ratings
  if (userConfig.providers.includes('hmm')) {
    scrapers.push(hentaimamaScraper);
  }
  // Secondary providers
  if (userConfig.providers.includes('hse')) {
    scrapers.push(hentaiseaScraper);
  }
  if (userConfig.providers.includes('htv')) {
    scrapers.push(hentaitvScraper);
  }
  
  // Ensure at least one scraper (HentaiMama as default)
  if (scrapers.length === 0) {
    scrapers.push(hentaimamaScraper);
  }
  
  return scrapers;
}

/**
 * Get scraper based on catalog ID or prefix
 */
function getScraper(id) {
  if (id.startsWith('hentaimama-') || id.startsWith('hmm-')) {
    return hentaimamaScraper;
  }
  if (id.startsWith('hentaisea-') || id.startsWith('hse-')) {
    return hentaiseaScraper;
  }
  if (id.startsWith('hentaitv-') || id.startsWith('htv-')) {
    return hentaitvScraper;
  }
  if (id.startsWith('oppaistream-') || id.startsWith('os-')) {
    return oppaiStreamScraper;
  }
  return hentaimamaScraper;  // Default
}

/**
 * Check if catalog ID belongs to any of our supported providers
 */
function isOurCatalog(id) {
  // New hentai-* catalog IDs
  if (id.startsWith('hentai-')) return true;
  
  return id === 'hentai' ||
         id.startsWith('hentaimama-') || 
         id.startsWith('hentaisea-') || 
         id.startsWith('hentaitv-') ||
         id.startsWith('hentaistream-') ||
         id.startsWith('hmm-') ||
         id.startsWith('hse-') ||
         id.startsWith('htv-') ||
         id.startsWith('hs-');
}

/**
 * Parse catalog ID to determine sorting/filtering strategy
 * @param {string} id - Catalog ID
 * @returns {Object} { sortType, filterType, studioFilter, yearFilter, timePeriodFilter }
 */
function parseCatalogId(id) {
  // New catalog types: hentai-weekly, hentai-monthly, hentai-top-rated, hentai-a-z, hentai-studios, hentai-years, hentai-all, hentai-search
  switch (id) {
    case 'hentai-weekly':
      return { sortType: 'date', filterType: 'weekly', studioFilter: false, yearFilter: false, timePeriodFilter: false };
    case 'hentai-monthly':
      // Now uses time period filter from genre dropdown (This Week, This Month, etc.)
      return { sortType: 'date', filterType: null, studioFilter: false, yearFilter: false, timePeriodFilter: true };
    case 'hentai-top-rated':
      return { sortType: 'rating', filterType: null, studioFilter: false, yearFilter: false, timePeriodFilter: false };
    case 'hentai-a-z':
      return { sortType: 'alphabetical', filterType: null, studioFilter: false, yearFilter: false, timePeriodFilter: false };
    case 'hentai-studios':
      return { sortType: 'default', filterType: null, studioFilter: true, yearFilter: false, timePeriodFilter: false };
    case 'hentai-years':
      return { sortType: 'date', filterType: null, studioFilter: false, yearFilter: true, timePeriodFilter: false };
    case 'hentai-search':
      // Search-only catalog - uses database search, no sorting/filtering needed
      return { sortType: 'relevance', filterType: null, studioFilter: false, yearFilter: false, timePeriodFilter: false };
    case 'hentai-all':
    case 'hentai':
    default:
      return { sortType: 'default', filterType: null, studioFilter: false, yearFilter: false, timePeriodFilter: false }; // Default: metadata score
  }
}

/**
 * Parse time period from genre filter value
 * Converts "This Week (45)" or "This Week" to a filter type
 * @param {string} timePeriod - Time period string from genre filter
 * @returns {string|null} Filter type: 'week', 'month', '3months', 'year', or null
 */
function parseTimePeriod(timePeriod) {
  if (!timePeriod) return null;
  
  // Remove count suffix like " (45)" and normalize
  const clean = timePeriod.replace(/\s*\(\d+\)$/, '').trim().toLowerCase();
  
  if (clean === 'this week') return 'week';
  if (clean === 'this month') return 'month';
  if (clean === '3 months') return '3months';
  if (clean === 'this year') return 'year';
  
  return null;
}

/**
 * Apply time-based filtering for New Releases catalog
 * STRICT DATE FILTERING: Only items with actual lastUpdated dates are included
 * Items without dates are EXCLUDED from New Releases to ensure accuracy
 * @param {Array} series - Array of series objects
 * @param {string} filterType - 'week', 'month', '3months', 'year', 'weekly', 'monthly', or null
 * @returns {Array} Filtered series
 */
function applyTimeFilter(series, filterType) {
  if (!filterType) return series;
  
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  
  return series.filter(item => {
    // STRICT: Only include items with actual lastUpdated date
    // Items without dates are excluded from New Releases for accuracy
    if (!item.lastUpdated) {
      return false;
    }
    
    const itemDate = new Date(item.lastUpdated);
    if (isNaN(itemDate.getTime())) {
      return false;
    }
    
    switch (filterType) {
      case 'week':
      case 'weekly':
        return itemDate >= oneWeekAgo;
      case 'month':
      case 'monthly':
        return itemDate >= oneMonthAgo;
      case '3months':
        return itemDate >= threeMonthsAgo;
      case 'year':
        return itemDate >= oneYearAgo;
      default:
        return false;
    }
  });
}

/**
 * Get effective rating for sorting, using weighted average when available
 * This ensures HentaiMama's actual ratings take precedence over trending/view-based ratings
 */
function getEffectiveRating(series) {
  // If we have a rating breakdown, use weighted average
  if (series.ratingBreakdown && Object.keys(series.ratingBreakdown).length > 0) {
    return ratingNormalizer.calculateWeightedAverage(series.ratingBreakdown);
  }
  // Fall back to direct rating
  return series.rating ?? 0;
}

/**
 * Apply sorting based on catalog type
 * @param {Array} series - Array of series objects
 * @param {string} sortType - 'date', 'rating', 'alphabetical', or 'default'
 * @returns {Array} Sorted series (creates new array, doesn't mutate)
 */
function applySorting(series, sortType) {
  const sorted = [...series];
  
  switch (sortType) {
    case 'date':
      // Sort by lastUpdated, newest first
      sorted.sort((a, b) => compareDatesNewestFirst(a.lastUpdated, b.lastUpdated));
      break;
      
    case 'rating':
      // Sort by weighted rating, highest first
      // This ensures HentaiMama ratings (weight 5.0) dominate over trending (weight 1.0)
      // Secondary sort by name for stable ordering when ratings are equal
      sorted.sort((a, b) => {
        const ratingA = getEffectiveRating(a);
        const ratingB = getEffectiveRating(b);
        const ratingDiff = ratingB - ratingA;
        // If ratings are equal (or very close), sort alphabetically for stable order
        if (Math.abs(ratingDiff) < 0.01) {
          return (a.name || '').localeCompare(b.name || '');
        }
        return ratingDiff;
      });
      break;
      
    case 'alphabetical':
      // Sort by name A-Z
      sorted.sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
      break;
      
    case 'default':
    default:
      // Default: metadata score (higher = better)
      sorted.sort((a, b) => {
        const scoreA = a.metadataScore || 0;
        const scoreB = b.metadataScore || 0;
        return scoreB - scoreA;
      });
      break;
  }
  
  return sorted;
}

/**
 * Apply studio filter
 * @param {Array} series - Array of series objects
 * @param {string} studioName - Studio name to filter by (from genre parameter)
 * @returns {Array} Filtered series
 */
function applyStudioFilter(series, studioName) {
  if (!studioName) return series;
  
  // Extract clean studio name (remove count suffix like " (123)")
  const cleanName = studioName.replace(/\s*\(\d+\)$/, '').trim();
  const normalizedSearch = cleanName.toLowerCase();
  
  return series.filter(item => {
    if (!item.studio) return false;
    
    // Case-insensitive EXACT match only
    // "Edge" should NOT match "Edge Systems" or "Etching Edge"
    const normalizedStudio = item.studio.toLowerCase().trim();
    return normalizedStudio === normalizedSearch;
  });
}

/**
 * Apply year filter
 * @param {Array} series - Array of series objects
 * @param {string} year - Year to filter by (from genre parameter), may include count like "2024 (64)"
 * @returns {Array} Filtered series
 */
function applyYearFilter(series, year) {
  if (!year) return series;
  
  // Extract clean year (remove count suffix like " (123)")
  const cleanYear = year.replace(/\s*\(\d+\)$/, '').trim();
  const targetYear = parseInt(cleanYear);
  if (isNaN(targetYear)) return series;
  
  return series.filter(item => {
    // Check explicit year field
    if (item.year === targetYear) return true;
    
    // Check releaseInfo for year
    if (item.releaseInfo) {
      const match = String(item.releaseInfo).match(/(\d{4})/);
      if (match && parseInt(match[1]) === targetYear) return true;
    }
    
    // Check lastUpdated date year as fallback
    if (item.lastUpdated) {
      const dateYear = new Date(item.lastUpdated).getFullYear();
      if (dateYear === targetYear) return true;
    }
    
    return false;
  });
}

/**
 * Handle "New Releases" catalog - DATABASE ONLY
 * 
 * APPROACH:
 * 1. Get all content from database sorted by date
 * 2. Apply weekly/monthly/3months/year time filter
 * 3. Return paginated results
 * 
 * No scraping needed - the incremental update script handles adding new content.
 */
async function handleNewReleasesCatalog(catalogId, filterType, skip, limit, genre, userConfig) {
  logger.info(`📅 New Releases: filterType=${filterType}, skip=${skip}, limit=${limit}`);
  
  // Step 1: Get database content sorted by date
  const dbItems = getCatalogFromDatabase({
    provider: null,
    genre: genre, // Usually null for New Releases
    skip: 0, // Get all for time filtering
    limit: 1000, // Get enough items for time filtering
    sortBy: 'recent'
  }) || [];
  
  if (dbItems.length === 0) {
    logger.warn(`📦 New Releases: No items in database`);
    return { metas: [] };
  }
  
  logger.info(`📦 New Releases: Database has ${dbItems.length} items sorted by date`);
  
  // Step 2: Apply time filter using centralized function
  // Handles: 'week'/'weekly', 'month'/'monthly', '3months', 'year'
  let filtered = filterType ? applyTimeFilter(dbItems, filterType) : dbItems;
  logger.info(`📅 Time filter (${filterType || 'none'}): ${dbItems.length} → ${filtered.length} items`);
  
  // Step 3: Apply user blacklist
  filtered = filtered.filter(item => shouldIncludeSeries(item, userConfig));
  
  // Step 4: Paginate and format
  const result = filtered.slice(skip, skip + limit);
  const metas = result.map(formatSeriesMeta);
  
  logger.info(`📦 New Releases: returning ${metas.length} items (skip=${skip}, total=${filtered.length})`);
  return { metas };
}

/**
 * Catalog handler with infinite scroll
 * 
 * APPROACH: Database-first, scrapers for new content
 * 1. Check pre-bundled database for instant catalog data
 * 2. For "New Releases" or cache miss, fall back to scrapers
 * 3. Maintain growing cache for scraped content
 */
async function catalogHandler(args) {
  const { type, id, extra = {}, config } = args;
  // Ensure userConfig always has valid structure
  const userConfig = {
    ...DEFAULT_CONFIG,
    ...(config || {})
  };
  
  logger.info(`Catalog request: ${id}`, { type, extra });
  logger.debug(`User config received:`, { 
    blacklistGenres: userConfig.blacklistGenres,
    blacklistStudios: userConfig.blacklistStudios,
    providers: userConfig.providers
  });

  // Handle both 'hentai' (custom type) and 'series' (fallback) types
  if (type !== 'series' && type !== 'hentai') {
    logger.warn(`Unsupported type: ${type} for catalog ${id}`);
    return { metas: [] };
  }

  // Only handle our catalogs
  if (!isOurCatalog(id)) {
    logger.warn(`Unknown catalog ID: ${id}`);
    return { metas: [] };
  }

  // Handle search queries (always use scrapers for live search)
  if (extra.search) {
    return handleSearch(id, extra.search, userConfig);
  }
  
  // Parse catalog ID to get sorting/filtering strategy
  const { sortType, filterType, studioFilter, yearFilter, timePeriodFilter } = parseCatalogId(id);
  logger.info(`Catalog strategy: sortType=${sortType}, filterType=${filterType}, studioFilter=${studioFilter}, yearFilter=${yearFilter}, timePeriodFilter=${timePeriodFilter}`);

  // Extract pagination params early
  const skip = parseInt(extra.skip) || 0;
  const limit = parseInt(extra.limit) || 20;
  const extraGenre = extra.genre || null;
  
  // Clean genre name (remove count suffix like " (1737)")
  const cleanGenre = extraGenre ? extraGenre.replace(/\s*\(\d+\)$/, '').trim() : null;
  
  // Extract genre from catalog ID (e.g., 'hentaimama-genre-uncensored')
  const catalogGenreMatch = id.match(/^hentaimama-genre-(.+)$/);
  const catalogGenre = catalogGenreMatch ? catalogGenreMatch[1] : null;
  
  // For database: use clean genre name (for matching against item.genres array)
  // For scrapers: convert to slug (for URL construction)
  const genreForDatabase = (studioFilter || yearFilter || timePeriodFilter) ? null : cleanGenre;
  const genreSlugForScrapers = (studioFilter || yearFilter || timePeriodFilter) ? catalogGenre : (cleanGenre ? genreNameToSlug(cleanGenre) : catalogGenre);
  
  // ============================================================
  // DATABASE-FIRST: Use pre-bundled database for all catalogs
  // For "new releases": use time period filter from genre dropdown
  // ============================================================
  
  // Determine if this is a New Releases catalog with time period filter
  const timePeriod = timePeriodFilter ? parseTimePeriod(extraGenre) : null;
  const effectiveFilterType = filterType || timePeriod;
  const isNewReleases = filterType === 'weekly' || timePeriodFilter;
  
  if (isDatabaseReady()) {
    const dbSortBy = sortType === 'date' ? 'recent' : (sortType === 'rating' ? 'rating' : 'popular');
    
    // For new releases, we need to:
    // 1. Get fresh content from scrapers (only content newer than database)
    // 2. Merge with database content (sorted by date)
    // 3. Apply time filter on the merged results
    
    if (isNewReleases) {
      return await handleNewReleasesCatalog(id, effectiveFilterType, skip, limit, null, userConfig);
    }
    
    // Extract clean studio/year from extraGenre if this is a studio/year filter catalog
    let studioParam = null;
    let yearParam = null;
    
    if (studioFilter && extraGenre) {
      // Remove count suffix like " (91)" from "Vanilla (91)"
      studioParam = extraGenre.replace(/\s*\(\d+\)$/, '').trim();
    }
    
    if (yearFilter && extraGenre) {
      // Extract year from "2024 (92)" format
      const yearMatch = extraGenre.match(/^(\d{4})/);
      yearParam = yearMatch ? yearMatch[1] : null;
    }
    
    // Try database for catalog data
    // Pass studio/year to filter BEFORE pagination for correct results
    const dbItems = getCatalogFromDatabase({
      provider: null, // All providers for aggregated catalogs
      genre: genreForDatabase,
      studio: studioParam,  // Filter by studio before pagination
      year: yearParam,      // Filter by year before pagination  
      skip: skip,
      limit: limit + 5, // Fetch a few extra for user blacklist filtering
      sortBy: dbSortBy
    });
    
    if (dbItems && dbItems.length > 0) {
      logger.info(`📦 Database hit: ${dbItems.length} items (skip=${skip}, limit=${limit}${studioParam ? ', studio=' + studioParam : ''}${yearParam ? ', year=' + yearParam : ''})`);
      
      // Apply user filters (blacklist only - studio/year already applied in database query)
      let filteredItems = dbItems;
      
      // Apply user blacklist
      filteredItems = filteredItems.filter(item => shouldIncludeSeries(item, userConfig));
      
      // Apply sorting
      filteredItems = applySorting(filteredItems, sortType);
      
      // Convert to Stremio meta format
      const metas = filteredItems.slice(0, limit).map(formatSeriesMeta);
      
      logger.info(`📦 Returning ${metas.length} items from database`);
      return { metas };
    } else {
      logger.debug('Database miss or empty, falling back to scrapers');
    }
  }
  
  // ============================================================
  // SCRAPER FALLBACK: For database miss (shouldn't happen often)
  // ============================================================
  logger.info(`🔍 Using scrapers for catalog: ${id} (fallback - database not ready or empty)`);

  // Determine the sort order to pass to scrapers
  const scraperSortBy = (sortType === 'date') ? 'recent' : 'popular';
  
  logger.info(`Request: skip=${skip}, limit=${limit}`);
  
  const scraper = getScraper(id);
  
  // Determine if we should use single provider or all providers (aggregated catalog)
  // All hentai-* catalogs are aggregated
  const isAggregatedCatalog = id === 'hentai' || 
                              id.startsWith('hentai-') || 
                              id === 'hentaistream-all' || 
                              id.includes('aggregated');
  
  // Use shorter TTL for time-based catalogs (weekly/monthly)
  const ttl = filterType ? cache.getTTL('catalog') / 2 : cache.getTTL('catalog');
  
  // Cache key for the entire accumulated series list
  // Studio/Year catalogs with a specific filter get their own cache keys
  // since they fetch from dedicated URLs
  let baseCatalogId;
  if (yearFilter && extraGenre) {
    baseCatalogId = `hentai-year-${extraGenre}`;
  } else if (studioFilter && extraGenre) {
    // Normalize studio name for cache key
    baseCatalogId = `hentai-studio-${extraGenre.toLowerCase().replace(/\s+/g, '-')}`;
  } else if (id.startsWith('hentai-')) {
    baseCatalogId = 'hentai-base';
  } else {
    baseCatalogId = id;
  }
  const catalogCacheKey = cache.key('catalog', `${baseCatalogId}:${genreSlugForScrapers || 'all'}:accumulated`);
  
  // Get or create the accumulated series cache
  let catalogData = await cache.wrap(catalogCacheKey, ttl, async () => {
    return {
      series: [],          // All series fetched so far
      nextPage: 1,         // Next page to fetch from source
      isComplete: false    // Whether we've reached the end
    };
  });
  
  // For filtered/sorted catalogs, we may need to fetch more items to ensure we have enough after filtering
  // Weekly/Monthly catalogs need to fetch more since many items won't have dates
  let fetchMultiplier = 1;
  if (filterType) {
    fetchMultiplier = 5;  // Weekly/Monthly
  }
  
  // Keep fetching until we have enough series to satisfy skip + limit
  const targetCount = (skip + limit) * fetchMultiplier;
  
  // SPECIAL HANDLING: For year/studio filters, fetch directly from dedicated URLs
  // This is because general catalog pages only have recent content
  const useDirectFetch = (yearFilter && extraGenre) || (studioFilter && extraGenre);
  
  while (catalogData.series.length < targetCount && !catalogData.isComplete) {
    logger.info(`Have ${catalogData.series.length} series, need ${targetCount}, fetching page ${catalogData.nextPage}`);
    
    let providerResults;
    
    if (isAggregatedCatalog) {
      // Multi-provider aggregation: Fetch from enabled providers
      const scrapers = getAllScrapers(userConfig);
      providerResults = await Promise.all(
        scrapers.map(async (scraperInstance) => {
          try {
            let newSeries;
            
            // Use dedicated year/studio endpoints when filtering
            if (yearFilter && extraGenre && typeof scraperInstance.getCatalogByYear === 'function') {
              newSeries = await scraperInstance.getCatalogByYear(extraGenre, catalogData.nextPage);
              
              // If scraper returns null, it doesn't support direct year fetch
              // Fall back to general catalog + local filtering
              if (newSeries === null) {
                newSeries = await scraperInstance.getCatalog(catalogData.nextPage, null, scraperSortBy);
                // Apply strict local year filter since this provider doesn't have year pages
                if (Array.isArray(newSeries)) {
                  const yearNum = parseInt(extraGenre);
                  newSeries = newSeries.filter(item => item.year === yearNum);
                }
              }
            } else if (studioFilter && extraGenre && typeof scraperInstance.getCatalogByStudio === 'function') {
              newSeries = await scraperInstance.getCatalogByStudio(extraGenre, catalogData.nextPage);
              
              // If scraper returns null, fall back to local filtering
              if (newSeries === null) {
                newSeries = await scraperInstance.getCatalog(catalogData.nextPage, null, scraperSortBy);
                if (Array.isArray(newSeries)) {
                  const studioLower = extraGenre.toLowerCase();
                  newSeries = newSeries.filter(item => 
                    item.studio && item.studio.toLowerCase().includes(studioLower)
                  );
                }
              }
            } else if (genreSlugForScrapers) {
              newSeries = await scraperInstance.getCatalogByGenre(genreSlugForScrapers, catalogData.nextPage);
            } else {
              newSeries = await scraperInstance.getCatalog(catalogData.nextPage, null, scraperSortBy);
            }
            
            return {
              provider: scraperInstance.name || 'Unknown',
              catalog: newSeries || []
            };
          } catch (error) {
            logger.error(`Error fetching from ${scraperInstance.name || 'unknown'}:`, error.message);
            return {
              provider: scraperInstance.name || 'Unknown',
              catalog: []
            };
          }
        })
      );
    } else {
      // Single provider: Use specific scraper for this catalog
      try {
        let newSeries;
        if (yearFilter && extraGenre && typeof scraper.getCatalogByYear === 'function') {
          newSeries = await scraper.getCatalogByYear(extraGenre, catalogData.nextPage);
        } else if (studioFilter && extraGenre && typeof scraper.getCatalogByStudio === 'function') {
          newSeries = await scraper.getCatalogByStudio(extraGenre, catalogData.nextPage);
        } else if (genreSlugForScrapers) {
          newSeries = await scraper.getCatalogByGenre(genreSlugForScrapers, catalogData.nextPage);
        } else {
          newSeries = await scraper.getCatalog(catalogData.nextPage, null, scraperSortBy);
        }
        
        providerResults = [{
          provider: scraper.name || 'Unknown',
          catalog: newSeries || []
        }];
      } catch (error) {
        logger.error(`Error fetching from ${scraper.name || 'unknown'}:`, error.message);
        providerResults = [{
          provider: scraper.name || 'Unknown',
          catalog: []
        }];
      }
    }
    
    // Aggregate and deduplicate across providers
    const newAggregatedSeries = aggregateCatalogs(providerResults);
    
    if (!newAggregatedSeries || newAggregatedSeries.length === 0) {
      logger.info(`Page ${catalogData.nextPage} returned no results from any provider - end of catalog`);
      catalogData.isComplete = true;
      break;
    }
    
    // CRITICAL: Deduplicate across ALL accumulated series using NAME-BASED matching!
    // Pages can return same series with different IDs from different providers
    // We need to MERGE duplicates to combine their ratings, not just skip them
    let mergeCount = 0;
    const trulyNewSeries = [];
    
    for (const newSeries of newAggregatedSeries) {
      // Find existing series by name similarity (not just ID)
      const existingIndex = catalogData.series.findIndex(existing => isDuplicate(existing, newSeries));
      
      if (existingIndex >= 0) {
        // Merge with existing series to combine ratings and metadata
        const merged = mergeSeries(catalogData.series[existingIndex], newSeries);
        catalogData.series[existingIndex] = merged;
        mergeCount++;
        logger.debug(`Merged cross-page duplicate: ${newSeries.name} (rating now: ${merged.rating})`);
      } else {
        trulyNewSeries.push(newSeries);
      }
    }
    
    const totalFromProviders = providerResults.reduce((sum, pr) => sum + pr.catalog.length, 0);
    logger.info(`Page ${catalogData.nextPage}: ${totalFromProviders} total items from providers → ${newAggregatedSeries.length} after aggregation → ${trulyNewSeries.length} NEW unique + ${mergeCount} merged with existing`);
    
    // Only add series we don't already have
    if (trulyNewSeries.length > 0) {
      catalogData.series.push(...trulyNewSeries);
    }
    
    // Update cache if anything changed (new series added OR existing merged)
    if (trulyNewSeries.length > 0 || mergeCount > 0) {
      await cache.set(catalogCacheKey, catalogData, ttl);
    }
    
    catalogData.nextPage++;
    
    // Safety: if we get no new series, we're done
    if (trulyNewSeries.length === 0) {
      logger.warn(`⚠️  Page ${catalogData.nextPage - 1} had no new series - end of catalog`);
      catalogData.isComplete = true;
      break;
    }
  }
  
  // Filter out known broken series (cached 500 errors)
  const brokenSeriesKey = cache.key('system', 'broken-series');
  const brokenSeriesSet = new Set(await cache.get(brokenSeriesKey) || []);
  let workingSet = catalogData.series.filter(series => !brokenSeriesSet.has(series.id));
  
  // CRITICAL: Apply smart genre filter to ensure only matching content is shown
  // Uses GenreMatcher for intelligent matching with synonyms, hierarchies, and exclusions
  // Threshold of 70 allows parent-child matches but prevents false positives
  if (extraGenre && !studioFilter && !yearFilter) {
    const beforeGenreFilter = workingSet.length;
    
    workingSet = workingSet.filter(series => {
      if (!series.genres || !Array.isArray(series.genres)) return false;
      
      // Use smart genre matching with 70-point threshold
      // This handles:
      // - Exact matches (100 points): "Cat Girl" = "Cat Girl"
      // - Synonyms (90 points): "Cat Girl" = "Nekomimi"
      // - Parent-child (80 points): "Animal Girls" matches items tagged "Cat Girl"
      // - Grandparent (70 points): 2-level deep hierarchy matching
      // - Explicit exclusions (0 points): "Female Teacher" ≠ "Female Doctor"
      const matches = genreMatcher.matches(extraGenre, series.genres, 70);
      
      // Debug: log best score for non-matching items in first few checks
      if (!matches && beforeGenreFilter < 200) {
        const bestScore = genreMatcher.getBestScore(extraGenre, series.genres);
        if (bestScore > 0) {
          logger.debug(`Genre near-miss: "${series.name}" scored ${bestScore} for "${extraGenre}" (genres: ${series.genres.join(', ')})`);
        }
      }
      
      return matches;
    });
    
    if (beforeGenreFilter !== workingSet.length) {
      logger.info(`Genre filter (${extraGenre}): ${beforeGenreFilter} → ${workingSet.length} items (smart match, threshold 70)`);
    }
  }
  
  // Debug: Log studio and year distribution in cached data
  if (studioFilter || yearFilter) {
    const studiosFound = workingSet.filter(s => s.studio).length;
    const yearsFound = workingSet.filter(s => s.year).length;
    const uniqueStudios = [...new Set(workingSet.map(s => s.studio).filter(Boolean))];
    const uniqueYears = [...new Set(workingSet.map(s => s.year).filter(Boolean))].sort((a, b) => b - a);
    logger.info(`📊 Data stats: ${studiosFound}/${workingSet.length} have studio, ${yearsFound}/${workingSet.length} have year`);
    logger.info(`📊 Unique studios (${uniqueStudios.length}): ${uniqueStudios.slice(0, 10).join(', ')}${uniqueStudios.length > 10 ? '...' : ''}`);
    logger.info(`📊 Unique years (${uniqueYears.length}): ${uniqueYears.join(', ')}`);
  }
  
  // Apply time-based filtering (weekly/monthly)
  // ALWAYS apply strict date filtering for time-based catalogs
  // Items must have lastUpdated within the time window
  if (filterType) {
    const beforeFilter = workingSet.length;
    workingSet = applyTimeFilter(workingSet, filterType);
    logger.info(`Time filter (${filterType}): ${beforeFilter} → ${workingSet.length} items`);
    
    // If filtering removed too many items, log warning
    if (workingSet.length === 0 && beforeFilter > 0) {
      logger.warn(`Time filter (${filterType}) removed all ${beforeFilter} items - items may be missing lastUpdated field`);
    }
  }
  
  // Studio/Year filtering is now done at source level via dedicated URLs
  // Only apply local filtering if we didn't use direct fetch (e.g., browsing without selection)
  // When useDirectFetch is true, the data is already filtered
  
  // Apply sorting based on catalog type
  workingSet = applySorting(workingSet, sortType);
  
  // Apply user's blacklist filters (genres and studios)
  // Ensure userConfig has required properties
  const safeConfig = {
    blacklistGenres: userConfig?.blacklistGenres || [],
    blacklistStudios: userConfig?.blacklistStudios || [],
    providers: userConfig?.providers || DEFAULT_CONFIG.providers
  };
  
  if (safeConfig.blacklistGenres.length > 0 || safeConfig.blacklistStudios.length > 0) {
    logger.info(`Blacklist config: genres=${JSON.stringify(safeConfig.blacklistGenres)}, studios=${JSON.stringify(safeConfig.blacklistStudios)}`);
    const beforeBlacklist = workingSet.length;
    
    // Debug: Log series that will be filtered
    const filteredOut = workingSet.filter(series => !shouldIncludeSeries(series, safeConfig));
    if (filteredOut.length > 0) {
      logger.info(`Blacklist removing ${filteredOut.length} series: ${filteredOut.map(s => `${s.name} (genres: ${(s.genres || []).join(', ')})`).join(' | ')}`);
    }
    
    workingSet = workingSet.filter(series => shouldIncludeSeries(series, safeConfig));
    logger.info(`Blacklist filter: ${beforeBlacklist} → ${workingSet.length} items`);
  }

  // Now slice the exact items requested and format using shared helper
  const result = workingSet.slice(skip, skip + limit);
  const formattedResult = result.map(formatSeriesMeta);
  
  logger.info(`📤 Returning ${formattedResult.length} items (total cached: ${catalogData.series.length}, filtered: ${workingSet.length})`);
  
  return { metas: formattedResult };
}

/**
 * Handle search queries
 * ALWAYS searches database first (fast, case-insensitive, relevance-scored)
 * Falls back to scrapers only if database has no results
 */
async function handleSearch(catalogId, query, userConfig = DEFAULT_CONFIG) {
  // Normalize query to lowercase for case-insensitive search
  const normalizedQuery = query.toLowerCase().trim();
  logger.info(`🔍 Search request: "${query}" → normalized: "${normalizedQuery}" in catalog ${catalogId}`);
  
  const ttl = 900; // 15-minute cache for search results
  
  // Cache key for search results (uses normalized query)
  const searchCacheKey = cache.key('search', `${catalogId}:${normalizedQuery}`);
  
  const results = await cache.wrap(searchCacheKey, ttl, async () => {
    // STEP 1: Always try database search first (instant, relevance-scored)
    const dbResults = searchDatabase(normalizedQuery, { limit: 100 });
    
    if (dbResults && dbResults.length > 0) {
      logger.info(`📚 Database search "${normalizedQuery}" found ${dbResults.length} results (using database)`);
      return dbResults;
    }
    
    // STEP 2: Fall back to scrapers if database has no results
    logger.info(`📡 Database had no results for "${normalizedQuery}", falling back to scrapers`);
    
    // Determine if this is an aggregated catalog search
    const isAggregatedCatalog = catalogId === 'hentai' || 
                                catalogId.startsWith('hentai-') ||
                                catalogId === 'hentaistream-all' || 
                                catalogId.includes('aggregated');
    
    if (isAggregatedCatalog) {
      // Search across enabled providers in parallel
      const scrapers = getAllScrapers(userConfig);
      const searchResults = await Promise.allSettled(
        scrapers.map(async (scraperInstance) => {
          try {
            const results = await scraperInstance.search(normalizedQuery);
            return {
              provider: scraperInstance.name || 'Unknown',
              catalog: results || []
            };
          } catch (error) {
            logger.error(`Search error from ${scraperInstance.name || 'unknown'}:`, error.message);
            return {
              provider: scraperInstance.name || 'Unknown',
              catalog: []
            };
          }
        })
      );
      
      // Collect successful results
      const providerResults = searchResults
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
      
      // Aggregate and deduplicate search results
      const aggregatedResults = aggregateCatalogs(providerResults);
      
      logger.info(`📡 Scraper search "${normalizedQuery}" returned ${aggregatedResults.length} results from ${providerResults.length} providers`);
      return aggregatedResults;
    } else {
      // Single provider search
      const scraper = getScraper(catalogId);
      return await scraper.search(normalizedQuery);
    }
  });
  
  logger.info(`✅ Search "${normalizedQuery}" returning ${results.length} results`);
  
  // Apply user's blacklist filters
  let filteredResults = results;
  if (userConfig.blacklistGenres.length > 0 || userConfig.blacklistStudios.length > 0) {
    filteredResults = results.filter(series => shouldIncludeSeries(series, userConfig));
    logger.info(`Search blacklist filter: ${results.length} → ${filteredResults.length} items`);
  }
  
  // Ensure search results are properly formatted for Stremio
  const formattedResults = filteredResults.map(formatSeriesMeta);
  
  return { metas: formattedResults };
}

module.exports = catalogHandler;
