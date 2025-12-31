#!/usr/bin/env node
/**
 * Database Builder Script
 * 
 * Pre-scrapes all data from HentaiMama, HentaiTV, and HentaiSea
 * and stores it as a bundled JSON database in the addon.
 * 
 * This includes FULL METADATA with episodes and release dates
 * so users get instant loading when clicking on a series.
 * 
 * Usage: node scripts/build-database.js
 * 
 * Output: data/catalog.json (gzipped as catalog.json.gz for production)
 * 
 * This script is designed to be run:
 * - Manually during development
 * - Via GitHub Actions for automated updates
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Setup logger before requiring scrapers (they may depend on it)
// QUIET MODE: Suppress scraper debug logs during build
const logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: () => {}, // Suppress debug logs
};

// Override the utils logger for this script to suppress noisy logs
const utilsLoggerPath = path.join(__dirname, '..', 'src', 'utils', 'logger.js');
if (fs.existsSync(utilsLoggerPath)) {
  const loggerModule = require(utilsLoggerPath);
  if (loggerModule && typeof loggerModule === 'object') {
    // Override all log methods to be quiet
    loggerModule.info = () => {};
    loggerModule.debug = () => {};
    loggerModule.warn = () => {};
    loggerModule.error = (...args) => console.error('[SCRAPER]', ...args);
  }
}

// Import scrapers
const hentaimamaScraper = require('../src/scrapers/hentaimama');
const hentaiseaScraper = require('../src/scrapers/hentaisea');
const hentaitvScraper = require('../src/scrapers/hentaitv');

// Import rating normalizer for final rating computation
const ratingNormalizer = require('../src/utils/ratingNormalizer');

// TEST MODE: Run with --test flag to only fetch 100 items per provider
const TEST_MODE = process.argv.includes('--test');

// Configuration
const CONFIG = {
  outputDir: path.join(__dirname, '..', 'data'),
  catalogFile: TEST_MODE ? 'catalog-test.json' : 'catalog.json',
  catalogGzFile: TEST_MODE ? 'catalog-test.json.gz' : 'catalog.json.gz',
  metadataFile: 'metadata.json',
  metadataGzFile: 'metadata.json.gz',
  
  // Scraping limits (set to Infinity for full scrape)
  maxPagesPerProvider: TEST_MODE ? 5 : Infinity,
  maxSeriesPerProvider: TEST_MODE ? 100 : Infinity,
  
  // FULL METADATA: Fetch episodes for each series (makes detail views instant)
  fetchFullMetadata: true,
  
  // PARALLEL PROCESSING: Much faster than sequential!
  parallelBatchSize: 5, // Fetch 5 items in parallel
  delayBetweenBatches: 300, // ms - delay between parallel batches
  
  // Rate limiting for catalog pages
  delayBetweenPages: 500, // ms
  
  // Retry configuration
  maxRetries: 2,
  retryDelay: 1000, // ms
};

/**
 * Format time duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Progress bar helper
 */
function progressBar(current, total, width = 30) {
  const percent = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `[${bar}] ${percent}% (${current}/${total})`;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize series name for duplicate detection
 * @param {string} name - Series name
 * @returns {string} Normalized name
 */
function normalizeName(name) {
  if (!name) return '';
  
  return name
    .toLowerCase()
    .trim()
    // Remove common prefixes like "OVA", "Ova"
    .replace(/^ova\s+/i, '')
    // Remove special characters but keep spaces
    .replace(/[^\w\s-]/g, '')
    // Normalize multiple spaces to single space
    .replace(/\s+/g, ' ')
    // Remove common suffixes
    .replace(/\s+(ova|episode|ep|series|season|the animation|animation)(\s+\d+)?$/i, '');
}

/**
 * Calculate Levenshtein distance between two strings
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
 * Calculate similarity between two strings (0-1)
 */
function similarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Check if two series are duplicates
 * Uses fuzzy matching with 85% threshold for cross-provider matching
 */
function isDuplicate(series1, series2) {
  const name1 = normalizeName(series1.name);
  const name2 = normalizeName(series2.name);
  
  // Exact match after normalization
  if (name1 === name2) return true;
  
  // Skip if names are too different in length (optimization)
  if (Math.abs(name1.length - name2.length) > name1.length * 0.4) return false;
  
  // Fuzzy match (85% similarity threshold for cross-provider)
  const score = similarity(name1, name2);
  return score >= 0.85;
}

/**
 * Calculate metadata quality score
 * HentaiMama gets bonus for having real user ratings
 */
function calculateMetadataScore(series) {
  let score = 0;
  const prefix = series.id?.split('-')[0] || '';
  
  // HentaiMama bonus (primary source with real ratings)
  if (prefix === 'hmm') score += 10;
  
  // Rating bonus (only for direct ratings, not view-based)
  if (series.rating && series.ratingType === 'direct') {
    score += 5;
    if (series.rating >= 8) score += 2;
  }
  
  // Description bonus
  if (series.description && series.description.length > 20) {
    score += 3;
    if (series.description.length > 100) score += 1;
  }
  
  // Genres bonus
  if (series.genres && Array.isArray(series.genres)) {
    score += Math.min(series.genres.length, 5);
  }
  
  // Year bonus
  if (series.year) score += 1;
  
  // Studio bonus
  if (series.studio) score += 1;
  
  // Episodes bonus (has full metadata)
  if (series.episodes && series.episodes.length > 0) {
    score += 2;
  }
  
  return score;
}

/**
 * Merge two series, keeping best metadata from each
 * Primary = series with higher metadata score
 */
function mergeSeries(existing, newSeries) {
  const existingScore = calculateMetadataScore(existing);
  const newScore = calculateMetadataScore(newSeries);
  
  // Swap if new series has better metadata
  let primary, secondary;
  if (newScore > existingScore) {
    primary = { ...newSeries };
    secondary = existing;
  } else {
    primary = { ...existing };
    secondary = newSeries;
  }
  
  // Get prefixes
  const primaryPrefix = primary.id?.split('-')[0] || 'unknown';
  const secondaryPrefix = secondary.id?.split('-')[0] || 'unknown';
  
  // Initialize tracking arrays
  primary.providers = primary.providers || [primaryPrefix];
  primary.providerSlugs = primary.providerSlugs || { [primaryPrefix]: primary.id?.replace(`${primaryPrefix}-`, '') };
  primary.ratingBreakdown = primary.ratingBreakdown || {};
  
  // Add secondary provider
  if (!primary.providers.includes(secondaryPrefix)) {
    primary.providers.push(secondaryPrefix);
  }
  primary.providerSlugs[secondaryPrefix] = secondary.id?.replace(`${secondaryPrefix}-`, '');
  
  // Merge rating breakdown
  if (secondary.rating !== undefined && secondary.rating !== null) {
    primary.ratingBreakdown[secondaryPrefix] = {
      raw: secondary.rating,
      type: secondary.ratingType || 'direct',
      voteCount: secondary.voteCount
    };
  }
  if (secondary.viewCount !== undefined) {
    primary.ratingBreakdown[secondaryPrefix] = {
      raw: secondary.viewCount,
      type: 'views'
    };
  }
  // Add primary's rating if not already in breakdown
  if (primary.rating !== undefined && !primary.ratingBreakdown[primaryPrefix]) {
    primary.ratingBreakdown[primaryPrefix] = {
      raw: primary.rating,
      type: primary.ratingType || 'direct',
      voteCount: primary.voteCount
    };
  }
  
  // Merge description (prefer longer, non-promotional)
  if ((!primary.description || primary.description.length < 30) && secondary.description && secondary.description.length > 30) {
    primary.description = secondary.description;
  }
  
  // Merge poster
  if (!primary.poster && secondary.poster) {
    primary.poster = secondary.poster;
  }
  
  // Merge genres (deduplicate)
  if (secondary.genres && Array.isArray(secondary.genres)) {
    const allGenres = [...(primary.genres || []), ...secondary.genres];
    // Filter out studio names from genres
    const studioName = primary.studio || secondary.studio;
    primary.genres = [...new Set(
      studioName 
        ? allGenres.filter(g => g.toLowerCase() !== studioName.toLowerCase())
        : allGenres
    )];
  }
  
  // Merge studio (prefer existing)
  if (!primary.studio && secondary.studio) {
    primary.studio = secondary.studio;
  }
  
  // Merge year (prefer non-null)
  if (!primary.year && secondary.year) {
    primary.year = secondary.year;
  }
  
  // Merge lastUpdated (keep most recent)
  if (secondary.lastUpdated) {
    const primaryDate = primary.lastUpdated ? new Date(primary.lastUpdated) : new Date(0);
    const secondaryDate = new Date(secondary.lastUpdated);
    if (secondaryDate > primaryDate) {
      primary.lastUpdated = secondary.lastUpdated;
    }
  }
  
  // Merge episodes (prefer more episodes)
  if (secondary.episodes && Array.isArray(secondary.episodes)) {
    if (!primary.episodes || secondary.episodes.length > primary.episodes.length) {
      primary.episodes = secondary.episodes;
    }
  }
  
  // Recalculate metadata score
  primary.metadataScore = calculateMetadataScore(primary);
  
  return primary;
}

/**
 * Deduplicate catalog across all providers
 * Returns merged catalog with best metadata from each provider
 */
function deduplicateCatalog(allItems) {
  console.log(`\n🔍 Deduplicating ${allItems.length} items across providers...\n`);
  
  const deduplicated = [];
  const startTime = Date.now();
  let mergeCount = 0;
  
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    
    // Find existing duplicate in deduplicated list
    const existingIndex = deduplicated.findIndex(d => isDuplicate(d, item));
    
    if (existingIndex >= 0) {
      // Merge with existing
      deduplicated[existingIndex] = mergeSeries(deduplicated[existingIndex], item);
      mergeCount++;
    } else {
      // Add as new (initialize tracking fields)
      const prefix = item.id?.split('-')[0] || 'unknown';
      const newItem = {
        ...item,
        providers: item.providers || [prefix],
        providerSlugs: item.providerSlugs || { [prefix]: item.id?.replace(`${prefix}-`, '') },
        ratingBreakdown: {},
        metadataScore: calculateMetadataScore(item)
      };
      
      // Initialize rating breakdown
      if (item.rating !== undefined && item.rating !== null) {
        newItem.ratingBreakdown[prefix] = {
          raw: item.rating,
          type: item.ratingType || 'direct',
          voteCount: item.voteCount
        };
      }
      if (item.viewCount !== undefined) {
        newItem.ratingBreakdown[prefix] = {
          raw: item.viewCount,
          type: 'views'
        };
      }
      
      deduplicated.push(newItem);
    }
    
    // Progress update every 500 items
    if (i % 500 === 0 && i > 0) {
      process.stdout.write(`\r   ${progressBar(i, allItems.length)} | ${deduplicated.length} unique | ${mergeCount} merged   `);
    }
  }
  
  // Final pass: compute best rating for each item using priority system
  console.log(`\n\n   Computing final ratings using priority system (hmm > htv > hse)...\n`);
  
  for (const item of deduplicated) {
    if (Object.keys(item.ratingBreakdown).length > 0) {
      const ratingResult = ratingNormalizer.getPriorityRating(item.ratingBreakdown);
      item.rating = ratingResult.rating;
      item.ratingSource = ratingResult.source;
      item.ratingIsNA = ratingResult.isNA;
    } else {
      item.rating = null;
      item.ratingIsNA = true;
    }
  }
  
  const duration = Date.now() - startTime;
  console.log(`   ✅ Deduplication complete: ${allItems.length} → ${deduplicated.length} (${mergeCount} merged) in ${formatDuration(duration)}\n`);
  
  // Stats by primary ID prefix
  const prefixStats = {};
  for (const item of deduplicated) {
    const prefix = item.id?.split('-')[0] || 'unknown';
    prefixStats[prefix] = (prefixStats[prefix] || 0) + 1;
  }
  console.log(`   By primary ID: ${JSON.stringify(prefixStats)}`);
  
  // Stats by provider coverage
  const coverageStats = { '1 provider': 0, '2 providers': 0, '3 providers': 0 };
  for (const item of deduplicated) {
    const count = item.providers?.length || 1;
    const key = `${count} provider${count > 1 ? 's' : ''}`;
    coverageStats[key] = (coverageStats[key] || 0) + 1;
  }
  console.log(`   Coverage: ${JSON.stringify(coverageStats)}\n`);
  
  return deduplicated;
}

/**
 * Generate filter-options.json with dynamic year, studio, genre, and time-period counts
 * This file is read by manifest.js to populate filter dropdowns
 * @param {Array} catalog - Deduplicated catalog
 * @param {string} outputDir - Directory to save the file
 */
function generateFilterOptions(catalog, outputDir) {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  
  // Count years
  const yearCounts = {};
  for (const item of catalog) {
    // Count by year field
    if (item.year) {
      const year = String(item.year);
      yearCounts[year] = (yearCounts[year] || 0) + 1;
    }
  }
  
  // Count studios
  const studioCounts = {};
  for (const item of catalog) {
    if (item.studio && item.studio.trim()) {
      const studio = item.studio.trim();
      studioCounts[studio] = (studioCounts[studio] || 0) + 1;
    }
  }
  
  // Count genres
  const genreCounts = {};
  for (const item of catalog) {
    if (item.genres && Array.isArray(item.genres)) {
      for (const genre of item.genres) {
        if (genre && genre.trim()) {
          const g = genre.trim();
          genreCounts[g] = (genreCounts[g] || 0) + 1;
        }
      }
    }
  }
  
  // Count time periods (based on lastUpdated)
  const timePeriodCounts = {
    'This Week': 0,
    'This Month': 0,
    '3 Months': 0,
    'This Year': 0,
  };
  
  for (const item of catalog) {
    if (item.lastUpdated) {
      const itemDate = new Date(item.lastUpdated);
      if (!isNaN(itemDate.getTime())) {
        if (itemDate >= oneWeekAgo) {
          timePeriodCounts['This Week']++;
        }
        if (itemDate >= oneMonthAgo) {
          timePeriodCounts['This Month']++;
        }
        if (itemDate >= threeMonthsAgo) {
          timePeriodCounts['3 Months']++;
        }
        if (itemDate >= oneYearAgo) {
          timePeriodCounts['This Year']++;
        }
      }
    }
  }
  
  // Count episodes with release dates
  let episodesTotal = 0;
  let episodesWithReleased = 0;
  for (const item of catalog) {
    if (item.episodes && Array.isArray(item.episodes)) {
      episodesTotal += item.episodes.length;
      episodesWithReleased += item.episodes.filter(ep => ep.released).length;
    }
  }
  
  // Truncate long studio names
  function truncateStudioName(name, maxLen = 30) {
    if (!name || name.length <= maxLen) return name;
    return name.substring(0, maxLen - 3) + '...';
  }
  
  // Sort by count descending, then alphabetically
  const years = Object.entries(yearCounts)
    .sort((a, b) => parseInt(b[0]) - parseInt(a[0])); // Sort by year descending
  
  const studios = Object.entries(studioCounts)
    .filter(([_, count]) => count >= 1) // Include all studios with 1+ series
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) // Sort by count desc, then name
    .slice(0, 300); // Top 300 studios
  
  const genres = Object.entries(genreCounts)
    .filter(([_, count]) => count >= 1) // Include all genres with 1+ series
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); // Sort by count desc, then name
  
  // Format with counts
  const yearOptions = years.map(([year, count]) => `${year} (${count})`);
  const studioOptions = studios.map(([studio, count]) => {
    const displayName = truncateStudioName(studio);
    return `${displayName} (${count})`;
  });
  const genreOptions = genres.map(([genre, count]) => `${genre} (${count})`);
  const timePeriodOptions = Object.entries(timePeriodCounts)
    .map(([period, count]) => `${period} (${count})`);
  
  // Clean versions (without counts, for filtering)
  const cleanYearOptions = years.map(([year]) => String(year));
  const cleanStudioOptions = studios.map(([studio]) => studio);
  const cleanGenreOptions = genres.map(([genre]) => genre);
  
  const output = {
    years: {
      withCounts: yearOptions,
      clean: cleanYearOptions,
      raw: Object.fromEntries(years),
    },
    studios: {
      withCounts: studioOptions,
      clean: cleanStudioOptions,
      raw: Object.fromEntries(studios),
      total: studios.length,
    },
    genres: {
      withCounts: genreOptions,
      clean: cleanGenreOptions,
      raw: Object.fromEntries(genres),
      total: genres.length,
    },
    timePeriods: {
      withCounts: timePeriodOptions,
      raw: timePeriodCounts,
    },
    episodeDates: {
      total: episodesTotal,
      withReleased: episodesWithReleased,
      percentage: episodesTotal > 0 ? Math.round(episodesWithReleased / episodesTotal * 100) : 0,
    },
    generatedAt: new Date().toISOString(),
    catalogSize: catalog.length,
  };
  
  // Save to file
  const outputPath = path.join(outputDir, 'filter-options.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`   ✅ Saved filter-options.json (${years.length} years, ${studios.length} studios, ${genres.length} genres)`);
  
  return output;
}

/**
 * Retry wrapper (quiet - no logging)
 */
async function withRetry(fn, retries = CONFIG.maxRetries) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i < retries - 1) {
        await sleep(CONFIG.retryDelay);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Scrape all catalog items from a provider
 */
async function scrapeCatalog(scraper, providerName) {
  const allItems = [];
  let page = 1;
  let hasMore = true;
  
  process.stdout.write(`\n📥 ${providerName}: Fetching catalog... `);
  
  while (hasMore && page <= CONFIG.maxPagesPerProvider) {
    try {
      const result = await withRetry(() => 
        scraper.getCatalog(page, null, 'popular')
      );
      
      let items = Array.isArray(result) ? result : (result?.items || result?.metas || []);
      
      if (!items || items.length === 0) {
        hasMore = false;
        break;
      }
      
      allItems.push(...items);
      
      // Simple progress: show page number
      process.stdout.write(`\r📥 ${providerName}: Page ${page} (${allItems.length} series so far)    `);
      
      if (allItems.length >= CONFIG.maxSeriesPerProvider) break;
      
      hasMore = items.length >= 20;
      page++;
      
      await sleep(CONFIG.delayBetweenPages);
      
    } catch (error) {
      break;
    }
  }
  
  console.log(`\r✅ ${providerName}: ${allItems.length} series from ${page} pages                    `);
  return allItems;
}

/**
 * Scrape HentaiTV catalog using search pages (special method)
 * HentaiTV requires getCatalogFromSearchPage instead of getCatalog
 */
async function scrapeHentaiTVCatalog() {
  const seriesMap = new Map();
  let page = 1;
  let consecutiveEmptyPages = 0;
  const MAX_EMPTY_PAGES = 3;
  const MAX_PAGES = 200;
  
  process.stdout.write(`\n📥 hentaitv: Fetching catalog via search pages... `);
  
  while (page <= MAX_PAGES && consecutiveEmptyPages < MAX_EMPTY_PAGES) {
    try {
      const items = await withRetry(() => 
        hentaitvScraper.getCatalogFromSearchPage(page)
      );
      
      if (!items || items.length === 0) {
        consecutiveEmptyPages++;
        page++;
        await sleep(CONFIG.delayBetweenPages);
        continue;
      }
      
      consecutiveEmptyPages = 0;
      
      // Merge items (dedupe by ID, accumulate views)
      for (const item of items) {
        const existing = seriesMap.get(item.id);
        if (!existing) {
          seriesMap.set(item.id, { ...item });
        } else {
          // Merge: take better metadata
          existing.totalViews = (existing.totalViews || 0) + (item.totalViews || 0);
          existing.episodeCount = Math.max(existing.episodeCount || 1, item.episodeCount || 1);
          if ((item.viewCount || 0) > (existing.viewCount || 0)) existing.viewCount = item.viewCount;
          if (!existing.description && item.description) existing.description = item.description;
          if (!existing.poster && item.poster) existing.poster = item.poster;
          if (!existing.genres && item.genres) existing.genres = item.genres;
        }
      }
      
      process.stdout.write(`\r📥 hentaitv: Page ${page} (${seriesMap.size} unique series)    `);
      
      page++;
      await sleep(CONFIG.delayBetweenPages);
      
    } catch (error) {
      consecutiveEmptyPages++;
      page++;
      await sleep(CONFIG.delayBetweenPages * 2);
    }
  }
  
  const allItems = Array.from(seriesMap.values());
  console.log(`\r✅ hentaitv: ${allItems.length} series from ${page - 1} pages                    `);
  return allItems;
}

/**
 * Scrape trending items from a provider (only HentaiSea supports this)
 */
async function scrapeTrending(scraper, providerName) {
  if (typeof scraper.getTrending !== 'function') {
    return [];
  }
  
  try {
    process.stdout.write(`📈 ${providerName}: Fetching trending... `);
    const result = await withRetry(() => scraper.getTrending(1));
    const items = Array.isArray(result) ? result : (result?.items || result?.metas || []);
    console.log(`✅ ${items.length} trending items`);
    return items;
  } catch (error) {
    console.log(`⚠️ skipped`);
    return [];
  }
}

/**
 * Scrape metadata for a series (quiet - no logging)
 */
async function scrapeMetadata(scraper, seriesId) {
  try {
    return await withRetry(() => scraper.getMetadata(seriesId));
  } catch (error) {
    return null;
  }
}

/**
 * Fetch full metadata using PARALLEL processing
 * Much faster than sequential - processes multiple items at once
 */
async function enrichWithFullMetadata(items, scraper, providerName) {
  if (!CONFIG.fetchFullMetadata) {
    return items;
  }
  
  // Limit items in TEST_MODE
  const itemsToProcess = items.slice(0, CONFIG.maxSeriesPerProvider);
  const total = itemsToProcess.length;
  const enrichedItems = [];
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();
  
  console.log(`\n📚 Enriching ${total} items with episode data (${CONFIG.parallelBatchSize} parallel)...\n`);
  
  // Process in parallel batches
  for (let i = 0; i < itemsToProcess.length; i += CONFIG.parallelBatchSize) {
    const batch = itemsToProcess.slice(i, i + CONFIG.parallelBatchSize);
    
    // Fetch batch in parallel
    const results = await Promise.all(
      batch.map(async (item) => {
        const fullMeta = await scrapeMetadata(scraper, item.id);
        
        if (fullMeta?.episodes?.length > 0) {
          return {
            ...item,
            episodes: fullMeta.episodes.map(ep => ({
              number: ep.number,
              id: ep.id,
              slug: ep.slug,
              title: ep.title || `Episode ${ep.number}`,
              poster: ep.poster || undefined,
              released: ep.released || undefined,
            })),
            description: fullMeta.description || item.description,
            genres: fullMeta.genres || item.genres,
            studio: fullMeta.studio || item.studio,
            lastUpdated: fullMeta.lastUpdated || item.lastUpdated,
            releaseInfo: fullMeta.releaseInfo || item.releaseInfo,
            hasFullMeta: true,
          };
        }
        return { ...item, hasFullMeta: false };
      })
    );
    
    // Count results
    for (const item of results) {
      enrichedItems.push(item);
      if (item.hasFullMeta) successCount++;
      else failCount++;
    }
    
    // Progress update with ETA
    const done = i + batch.length;
    const elapsed = Date.now() - startTime;
    const rate = done / (elapsed / 1000); // items per second
    const remaining = total - done;
    const eta = remaining / rate * 1000;
    
    process.stdout.write(`\r   ${progressBar(done, total)} | ✅ ${successCount} | ❌ ${failCount} | ⏱️ ETA: ${formatDuration(eta)}   `);
    
    // Small delay between batches to avoid rate limiting
    if (i + CONFIG.parallelBatchSize < items.length) {
      await sleep(CONFIG.delayBetweenBatches);
    }
  }
  
  const totalTime = Date.now() - startTime;
  console.log(`\n\n   ✅ Done in ${formatDuration(totalTime)} | ${successCount} enriched, ${failCount} failed\n`);
  
  return enrichedItems;
}

/**
 * Build the complete database
 */
async function buildDatabase() {
  const startTime = Date.now();
  
  console.log('\n' + '═'.repeat(60));
  console.log('  🚀 DATABASE BUILD STARTED');
  if (TEST_MODE) {
    console.log('  ⚡ TEST MODE: Limited to 100 items per provider');
  }
  console.log('  ' + new Date().toISOString());
  console.log('═'.repeat(60));
  
  // Ensure output directory exists
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }
  
  const database = {
    version: 2, // Version 2: includes full metadata with episodes
    buildDate: new Date().toISOString(),
    providers: {},
    catalog: [],
    slugRegistry: {},
    stats: {
      totalSeries: 0,
      totalEnriched: 0,
      totalEpisodes: 0,
      byProvider: {}
    }
  };
  
  // Scrape each provider
  const providers = [
    { scraper: hentaimamaScraper, name: 'hentaimama', prefix: 'hmm' },
    { scraper: hentaiseaScraper, name: 'hentaisea', prefix: 'hse' },
    { scraper: hentaitvScraper, name: 'hentaitv', prefix: 'htv', useSearchPages: true },
  ];
  
  for (let p = 0; p < providers.length; p++) {
    const { scraper, name, prefix, useSearchPages } = providers[p];
    
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  📦 PROVIDER ${p + 1}/${providers.length}: ${name.toUpperCase()}`);
    console.log(`${'─'.repeat(60)}`);
    
    try {
      // Scrape catalog - HentaiTV uses special search page method
      const catalogItems = useSearchPages 
        ? await scrapeHentaiTVCatalog()
        : await scrapeCatalog(scraper, name);
      
      // Scrape trending (HentaiTV doesn't support this)
      const trendingItems = useSearchPages ? [] : await scrapeTrending(scraper, name);
      
      // Merge catalog and trending (dedup by ID)
      const seenIds = new Set(catalogItems.map(item => item.id));
      const uniqueTrending = trendingItems.filter(item => !seenIds.has(item.id));
      
      let allItems = [...catalogItems, ...uniqueTrending];
      
      // ENRICH WITH FULL METADATA (episodes, release dates)
      // This makes detail views instant for users - no loading required
      allItems = await enrichWithFullMetadata(allItems, scraper, name);
      
      // Store provider data
      database.providers[prefix] = {
        name: name,
        itemCount: allItems.length,
        enrichedCount: allItems.filter(i => i.hasFullMeta).length,
        scrapedAt: new Date().toISOString()
      };
      
      // Add items to catalog with proper provider tracking
      for (const item of allItems) {
        // Ensure ID has proper prefix
        const properItem = {
          ...item,
          id: item.id.startsWith(`${prefix}-`) ? item.id : `${prefix}-${item.id}`,
          provider: prefix,
        };
        
        // Add to slug registry
        const slug = item.id.replace(`${prefix}-`, '').replace(`${name}-`, '');
        database.slugRegistry[slug] = database.slugRegistry[slug] || {};
        database.slugRegistry[slug][prefix] = {
          id: properItem.id,
          name: item.name,
          rating: item.rating,
          ratingType: item.ratingType || 'direct',
          year: item.year,
          poster: item.poster
        };
        
        database.catalog.push(properItem);
      }
      
      database.stats.byProvider[prefix] = allItems.length;
      
    } catch (error) {
      console.error(`\n❌ Failed to scrape ${name}: ${error.message}`);
      database.providers[prefix] = {
        name: name,
        itemCount: 0,
        error: error.message,
        scrapedAt: new Date().toISOString()
      };
    }
    
    // Small delay between providers
    await sleep(1000);
  }
  
  // DEDUPLICATION STEP: Merge duplicates across providers
  // This ensures "Sister Breeder" appears once with the best metadata from all providers
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  🔗 DEDUPLICATING ACROSS PROVIDERS');
  console.log(`${'─'.repeat(60)}`);
  
  const beforeCount = database.catalog.length;
  database.catalog = deduplicateCatalog(database.catalog);
  const afterCount = database.catalog.length;
  
  console.log(`   Reduced from ${beforeCount} to ${afterCount} unique series`);
  console.log(`   ${beforeCount - afterCount} duplicates merged\n`);
  
  // Rebuild slug registry from deduplicated catalog
  database.slugRegistry = {};
  for (const item of database.catalog) {
    // Add all provider slugs from the merged item
    if (item.providerSlugs) {
      for (const [prefix, slug] of Object.entries(item.providerSlugs)) {
        database.slugRegistry[slug] = database.slugRegistry[slug] || {};
        database.slugRegistry[slug][prefix] = {
          id: item.id,
          name: item.name,
          rating: item.rating,
          ratingType: item.ratingType || 'direct',
          year: item.year,
          poster: item.poster
        };
      }
    }
  }
  
  // Calculate totals after deduplication
  database.stats.totalSeries = database.catalog.length;
  database.stats.totalEnriched = database.catalog.filter(i => i.hasFullMeta).length;
  database.stats.totalEpisodes = database.catalog.reduce((sum, item) => 
    sum + (item.episodes ? item.episodes.length : 0), 0
  );
  database.stats.duplicatesMerged = beforeCount - afterCount;
  
  // Count items with ratings
  const withRating = database.catalog.filter(i => i.rating !== null && i.rating !== undefined && !i.ratingIsNA).length;
  database.stats.withRating = withRating;
  
  // Write catalog JSON
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  💾 SAVING DATABASE');
  console.log(`${'─'.repeat(60)}\n`);
  
  const catalogPath = path.join(CONFIG.outputDir, CONFIG.catalogFile);
  fs.writeFileSync(catalogPath, JSON.stringify(database, null, 2));
  const catalogSize = fs.statSync(catalogPath).size;
  console.log(`   📄 ${CONFIG.catalogFile}: ${(catalogSize / 1024 / 1024).toFixed(2)} MB`);
  
  // Write gzipped version
  const gzPath = path.join(CONFIG.outputDir, CONFIG.catalogGzFile);
  const gzipped = zlib.gzipSync(JSON.stringify(database));
  fs.writeFileSync(gzPath, gzipped);
  const gzSize = gzipped.length;
  console.log(`   📦 ${CONFIG.catalogGzFile}: ${(gzSize / 1024 / 1024).toFixed(2)} MB (${((1 - gzSize / catalogSize) * 100).toFixed(0)}% compression)`);
  
  // Generate dynamic filter options from the deduplicated catalog
  console.log(`\n   📊 Generating filter-options.json...`);
  generateFilterOptions(database.catalog, CONFIG.outputDir);
  
  const totalTime = Date.now() - startTime;
  
  console.log('\n' + '═'.repeat(60));
  console.log('  📊 BUILD COMPLETE');
  console.log('═'.repeat(60));
  console.log(`
   Total Series:    ${database.stats.totalSeries.toLocaleString()} (${database.stats.duplicatesMerged} duplicates merged)
   With Ratings:    ${database.stats.withRating.toLocaleString()} (${Math.round(database.stats.withRating / database.stats.totalSeries * 100)}%)
   With Episodes:   ${database.stats.totalEnriched.toLocaleString()} (${Math.round(database.stats.totalEnriched / database.stats.totalSeries * 100)}%)
   Total Episodes:  ${database.stats.totalEpisodes.toLocaleString()}
   
   By Provider (before dedupe):
     • hmm: ${database.stats.byProvider.hmm?.toLocaleString() || 0}
     • hse: ${database.stats.byProvider.hse?.toLocaleString() || 0}
     • htv: ${database.stats.byProvider.htv?.toLocaleString() || 0}
   
   Build Time:      ${formatDuration(totalTime)}
   Database Size:   ${(gzSize / 1024 / 1024).toFixed(2)} MB (gzipped)
`);
  console.log('═'.repeat(60) + '\n');
  
  return database;
}

// Main entry point
if (require.main === module) {
  buildDatabase()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Database build failed:', error.message);
      process.exit(1);
    });
}

module.exports = { buildDatabase };
