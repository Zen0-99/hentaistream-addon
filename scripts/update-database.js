#!/usr/bin/env node
/**
 * Incremental Database Update Script
 * 
 * Designed to run daily at midnight to add new content without full rebuild.
 * 
 * Strategy:
 * - HentaiMama: Uses new-monthly-hentai page which shows ALL recent episodes
 *   - Scans entire first page to catch new episodes of existing series
 *   - Detects both new series AND new episodes for existing series
 * - HentaiTV/HentaiSea: Uses standard catalog with consecutive existing detection
 * - Merges new content with existing database
 * - Updates filter-options.json with new counts
 * 
 * Provider-specific approaches:
 * - HentaiTV: https://hentai.tv/?s= - first entries are newest
 * - HentaiMama: https://hentaimama.io/new-monthly-hentai/ - monthly releases page
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
  
  // Cleanup: Check entries added in the last N days
  cleanupDaysToCheck: 3,
  
  // Cleanup: Max entries to fix per run (to prevent overload)
  cleanupMaxFixes: 50,
  
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
 * Clear addon cache so new content is visible immediately
 * This is called after database updates
 */
function clearAddonCache() {
  try {
    // Try to clear the cache module if loaded
    const cachePath = path.join(__dirname, '..', 'src', 'cache', 'index.js');
    if (fs.existsSync(cachePath)) {
      // Clear require cache to force reload
      delete require.cache[require.resolve(cachePath)];
      
      // Also try to clear the database loader cache
      const dbLoaderPath = path.join(__dirname, '..', 'src', 'utils', 'databaseLoader.js');
      if (fs.existsSync(dbLoaderPath)) {
        delete require.cache[require.resolve(dbLoaderPath)];
      }
    }
    
    // Clear any .cache directory files
    const cacheDir = path.join(__dirname, '..', '.cache');
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(cacheDir, file));
        } catch (e) {
          // Ignore errors
        }
      }
      logger.info(`   🧹 Cleared ${files.length} cache files`);
    }
    
    logger.info(`   ✅ Addon cache cleared - new content will be visible on next request`);
  } catch (error) {
    logger.debug(`   ⚠️ Could not clear addon cache: ${error.message}`);
  }
}

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
 * Check if an entry has broken/incomplete data
 * Returns true if the entry needs fixing
 */
function isEntryBroken(entry) {
  // No episodes at all
  if (!entry.episodes || !Array.isArray(entry.episodes) || entry.episodes.length === 0) {
    return { broken: true, reason: 'no episodes' };
  }
  
  // Check first episode for proper format
  const firstEp = entry.episodes[0];
  
  // Episodes using old format (episodeNumber instead of number)
  if (firstEp.episodeNumber !== undefined && firstEp.number === undefined) {
    return { broken: true, reason: 'old episode format (episodeNumber)' };
  }
  
  // Episodes missing number field entirely
  if (firstEp.number === undefined && firstEp.episodeNumber === undefined) {
    return { broken: true, reason: 'episodes missing number field' };
  }
  
  // Episodes missing release date (important for "New Releases" sorting)
  if (!firstEp.released) {
    return { broken: true, reason: 'episodes missing release date' };
  }
  
  // Check for episodes with suspicious/incorrect dates (future dates or all same date for newer episodes)
  // This catches cases where dates were set to "now" during updates instead of actual dates
  const now = new Date();
  const latestEps = entry.episodes.slice(-2); // Last 2 episodes
  for (const ep of latestEps) {
    if (ep.released) {
      const epDate = new Date(ep.released);
      // If episode date is in the future (more than 1 day ahead), it's likely wrong
      if (epDate > new Date(now.getTime() + 24 * 60 * 60 * 1000)) {
        return { broken: true, reason: 'episodes have future dates' };
      }
    }
  }
  
  // Missing critical metadata
  if (!entry.name || entry.name.trim() === '') {
    return { broken: true, reason: 'missing name' };
  }
  
  return { broken: false };
}

/**
 * Check if an entry needs RAW status re-check
 * Returns true if any episodes are marked as RAW and might have subtitles now
 */
function needsRawRecheck(entry) {
  if (!entry.episodes || !Array.isArray(entry.episodes)) {
    return false;
  }
  
  // Check if any episodes are marked as RAW OR if entry was recently added
  // (recently added entries may have RAW episodes that weren't properly marked)
  const hasRawEpisodes = entry.episodes.some(ep => ep.isRaw === true);
  
  // Also check entries added in the last 7 days that don't have isRaw set at all
  // These may need to be checked for RAW status
  const recentlyAdded = entry.addedAt && 
    (new Date() - new Date(entry.addedAt)) < 7 * 24 * 60 * 60 * 1000;
  const missingRawStatus = entry.episodes.some(ep => ep.isRaw === undefined);
  
  return hasRawEpisodes || (recentlyAdded && missingRawStatus);
}

/**
 * Get the correct scraper for a series ID
 */
function getScraperForId(seriesId) {
  if (seriesId.startsWith('hmm-') || seriesId.startsWith('hentaimama-')) {
    return { scraper: hentaimamaScraper, name: 'hentaimama' };
  } else if (seriesId.startsWith('hse-') || seriesId.startsWith('hentaisea-')) {
    return { scraper: hentaiseaScraper, name: 'hentaisea' };
  } else if (seriesId.startsWith('htv-') || seriesId.startsWith('hentaitv-')) {
    return { scraper: hentaitvScraper, name: 'hentaitv' };
  }
  // Default to HentaiMama
  return { scraper: hentaimamaScraper, name: 'hentaimama' };
}

/**
 * Cleanup recently added entries with broken/incomplete data
 * @param {Array} catalog - The full catalog array
 * @returns {Object} - { fixedCount, removedCount, catalog }
 */
async function cleanupBrokenEntries(catalog) {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - CONFIG.cleanupDaysToCheck * 24 * 60 * 60 * 1000);
  
  logger.info(`\n🧹 Checking for broken entries added since ${cutoffDate.toISOString().split('T')[0]}...`);
  
  // Find recently added entries that might be broken
  const recentEntries = catalog.filter(entry => {
    const addedAt = entry.addedAt ? new Date(entry.addedAt) : null;
    const lastUpdated = entry.lastUpdated ? new Date(entry.lastUpdated) : null;
    const entryDate = addedAt || lastUpdated;
    return entryDate && entryDate >= cutoffDate;
  });
  
  logger.info(`   Found ${recentEntries.length} entries added in last ${CONFIG.cleanupDaysToCheck} days`);
  
  // Check which ones are broken
  const brokenEntries = recentEntries
    .map(entry => ({ entry, ...isEntryBroken(entry) }))
    .filter(item => item.broken);
  
  if (brokenEntries.length === 0) {
    logger.info(`   ✅ No broken entries found!`);
    return { fixedCount: 0, removedCount: 0, catalog };
  }
  
  logger.info(`   ⚠️ Found ${brokenEntries.length} broken entries:`);
  for (const item of brokenEntries.slice(0, 10)) { // Show first 10
    logger.info(`      • ${item.entry.name || item.entry.id} - ${item.reason}`);
  }
  if (brokenEntries.length > 10) {
    logger.info(`      ... and ${brokenEntries.length - 10} more`);
  }
  
  // Fix broken entries (up to max limit)
  let fixedCount = 0;
  let removedCount = 0;
  const entriesToFix = brokenEntries.slice(0, CONFIG.cleanupMaxFixes);
  
  logger.info(`\n   📥 Attempting to fix ${entriesToFix.length} entries...`);
  
  for (let i = 0; i < entriesToFix.length; i++) {
    const { entry } = entriesToFix[i];
    const idx = catalog.findIndex(c => c.id === entry.id);
    
    if (idx === -1) continue;
    
    try {
      const { scraper, name } = getScraperForId(entry.id);
      const fullMeta = await fetchMetadata(scraper, entry.id);
      
      if (fullMeta && fullMeta.episodes && fullMeta.episodes.length > 0) {
        // Verify the fetched metadata has proper format
        const firstEp = fullMeta.episodes[0];
        if (firstEp.number !== undefined || firstEp.episodeNumber !== undefined) {
          // Normalize episode format (including isRaw status)
          const normalizedEpisodes = fullMeta.episodes.map(ep => ({
            id: ep.id || `${entry.id.replace(/^(hmm|hse|htv)-/, '')}-episode-${ep.number || ep.episodeNumber}`,
            slug: ep.slug || `${entry.id.replace(/^(hmm|hse|htv)-/, '')}-episode-${ep.number || ep.episodeNumber}`,
            number: ep.number || ep.episodeNumber,
            title: ep.title || ep.name || `Episode ${ep.number || ep.episodeNumber}`,
            poster: ep.poster || entry.poster,
            released: ep.released || entry.lastUpdated || new Date().toISOString(),
            isRaw: ep.isRaw || false, // Track RAW status per episode
          }));
          
          catalog[idx] = {
            ...catalog[idx],
            episodes: normalizedEpisodes,
            hasFullMeta: true,
            // Update other fields if available
            ...(fullMeta.description && { description: fullMeta.description }),
            ...(fullMeta.genres && fullMeta.genres.length > 0 && { genres: fullMeta.genres }),
            ...(fullMeta.studio && { studio: fullMeta.studio }),
            ...(fullMeta.rating && { rating: fullMeta.rating }),
            ...(fullMeta.year && { year: fullMeta.year }),
            ...(fullMeta.lastUpdated && { lastUpdated: fullMeta.lastUpdated }),
          };
          
          fixedCount++;
          logger.debug(`      ✅ Fixed: ${entry.name || entry.id}`);
        } else {
          // Metadata fetch returned data but still bad format - remove entry
          catalog.splice(idx, 1);
          removedCount++;
          logger.debug(`      🗑️ Removed (still broken after fetch): ${entry.name || entry.id}`);
        }
      } else {
        // Could not fetch valid metadata - remove the broken entry
        catalog.splice(idx, 1);
        removedCount++;
        logger.debug(`      🗑️ Removed (fetch failed): ${entry.name || entry.id}`);
      }
      
      process.stdout.write(`\r      Progress: ${i + 1}/${entriesToFix.length} (${fixedCount} fixed, ${removedCount} removed)    `);
      await sleep(CONFIG.delayBetweenRequests);
      
    } catch (error) {
      logger.debug(`      ❌ Error fixing ${entry.id}: ${error.message}`);
      // Remove entries that throw errors during fix
      const currentIdx = catalog.findIndex(c => c.id === entry.id);
      if (currentIdx !== -1) {
        catalog.splice(currentIdx, 1);
        removedCount++;
      }
    }
  }
  
  console.log(''); // New line after progress
  logger.info(`   ✅ Cleanup complete: ${fixedCount} fixed, ${removedCount} removed`);
  
  return { fixedCount, removedCount, catalog };
}

/**
 * Check for RAW→SUB status changes on previously RAW episodes
 * This function re-checks episodes that were marked as RAW to see if subtitles are now available
 * @param {Array} catalog - The full catalog array
 * @returns {Object} - { updatedCount, catalog }
 */
async function checkRawStatusChanges(catalog) {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - CONFIG.cleanupDaysToCheck * 24 * 60 * 60 * 1000);
  
  logger.info(`\n🔍 Checking for RAW→SUB status changes...`);
  
  // Find entries with RAW episodes added recently
  const entriesWithRaw = catalog.filter(entry => {
    const addedAt = entry.addedAt ? new Date(entry.addedAt) : null;
    const lastUpdated = entry.lastUpdated ? new Date(entry.lastUpdated) : null;
    const entryDate = addedAt || lastUpdated;
    return entryDate && entryDate >= cutoffDate && needsRawRecheck(entry);
  });
  
  if (entriesWithRaw.length === 0) {
    logger.info(`   ✅ No RAW episodes to check`);
    return { updatedCount: 0, catalog };
  }
  
  logger.info(`   Found ${entriesWithRaw.length} series with RAW episodes to check`);
  
  let updatedCount = 0;
  const maxToCheck = Math.min(entriesWithRaw.length, 20); // Limit to avoid too many requests
  
  for (let i = 0; i < maxToCheck; i++) {
    const entry = entriesWithRaw[i];
    const idx = catalog.findIndex(c => c.id === entry.id);
    if (idx === -1) continue;
    
    try {
      // Re-fetch metadata to get updated RAW status
      const fullMeta = await fetchMetadata(hentaimamaScraper, entry.id);
      
      if (fullMeta && fullMeta.episodes && fullMeta.episodes.length > 0) {
        let needsUpdate = false;
        
        // Debug: Log the first episode's RAW status from freshly fetched metadata
        logger.debug(`   🔍 ${entry.name}: Fetched ${fullMeta.episodes.length} episodes, first ep isRaw=${fullMeta.episodes[0].isRaw}`);
        
        // Compare RAW status for each episode
        for (const newEp of fullMeta.episodes) {
          const oldEp = entry.episodes?.find(e => 
            (e.number || e.episodeNumber) === (newEp.number || newEp.episodeNumber)
          );
          
          // Update if RAW changed to SUB, or if isRaw field was missing before
          if (oldEp) {
            // Debug: Log comparison
            logger.debug(`     Ep ${newEp.number}: old.isRaw=${oldEp.isRaw} (type: ${typeof oldEp.isRaw}), new.isRaw=${newEp.isRaw} (type: ${typeof newEp.isRaw})`);
            
            if (oldEp.isRaw === true && newEp.isRaw === false) {
              needsUpdate = true;
              logger.info(`   🎬 ${entry.name} Ep ${newEp.number}: RAW → Subtitled`);
            } else if (oldEp.isRaw === undefined && newEp.isRaw !== undefined) {
              // First time setting RAW status
              needsUpdate = true;
              logger.info(`   📝 ${entry.name} Ep ${newEp.number}: Setting RAW=${newEp.isRaw}`);
            }
          } else {
            // New episode discovered during RAW check
            needsUpdate = true;
            logger.debug(`   📝 ${entry.name} Ep ${newEp.number}: New episode with RAW=${newEp.isRaw}`);
          }
        }
        
        if (needsUpdate) {
          // Update the episodes with new RAW status
          catalog[idx].episodes = fullMeta.episodes.map(ep => ({
            id: ep.id || catalog[idx].episodes?.find(e => e.number === ep.number)?.id,
            slug: ep.slug || catalog[idx].episodes?.find(e => e.number === ep.number)?.slug,
            number: ep.number || ep.episodeNumber,
            title: ep.title || ep.name || `Episode ${ep.number}`,
            poster: ep.poster || entry.poster,
            released: ep.released || entry.lastUpdated,
            isRaw: ep.isRaw || false,
          }));
          updatedCount++;
        }
      }
      
      process.stdout.write(`\r   Progress: ${i + 1}/${maxToCheck} (${updatedCount} updated)    `);
      await sleep(CONFIG.delayBetweenRequests);
      
    } catch (error) {
      logger.debug(`   ❌ Error checking ${entry.name}: ${error.message}`);
    }
  }
  
  if (maxToCheck > 0) console.log('');
  
  if (updatedCount > 0) {
    logger.info(`   ✅ Updated RAW status for ${updatedCount} series`);
  } else {
    logger.info(`   ✅ No RAW→SUB changes detected`);
  }
  
  return { updatedCount, catalog };
}

/**
 * Re-rate entries that have N/A ratings
 * When a hentai first comes out, there may be no ratings yet.
 * This function checks recently added entries and fetches updated ratings.
 * @param {Array} catalog - The full catalog array
 * @returns {Object} - { updatedCount, catalog }
 */
async function checkMissingRatings(catalog) {
  const now = new Date();
  // Check entries added in the last 14 days (ratings take time to accumulate)
  const cutoffDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  
  logger.info(`\n⭐ Checking for missing ratings on recent entries...`);
  
  // Find entries added recently that have no rating
  const entriesWithoutRating = catalog.filter(entry => {
    const addedAt = entry.addedAt ? new Date(entry.addedAt) : null;
    const lastUpdated = entry.lastUpdated ? new Date(entry.lastUpdated) : null;
    const entryDate = addedAt || lastUpdated;
    
    // Check if entry was added recently and has no rating
    const isRecent = entryDate && entryDate >= cutoffDate;
    const hasNoRating = entry.rating === undefined || entry.rating === null || 
                       isNaN(entry.rating) || entry.rating === 0;
    
    return isRecent && hasNoRating;
  });
  
  if (entriesWithoutRating.length === 0) {
    logger.info(`   ✅ All recent entries have ratings`);
    return { updatedCount: 0, catalog };
  }
  
  logger.info(`   Found ${entriesWithoutRating.length} recent series without ratings`);
  
  let updatedCount = 0;
  const maxToCheck = Math.min(entriesWithoutRating.length, 15); // Limit to avoid too many requests
  
  for (let i = 0; i < maxToCheck; i++) {
    const entry = entriesWithoutRating[i];
    const idx = catalog.findIndex(c => c.id === entry.id);
    if (idx === -1) continue;
    
    try {
      // Re-fetch metadata to get updated rating
      const { scraper } = getScraperForId(entry.id);
      const fullMeta = await fetchMetadata(scraper, entry.id);
      
      if (fullMeta && fullMeta.rating !== undefined && fullMeta.rating !== null && !isNaN(fullMeta.rating)) {
        catalog[idx].rating = fullMeta.rating;
        if (fullMeta.ratingBreakdown) {
          catalog[idx].ratingBreakdown = fullMeta.ratingBreakdown;
        }
        if (fullMeta.voteCount) {
          catalog[idx].voteCount = fullMeta.voteCount;
        }
        updatedCount++;
        logger.debug(`   ⭐ ${entry.name}: N/A → ${fullMeta.rating.toFixed(1)}`);
      }
      
      process.stdout.write(`\r   Progress: ${i + 1}/${maxToCheck} (${updatedCount} updated)    `);
      await sleep(CONFIG.delayBetweenRequests);
      
    } catch (error) {
      logger.debug(`   ❌ Error checking rating for ${entry.name}: ${error.message}`);
    }
  }
  
  if (maxToCheck > 0) console.log('');
  
  if (updatedCount > 0) {
    logger.info(`   ✅ Updated ratings for ${updatedCount} series`);
  } else {
    logger.info(`   ✅ No rating updates available`);
  }
  
  return { updatedCount, catalog };
}

/**
 * Check for entries with future episode dates and fix them
 * This catches cases where date extraction failed during updates
 */
async function checkFutureDates(catalog) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  logger.info(`\n📅 Checking for entries with future episode dates...`);
  
  // Find entries with episodes that have future dates
  const entriesWithFutureDates = catalog.filter(entry => {
    if (!entry.episodes || !Array.isArray(entry.episodes)) return false;
    
    return entry.episodes.some(ep => {
      if (!ep.released) return false;
      const epDate = new Date(ep.released);
      return epDate > tomorrow;
    });
  });
  
  if (entriesWithFutureDates.length === 0) {
    logger.info(`   ✅ No entries with future dates`);
    return { fixedCount: 0, catalog };
  }
  
  logger.info(`   ⚠️ Found ${entriesWithFutureDates.length} entries with future episode dates:`);
  for (const entry of entriesWithFutureDates.slice(0, 10)) {
    const futureEps = entry.episodes.filter(ep => ep.released && new Date(ep.released) > tomorrow);
    logger.info(`      • ${entry.name} - ${futureEps.length} episodes with future dates`);
  }
  
  let fixedCount = 0;
  const maxToFix = Math.min(entriesWithFutureDates.length, CONFIG.cleanupMaxFixes);
  
  for (let i = 0; i < maxToFix; i++) {
    const entry = entriesWithFutureDates[i];
    const idx = catalog.findIndex(c => c.id === entry.id);
    if (idx === -1) continue;
    
    try {
      const { scraper } = getScraperForId(entry.id);
      const fullMeta = await fetchMetadata(scraper, entry.id);
      
      if (fullMeta && fullMeta.episodes && fullMeta.episodes.length > 0) {
        // Verify new dates are valid (not in future)
        const hasValidDates = fullMeta.episodes.every(ep => {
          if (!ep.released) return true;
          return new Date(ep.released) <= tomorrow;
        });
        
        if (hasValidDates) {
          // Normalize and update episodes
          const normalizedEpisodes = fullMeta.episodes.map(ep => ({
            id: ep.id || `${entry.id.replace(/^(hmm|hse|htv)-/, '')}-episode-${ep.number || ep.episodeNumber}`,
            slug: ep.slug || `${entry.id.replace(/^(hmm|hse|htv)-/, '')}-episode-${ep.number || ep.episodeNumber}`,
            number: ep.number || ep.episodeNumber,
            title: ep.title || ep.name || `Episode ${ep.number || ep.episodeNumber}`,
            poster: ep.poster || entry.poster,
            released: ep.released || entry.lastUpdated || new Date().toISOString(),
            isRaw: ep.isRaw || false,
          }));
          
          catalog[idx].episodes = normalizedEpisodes;
          catalog[idx].lastUpdated = new Date().toISOString();
          fixedCount++;
          logger.debug(`   ✅ Fixed dates for ${entry.name}`);
        }
      }
      
      process.stdout.write(`\r   Progress: ${i + 1}/${maxToFix} (${fixedCount} fixed)    `);
      await sleep(CONFIG.delayBetweenRequests);
      
    } catch (error) {
      logger.debug(`   ❌ Error fixing dates for ${entry.name}: ${error.message}`);
    }
  }
  
  if (maxToFix > 0) console.log('');
  
  if (fixedCount > 0) {
    logger.info(`   ✅ Fixed dates for ${fixedCount} entries`);
  } else {
    logger.info(`   ✅ No date fixes applied`);
  }
  
  return { fixedCount, catalog };
}

/**
 * Scan a provider for new content
 * Returns array of new/updated series
 * 
 * NOTE: All providers scan ALL items on page 1 to avoid missing new content:
 * - HentaiMama: Uses new-monthly-hentai page which shows individual episodes
 * - HentaiTV: Uses search page (https://hentai.tv/?s=) sorted by newest
 * - HentaiSea: Uses latest-series page sorted by recent
 */
async function scanProvider(scraper, providerName, existingCatalog, normalizedIndex) {
  const newItems = [];
  const updatedItems = []; // Series with new episodes
  let consecutiveExisting = 0;
  let page = 1;
  
  // ALL providers: Scan all items on page 1, don't use consecutive threshold
  const isHentaiSea = providerName === 'hentaisea';
  const isHentaiMama = providerName === 'hentaimama';
  const isHentaiTV = providerName === 'hentaitv';
  const maxPages = 1; // Always scan first page only for all providers
  
  logger.info(`\n📡 Scanning ${providerName} for new content...`);
  if (isHentaiSea) {
    logger.info(`  (HentaiSea: scanning ALL items on page 1)`);
  }
  if (isHentaiMama) {
    logger.info(`  (HentaiMama: using new-monthly-hentai page for latest episodes)`);
  }
  if (isHentaiTV) {
    logger.info(`  (HentaiTV: scanning ALL items on search page - sorted by newest)`);
  }
  
  while (page <= maxPages) {
    
    try {
      let items = [];
      
      // Provider-specific catalog fetching
      if (isHentaiMama) {
        // HentaiMama: Use new-monthly-hentai page which shows individual episodes
        const monthlyEpisodes = await withRetry(() => hentaimamaScraper.getMonthlyReleases(page));
        
        // Group episodes by series to detect new series vs new episodes
        const seriesMap = new Map();
        for (const ep of monthlyEpisodes) {
          if (!seriesMap.has(ep.seriesSlug)) {
            seriesMap.set(ep.seriesSlug, {
              id: ep.seriesId,
              name: ep.title,
              poster: ep.poster,
              episodes: [],
              latestEpisode: ep.episodeNumber,
              isRaw: ep.isRaw,
              releaseDate: ep.releaseDate,
            });
          }
          const series = seriesMap.get(ep.seriesSlug);
          series.episodes.push(ep.episodeNumber);
          if (ep.episodeNumber > series.latestEpisode) {
            series.latestEpisode = ep.episodeNumber;
          }
          if (ep.releaseDate && (!series.releaseDate || ep.releaseDate > series.releaseDate)) {
            series.releaseDate = ep.releaseDate;
          }
        }
        
        // Check each series - new or has new episodes?
        // IMPORTANT: Only add series with recent episode dates to avoid false positives
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        
        for (const [slug, seriesInfo] of seriesMap) {
          // Validate that the episode release date is recent (within 2 weeks)
          // This prevents adding old content that happens to be on the monthly page
          const episodeDate = seriesInfo.releaseDate ? new Date(seriesInfo.releaseDate) : null;
          if (!episodeDate || episodeDate < twoWeeksAgo) {
            const dateStr = episodeDate ? episodeDate.toISOString().split('T')[0] : 'unknown';
            logger.debug(`  ⏭️ Skipping "${seriesInfo.name}" - episode date too old: ${dateStr}`);
            continue;
          }
          
          const existing = findExistingEntry({ name: seriesInfo.name }, existingCatalog, normalizedIndex);
          
          if (existing) {
            // Check if there are new episodes
            const existingEpisodeCount = existing.episodes?.length || 0;
            if (seriesInfo.latestEpisode > existingEpisodeCount) {
              logger.debug(`  📺 New episodes for "${seriesInfo.name}": ${existingEpisodeCount} → ${seriesInfo.latestEpisode}`);
              updatedItems.push({
                existing,
                newEpisodeCount: seriesInfo.latestEpisode,
                lastUpdated: seriesInfo.releaseDate,
                isRaw: seriesInfo.isRaw, // Track RAW status
              });
            } else {
              logger.debug(`  ↩️ Up to date: "${seriesInfo.name}" (${existingEpisodeCount} episodes)`);
            }
          } else {
            // New series - only add if episode date is recent
            newItems.push({
              id: seriesInfo.id,
              name: seriesInfo.name,
              poster: seriesInfo.poster,
              lastUpdated: seriesInfo.releaseDate,
              isRaw: seriesInfo.isRaw, // Track RAW status
            });
            logger.debug(`  ✨ New: "${seriesInfo.name}" (${episodeDate.toISOString().split('T')[0]})`);
          }
        }
        
        // HentaiMama is done after processing monthly releases
        break;
        
      } else if (providerName === 'hentaitv') {
        // HentaiTV: Use search page for newest content
        items = await withRetry(() => hentaitvScraper.getCatalogFromSearchPage(page));
      } else if (isHentaiSea) {
        // HentaiSea: Use catalog with 'recent' sort for newest content
        const result = await withRetry(() => hentaiseaScraper.getCatalog(page, null, 'recent'));
        items = Array.isArray(result) ? result : (result?.items || result?.metas || []);
      } else {
        // Other providers: Standard catalog with 'recent' sort
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
          // Don't stop early - continue scanning all items on the page
        } else {
          consecutiveExisting = 0;
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
  const enrichedItems = [];
  if (newItems.length > 0) {
    logger.info(`  📥 Fetching metadata for ${newItems.length} new series...`);
    
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
  }
  
  // Return both new items and updated items (series with new episodes)
  return {
    newItems: enrichedItems,
    updatedItems: updatedItems, // Series that need episode count updates
  };
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
  const allUpdatedItems = []; // Series with new episodes
  
  const providers = [
    { scraper: hentaimamaScraper, name: 'hentaimama' },
    { scraper: hentaiseaScraper, name: 'hentaisea' },
    { scraper: hentaitvScraper, name: 'hentaitv' },
  ];
  
  for (const { scraper, name } of providers) {
    try {
      const result = await scanProvider(scraper, name, existingCatalog, normalizedIndex);
      const { newItems = [], updatedItems = [] } = result;
      
      if (newItems.length > 0) {
        allNewItems.push(...newItems);
        logger.info(`  ✅ ${name}: Found ${newItems.length} new series`);
      }
      if (updatedItems.length > 0) {
        allUpdatedItems.push(...updatedItems);
        logger.info(`  📺 ${name}: Found ${updatedItems.length} series with new episodes`);
      }
      if (newItems.length === 0 && updatedItems.length === 0) {
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
  
  const hasChanges = allNewItems.length > 0 || allUpdatedItems.length > 0;
  
  if (!hasChanges) {
    logger.info('✅ Database is up to date - no new content found');
  } else {
    if (allNewItems.length > 0) {
      logger.info(`✨ Found ${allNewItems.length} new series to add`);
      for (const item of allNewItems) {
        logger.info(`   • ${item.name} (${item.id})`);
      }
    }
    
    if (allUpdatedItems.length > 0) {
      logger.info(`📺 Found ${allUpdatedItems.length} series with new episodes`);
      for (const update of allUpdatedItems) {
        const oldCount = update.existing.episodes?.length || 0;
        logger.info(`   • ${update.existing.name}: ${oldCount} → ${update.newEpisodeCount} episodes`);
      }
    }
    
    if (!DRY_RUN) {
      // Start with existing catalog
      const updatedCatalog = [...existingCatalog];
      
      // Update existing series with new episodes - FETCH FULL METADATA
      // We need to get the actual episode data with dates, not just placeholders
      if (allUpdatedItems.length > 0) {
        logger.info(`\n📥 Fetching full metadata for ${allUpdatedItems.length} updated series...`);
        
        for (let i = 0; i < allUpdatedItems.length; i++) {
          const update = allUpdatedItems[i];
          const idx = updatedCatalog.findIndex(s => s.id === update.existing.id);
          
          if (idx !== -1) {
            try {
              // Fetch full metadata including episodes with dates
              const fullMeta = await fetchMetadata(hentaimamaScraper, update.existing.id);
              
              if (fullMeta && fullMeta.episodes && fullMeta.episodes.length > 0) {
                // Update with full episode data
                updatedCatalog[idx].episodes = fullMeta.episodes;
                updatedCatalog[idx].lastUpdated = fullMeta.lastUpdated || update.lastUpdated || new Date().toISOString();
                
                // Also update other fields that might have changed
                if (fullMeta.genres && fullMeta.genres.length > 0) {
                  updatedCatalog[idx].genres = fullMeta.genres;
                }
                if (fullMeta.description) {
                  updatedCatalog[idx].description = fullMeta.description;
                }
                if (fullMeta.rating) {
                  updatedCatalog[idx].rating = fullMeta.rating;
                }
                
                logger.debug(`  ✅ Updated ${update.existing.name} with ${fullMeta.episodes.length} episodes`);
              } else {
                // Fallback to simple episode generation if metadata fetch fails
                const episodes = [];
                for (let j = 1; j <= update.newEpisodeCount; j++) {
                  const slug = updatedCatalog[idx].providerSlugs?.hmm || updatedCatalog[idx].id?.replace('hmm-', '');
                  episodes.push({
                    id: `${slug}-episode-${j}`,
                    name: `Episode ${j}`,
                    number: j,
                  });
                }
                updatedCatalog[idx].episodes = episodes;
                updatedCatalog[idx].lastUpdated = update.lastUpdated || new Date().toISOString();
                logger.debug(`  ⚠️ Fallback episodes for ${update.existing.name}`);
              }
              
              process.stdout.write(`\r    Progress: ${i + 1}/${allUpdatedItems.length}    `);
              await sleep(CONFIG.delayBetweenRequests);
              
            } catch (error) {
              logger.error(`  ❌ Failed to update ${update.existing.name}: ${error.message}`);
            }
          }
        }
        console.log('');
      }
      
      // Add new items to catalog
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
      
      // Run cleanup on recently added entries
      const cleanupResult = await cleanupBrokenEntries(updatedCatalog);
      
      // Check for RAW→SUB status changes on previously RAW episodes
      const rawResult = await checkRawStatusChanges(cleanupResult.catalog);
      
      // Check for missing ratings on recently added entries
      const ratingResult = await checkMissingRatings(rawResult.catalog);
      
      // Check for entries with future episode dates
      const dateResult = await checkFutureDates(ratingResult.catalog);
      
      // Use the cleaned catalog
      database.catalog = dateResult.catalog;
      database.lastUpdated = new Date().toISOString();
      database.incrementalUpdate = true;
      
      // Save
      saveDatabase(database);
      updateFilterOptions(ratingResult.catalog);
      
      logger.info(`\n✅ Database updated: ${existingCatalog.length} → ${ratingResult.catalog.length} series`);
      
      // Clear addon cache so new content is visible immediately
      clearAddonCache();
      
      if (allUpdatedItems.length > 0) {
        logger.info(`   ${allUpdatedItems.length} series updated with new episodes`);
      }
      if (cleanupResult.fixedCount > 0 || cleanupResult.removedCount > 0) {
        logger.info(`   Cleanup: ${cleanupResult.fixedCount} fixed, ${cleanupResult.removedCount} removed`);
      }
    } else {
      logger.info('\n🔍 DRY RUN - Changes not saved');
    }
  }
  
  // Always run cleanup even if no new content was found
  if (!hasChanges && !DRY_RUN) {
    // Load catalog for cleanup-only run
    const catalogForCleanup = [...existingCatalog];
    const cleanupResult = await cleanupBrokenEntries(catalogForCleanup);
    
    // Also check for RAW→SUB status changes
    const rawResult = await checkRawStatusChanges(cleanupResult.catalog);
    
    // Also check for missing ratings
    const ratingResult = await checkMissingRatings(rawResult.catalog);
    
    // Also check for future episode dates
    const dateResult = await checkFutureDates(ratingResult.catalog);
    
    if (cleanupResult.fixedCount > 0 || cleanupResult.removedCount > 0 || 
        rawResult.updatedCount > 0 || ratingResult.updatedCount > 0 ||
        dateResult.fixedCount > 0) {
      database.catalog = dateResult.catalog;
      database.lastUpdated = new Date().toISOString();
      database.incrementalUpdate = true;
      
      saveDatabase(database);
      updateFilterOptions(dateResult.catalog);
      
      logger.info(`\n✅ Cleanup complete: ${existingCatalog.length} → ${dateResult.catalog.length} series`);
      if (rawResult.updatedCount > 0) {
        logger.info(`   RAW→SUB updates: ${rawResult.updatedCount}`);
      }
      if (ratingResult.updatedCount > 0) {
        logger.info(`   Rating updates: ${ratingResult.updatedCount}`);
      }
      if (dateResult.fixedCount > 0) {
        logger.info(`   Date fixes: ${dateResult.fixedCount}`);
      }
      
      // Clear addon cache
      clearAddonCache();
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
