#!/usr/bin/env node
/**
 * Incremental Database Update Script
 * 
 * Designed to run daily at midnight to add new content without full rebuild.
 * 
 * Strategy:
 * - Scrapes first pages of each provider looking for new content
 * - Stops when finding 2 consecutive existing entries (already in database)
 * - Merges new content with existing database
 * - Updates filter-options.json with new counts
 * 
 * Provider-specific approaches:
 * - HentaiTV: https://hentai.tv/?s= - first entries are newest
 * - HentaiMama: https://hentaimama.io - homepage "monthly releases" section
 * - HentaiSea: https://hentaisea.com/latest-series/ - first page
 * 
 * Usage: 
 *   node scripts/update-database.js
 *   node scripts/update-database.js --dry-run   (preview without saving)
 * 
 * Output: Updates data/catalog.json and data/catalog.json.gz
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Configuration
const CONFIG = {
  outputDir: path.join(__dirname, '..', 'data'),
  catalogFile: 'catalog.json',
  catalogGzFile: 'catalog.json.gz',
  filterOptionsFile: 'filter-options.json',
  
  // Stop after finding this many consecutive existing entries
  consecutiveExistingThreshold: 2,
  
  // Max pages to scan per provider (safety limit)
  maxPagesToScan: 5,
  
  // Delays for rate limiting
  delayBetweenRequests: 500,
  delayBetweenProviders: 1000,
  
  // Parallel batch size for metadata fetching
  parallelBatchSize: 3,
  
  // Retry configuration
  maxRetries: 2,
  retryDelay: 1000,
};

// CLI flags
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

// Setup quiet logger
const logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: VERBOSE ? (...args) => console.log('[DEBUG]', ...args) : () => {},
};

// Suppress scraper debug logs
const utilsLoggerPath = path.join(__dirname, '..', 'src', 'utils', 'logger.js');
if (fs.existsSync(utilsLoggerPath)) {
  const loggerModule = require(utilsLoggerPath);
  if (loggerModule && typeof loggerModule === 'object') {
    loggerModule.info = () => {};
    loggerModule.debug = () => {};
    loggerModule.warn = () => {};
    loggerModule.error = VERBOSE ? console.error : () => {};
  }
}

// Import scrapers
const hentaimamaScraper = require('../src/scrapers/hentaimama');
const hentaiseaScraper = require('../src/scrapers/hentaisea');
const hentaitvScraper = require('../src/scrapers/hentaitv');

// Import rating normalizer
const ratingNormalizer = require('../src/utils/ratingNormalizer');

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper
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
 * Normalize series name for duplicate detection
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/^ova\s+/i, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+(ova|episode|ep|series|season|the animation|animation)(\s+\d+)?$/i, '');
}

/**
 * Levenshtein distance for fuzzy matching
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
 * Check if a series already exists in the database
 * Uses fuzzy matching (85% threshold)
 */
function findExistingEntry(newSeries, existingCatalog, normalizedIndex) {
  const newName = normalizeName(newSeries.name);
  
  // Quick lookup by exact normalized name
  if (normalizedIndex.has(newName)) {
    return normalizedIndex.get(newName);
  }
  
  // Fuzzy match as fallback
  for (const existing of existingCatalog) {
    const existingName = normalizeName(existing.name);
    if (Math.abs(newName.length - existingName.length) <= newName.length * 0.4) {
      const score = similarity(newName, existingName);
      if (score >= 0.85) {
        return existing;
      }
    }
  }
  
  return null;
}

/**
 * Build normalized name index for fast lookups
 */
function buildNormalizedIndex(catalog) {
  const index = new Map();
  for (const item of catalog) {
    const normalizedName = normalizeName(item.name);
    if (!index.has(normalizedName)) {
      index.set(normalizedName, item);
    }
  }
  return index;
}

/**
 * Calculate metadata quality score
 */
function calculateMetadataScore(series) {
  let score = 0;
  const prefix = series.id?.split('-')[0] || '';
  
  if (prefix === 'hmm') score += 10;
  if (series.rating && series.ratingType === 'direct') {
    score += 5;
    if (series.rating >= 8) score += 2;
  }
  if (series.description && series.description.length > 20) {
    score += 3;
    if (series.description.length > 100) score += 1;
  }
  if (series.genres && Array.isArray(series.genres)) {
    score += Math.min(series.genres.length, 5);
  }
  if (series.year) score += 1;
  if (series.studio) score += 1;
  if (series.episodes && series.episodes.length > 0) score += 2;
  
  return score;
}

/**
 * Merge new series with existing entry
 */
function mergeSeries(existing, newSeries) {
  const existingScore = calculateMetadataScore(existing);
  const newScore = calculateMetadataScore(newSeries);
  
  let primary, secondary;
  if (newScore > existingScore) {
    primary = { ...newSeries };
    secondary = existing;
  } else {
    primary = { ...existing };
    secondary = newSeries;
  }
  
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
  
  // Merge description
  if ((!primary.description || primary.description.length < 30) && secondary.description && secondary.description.length > 30) {
    primary.description = secondary.description;
  }
  
  // Merge other fields
  if (!primary.poster && secondary.poster) primary.poster = secondary.poster;
  if (secondary.genres && Array.isArray(secondary.genres)) {
    const allGenres = [...(primary.genres || []), ...secondary.genres];
    primary.genres = [...new Set(allGenres)];
  }
  if (!primary.studio && secondary.studio) primary.studio = secondary.studio;
  if (!primary.year && secondary.year) primary.year = secondary.year;
  
  // Update lastUpdated to most recent
  if (secondary.lastUpdated) {
    const primaryDate = primary.lastUpdated ? new Date(primary.lastUpdated) : new Date(0);
    const secondaryDate = new Date(secondary.lastUpdated);
    if (secondaryDate > primaryDate) {
      primary.lastUpdated = secondary.lastUpdated;
    }
  }
  
  // Merge episodes (prefer more)
  if (secondary.episodes && Array.isArray(secondary.episodes)) {
    if (!primary.episodes || secondary.episodes.length > primary.episodes.length) {
      primary.episodes = secondary.episodes;
    }
  }
  
  primary.metadataScore = calculateMetadataScore(primary);
  
  return primary;
}

/**
 * Fetch full metadata for a series
 */
async function fetchMetadata(scraper, seriesId) {
  try {
    return await withRetry(() => scraper.getMetadata(seriesId));
  } catch (error) {
    logger.debug(`Failed to fetch metadata for ${seriesId}:`, error.message);
    return null;
  }
}

/**
 * Scan a provider for new content
 * Returns array of new/updated series
 * 
 * NOTE: HentaiSea is handled specially - we scan ALL items on page 1
 * because their "latest" page may have new items mixed with old ones.
 * Other providers use consecutive existing detection to stop early.
 */
async function scanProvider(scraper, providerName, existingCatalog, normalizedIndex) {
  const newItems = [];
  let consecutiveExisting = 0;
  let page = 1;
  
  // HentaiSea: Scan all items on page 1, don't use consecutive threshold
  const isHentaiSea = providerName === 'hentaisea';
  const maxPages = isHentaiSea ? 1 : CONFIG.maxPagesToScan; // HentaiSea: first page only
  
  logger.info(`\n📡 Scanning ${providerName} for new content...`);
  if (isHentaiSea) {
    logger.info(`  (HentaiSea: scanning ALL items on page 1)`);
  }
  
  while (page <= maxPages) {
    // For non-HentaiSea, check consecutive threshold
    if (!isHentaiSea && consecutiveExisting >= CONFIG.consecutiveExistingThreshold) {
      break;
    }
    
    try {
      let items = [];
      
      // Provider-specific catalog fetching
      if (providerName === 'hentaitv') {
        // HentaiTV: Use search page for newest content
        items = await withRetry(() => hentaitvScraper.getCatalogFromSearchPage(page));
      } else if (providerName === 'hentaisea') {
        // HentaiSea: Use catalog with 'recent' sort for newest content
        const result = await withRetry(() => hentaiseaScraper.getCatalog(page, null, 'recent'));
        items = Array.isArray(result) ? result : (result?.items || result?.metas || []);
      } else {
        // HentaiMama: Standard catalog with 'recent' sort
        const result = await withRetry(() => scraper.getCatalog(page, null, 'recent'));
        items = Array.isArray(result) ? result : (result?.items || result?.metas || []);
      }
      
      if (!items || items.length === 0) {
        logger.debug(`${providerName}: No items on page ${page}`);
        break;
      }
      
      logger.debug(`${providerName}: Found ${items.length} items on page ${page}`);
      
      for (const item of items) {
        const existing = findExistingEntry(item, existingCatalog, normalizedIndex);
        
        if (existing) {
          consecutiveExisting++;
          logger.debug(`  ↩️ Existing: "${item.name}" (${consecutiveExisting} consecutive)`);
          
          // For HentaiSea, don't stop - continue scanning all items on the page
          if (!isHentaiSea && consecutiveExisting >= CONFIG.consecutiveExistingThreshold) {
            logger.info(`  🛑 Found ${CONFIG.consecutiveExistingThreshold} consecutive existing entries, stopping scan`);
            break;
          }
        } else {
          consecutiveExisting = 0; // Reset counter (only matters for non-HentaiSea)
          newItems.push(item);
          logger.debug(`  ✨ New: "${item.name}"`);
        }
      }
      
      page++;
      await sleep(CONFIG.delayBetweenRequests);
      
    } catch (error) {
      logger.error(`${providerName}: Error on page ${page}:`, error.message);
      break;
    }
  }
  
  // Fetch full metadata for new items in parallel batches
  if (newItems.length > 0) {
    logger.info(`  📥 Fetching metadata for ${newItems.length} new series...`);
    
    const enrichedItems = [];
    for (let i = 0; i < newItems.length; i += CONFIG.parallelBatchSize) {
      const batch = newItems.slice(i, i + CONFIG.parallelBatchSize);
      const results = await Promise.all(
        batch.map(async (item) => {
          const meta = await fetchMetadata(scraper, item.id);
          return meta || item;
        })
      );
      enrichedItems.push(...results);
      
      process.stdout.write(`\r    Progress: ${Math.min(i + CONFIG.parallelBatchSize, newItems.length)}/${newItems.length}    `);
      await sleep(CONFIG.delayBetweenRequests);
    }
    console.log('');
    
    return enrichedItems;
  }
  
  return [];
}

/**
 * Load existing database
 */
function loadDatabase() {
  const gzPath = path.join(CONFIG.outputDir, CONFIG.catalogGzFile);
  const jsonPath = path.join(CONFIG.outputDir, CONFIG.catalogFile);
  
  try {
    if (fs.existsSync(gzPath)) {
      const compressed = fs.readFileSync(gzPath);
      const data = zlib.gunzipSync(compressed).toString('utf8');
      return JSON.parse(data);
    } else if (fs.existsSync(jsonPath)) {
      const data = fs.readFileSync(jsonPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('Failed to load database:', error.message);
  }
  
  return { catalog: [], generatedAt: null };
}

/**
 * Save database with gzip compression
 */
function saveDatabase(database) {
  const jsonPath = path.join(CONFIG.outputDir, CONFIG.catalogFile);
  const gzPath = path.join(CONFIG.outputDir, CONFIG.catalogGzFile);
  
  // Save uncompressed
  fs.writeFileSync(jsonPath, JSON.stringify(database, null, 2));
  
  // Save compressed
  const compressed = zlib.gzipSync(JSON.stringify(database), { level: 9 });
  fs.writeFileSync(gzPath, compressed);
  
  const jsonSize = fs.statSync(jsonPath).size;
  const gzSize = fs.statSync(gzPath).size;
  
  logger.info(`\n💾 Saved database:`);
  logger.info(`   catalog.json: ${(jsonSize / 1024 / 1024).toFixed(2)} MB`);
  logger.info(`   catalog.json.gz: ${(gzSize / 1024).toFixed(1)} KB (${Math.round(gzSize / jsonSize * 100)}% of original)`);
}

/**
 * Update filter-options.json with new counts
 */
function updateFilterOptions(catalog) {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  
  // Count years
  const yearCounts = {};
  for (const item of catalog) {
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
          genreCounts[genre.trim()] = (genreCounts[genre.trim()] || 0) + 1;
        }
      }
    }
  }
  
  // Count time periods
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
        if (itemDate >= oneWeekAgo) timePeriodCounts['This Week']++;
        if (itemDate >= oneMonthAgo) timePeriodCounts['This Month']++;
        if (itemDate >= threeMonthsAgo) timePeriodCounts['3 Months']++;
        if (itemDate >= oneYearAgo) timePeriodCounts['This Year']++;
      }
    }
  }
  
  // Format options
  const years = Object.entries(yearCounts).sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
  const studios = Object.entries(studioCounts)
    .filter(([_, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 300);
  const genres = Object.entries(genreCounts)
    .filter(([_, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  
  const output = {
    years: {
      withCounts: years.map(([year, count]) => `${year} (${count})`),
      clean: years.map(([year]) => String(year)),
      raw: Object.fromEntries(years),
    },
    studios: {
      withCounts: studios.map(([studio, count]) => `${studio} (${count})`),
      clean: studios.map(([studio]) => studio),
      raw: Object.fromEntries(studios),
      total: studios.length,
    },
    genres: {
      withCounts: genres.map(([genre, count]) => `${genre} (${count})`),
      clean: genres.map(([genre]) => genre),
      raw: Object.fromEntries(genres),
      total: genres.length,
    },
    timePeriods: {
      withCounts: Object.entries(timePeriodCounts).map(([period, count]) => `${period} (${count})`),
      raw: timePeriodCounts,
    },
    generatedAt: new Date().toISOString(),
    catalogSize: catalog.length,
  };
  
  const outputPath = path.join(CONFIG.outputDir, CONFIG.filterOptionsFile);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  logger.info(`   ✅ Updated filter-options.json`);
  
  return output;
}

/**
 * Main incremental update function
 */
async function runIncrementalUpdate() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('            🔄 HentaiStream Incremental Database Update');
  console.log('══════════════════════════════════════════════════════════════\n');
  
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be saved\n');
  }
  
  const startTime = Date.now();
  
  // Load existing database
  logger.info('📂 Loading existing database...');
  const database = loadDatabase();
  const existingCatalog = database.catalog || [];
  logger.info(`   Found ${existingCatalog.length} existing series`);
  
  // Build normalized index for fast lookups
  const normalizedIndex = buildNormalizedIndex(existingCatalog);
  logger.info(`   Built name index with ${normalizedIndex.size} entries`);
  
  // Scan each provider
  const allNewItems = [];
  
  const providers = [
    { scraper: hentaimamaScraper, name: 'hentaimama' },
    { scraper: hentaiseaScraper, name: 'hentaisea' },
    { scraper: hentaitvScraper, name: 'hentaitv' },
  ];
  
  for (const { scraper, name } of providers) {
    try {
      const newItems = await scanProvider(scraper, name, existingCatalog, normalizedIndex);
      if (newItems.length > 0) {
        allNewItems.push(...newItems);
        logger.info(`  ✅ ${name}: Found ${newItems.length} new series`);
      } else {
        logger.info(`  ✅ ${name}: No new content`);
      }
    } catch (error) {
      logger.error(`  ❌ ${name}: ${error.message}`);
    }
    
    await sleep(CONFIG.delayBetweenProviders);
  }
  
  // Summary
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('                         📊 Summary');
  console.log('══════════════════════════════════════════════════════════════\n');
  
  if (allNewItems.length === 0) {
    logger.info('✅ Database is up to date - no new content found');
  } else {
    logger.info(`✨ Found ${allNewItems.length} new series to add`);
    
    for (const item of allNewItems) {
      logger.info(`   • ${item.name} (${item.id})`);
    }
    
    if (!DRY_RUN) {
      // Add new items to catalog
      const updatedCatalog = [...existingCatalog];
      
      for (const newItem of allNewItems) {
        // Initialize tracking fields
        const prefix = newItem.id?.split('-')[0] || 'unknown';
        const enrichedItem = {
          ...newItem,
          providers: newItem.providers || [prefix],
          providerSlugs: newItem.providerSlugs || { [prefix]: newItem.id?.replace(`${prefix}-`, '') },
          ratingBreakdown: {},
          metadataScore: calculateMetadataScore(newItem),
          addedAt: new Date().toISOString(),
        };
        
        // Initialize rating breakdown
        if (newItem.rating !== undefined && newItem.rating !== null) {
          enrichedItem.ratingBreakdown[prefix] = {
            raw: newItem.rating,
            type: newItem.ratingType || 'direct',
            voteCount: newItem.voteCount
          };
        }
        
        updatedCatalog.unshift(enrichedItem); // Add to beginning (newest first)
      }
      
      // Update database
      database.catalog = updatedCatalog;
      database.lastUpdated = new Date().toISOString();
      database.incrementalUpdate = true;
      
      // Save
      saveDatabase(database);
      updateFilterOptions(updatedCatalog);
      
      logger.info(`\n✅ Database updated: ${existingCatalog.length} → ${updatedCatalog.length} series`);
    } else {
      logger.info('\n🔍 DRY RUN - Changes not saved');
    }
  }
  
  const duration = Date.now() - startTime;
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);
  
  console.log(`\n⏱️  Completed in ${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`);
  console.log('══════════════════════════════════════════════════════════════\n');
}

// Run if called directly
if (require.main === module) {
  runIncrementalUpdate().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runIncrementalUpdate };
