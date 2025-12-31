#!/usr/bin/env node

/**
 * Build HentaiTV Database
 * 
 * Scrapes all pages of HentaiTV search results to build a complete
 * catalog with view counts for trending calculation.
 * 
 * INCLUDES FULL METADATA with episodes and release dates
 * so users get instant loading when clicking on a series.
 * 
 * URL pattern: https://hentai.tv/?s= (page 1)
 *              https://hentai.tv/page/N/?s= (pages 2+)
 */

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

// QUIET MODE: Suppress scraper debug logs during build
const utilsLoggerPath = path.join(__dirname, '..', 'src', 'utils', 'logger.js');
if (fs.existsSync(utilsLoggerPath)) {
  const loggerModule = require(utilsLoggerPath);
  if (loggerModule && typeof loggerModule === 'object') {
    loggerModule.info = () => {};
    loggerModule.debug = () => {};
    loggerModule.warn = () => {};
    loggerModule.error = (...args) => console.error('[SCRAPER]', ...args);
  }
}

const hentaitvScraper = require('../src/scrapers/hentaitv');

// Configuration
const CONFIG = {
  outputDir: path.join(__dirname, '..', 'data'),
  catalogFile: 'catalog.json',
  catalogGzFile: 'catalog.json.gz',
  
  // HentaiTV has ~141+ pages
  maxPages: 200,
  
  // Rate limiting
  delayBetweenPages: 800, // ms
  
  // FULL METADATA: Fetch episodes for each series
  fetchFullMetadata: true,
  
  // PARALLEL PROCESSING
  parallelBatchSize: 5,
  delayBetweenBatches: 300, // ms
  
  // Retry configuration
  maxRetries: 3,
  retryDelay: 2000, // ms
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
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, retries = CONFIG.maxRetries) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i < retries - 1) {
        await sleep(CONFIG.retryDelay * (i + 1));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Scrape all HentaiTV pages
 */
async function scrapeHentaiTV() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  📥 SCRAPING HENTAITV CATALOG');
  console.log(`${'─'.repeat(60)}\n`);
  console.log(`   URL pattern: https://hentai.tv/page/N/?s=`);
  console.log(`   Max pages: ${CONFIG.maxPages}\n`);
  
  const seriesMap = new Map();
  
  let page = 1;
  let consecutiveEmptyPages = 0;
  const MAX_EMPTY_PAGES = 3;
  
  while (page <= CONFIG.maxPages && consecutiveEmptyPages < MAX_EMPTY_PAGES) {
    try {
      process.stdout.write(`\r   Page ${page}: `);
      
      const items = await withRetry(() => 
        hentaitvScraper.getCatalogFromSearchPage(page)
      );
      
      if (!items || items.length === 0) {
        consecutiveEmptyPages++;
        process.stdout.write(`empty (${consecutiveEmptyPages}/${MAX_EMPTY_PAGES})...`);
        page++;
        await sleep(CONFIG.delayBetweenPages);
        continue;
      }
      
      consecutiveEmptyPages = 0;
      
      // Merge items into the map
      for (const item of items) {
        const existingSeries = seriesMap.get(item.id);
        
        if (!existingSeries) {
          seriesMap.set(item.id, { ...item });
        } else {
          // Merge data - accumulate views, take best metadata
          existingSeries.totalViews = (existingSeries.totalViews || 0) + (item.totalViews || 0);
          existingSeries.episodeCount = Math.max(existingSeries.episodeCount || 1, item.episodeCount || 1);
          
          if ((item.viewCount || 0) > (existingSeries.viewCount || 0)) {
            existingSeries.viewCount = item.viewCount;
          }
          if ((item.maxEpisodeViews || 0) > (existingSeries.maxEpisodeViews || 0)) {
            existingSeries.maxEpisodeViews = item.maxEpisodeViews;
          }
          if (item.knownSlugs) {
            existingSeries.knownSlugs = { ...(existingSeries.knownSlugs || {}), ...item.knownSlugs };
          }
          if (!existingSeries.description && item.description) existingSeries.description = item.description;
          if (!existingSeries.poster && item.poster) existingSeries.poster = item.poster;
          if (!existingSeries.genres && item.genres) existingSeries.genres = item.genres;
          if (!existingSeries.studio && item.studio) existingSeries.studio = item.studio;
          if (!existingSeries.year && item.year) {
            existingSeries.year = item.year;
            existingSeries.releaseInfo = item.releaseInfo;
          }
        }
      }
      
      process.stdout.write(`${items.length} items, ${seriesMap.size} unique series`);
      
      page++;
      await sleep(CONFIG.delayBetweenPages);
      
    } catch (error) {
      console.error(`\n   ❌ Page ${page} failed: ${error.message}`);
      consecutiveEmptyPages++;
      page++;
      await sleep(CONFIG.delayBetweenPages * 2);
    }
  }
  
  console.log(`\n\n   ✅ Scraped ${seriesMap.size} unique series from ${page - 1} pages\n`);
  
  return Array.from(seriesMap.values());
}

/**
 * Enrich series with full metadata (episodes + release dates)
 */
async function enrichWithFullMetadata(catalog) {
  if (!CONFIG.fetchFullMetadata || catalog.length === 0) {
    return catalog;
  }
  
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  📚 ENRICHING WITH FULL METADATA');
  console.log(`${'─'.repeat(60)}\n`);
  console.log(`   Fetching episodes for ${catalog.length} series...`);
  console.log(`   Parallel batch size: ${CONFIG.parallelBatchSize}\n`);
  
  const startTime = Date.now();
  let enrichedCount = 0;
  let failedCount = 0;
  
  // Process in parallel batches
  for (let i = 0; i < catalog.length; i += CONFIG.parallelBatchSize) {
    const batch = catalog.slice(i, i + CONFIG.parallelBatchSize);
    const batchStart = Date.now();
    
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        try {
          const meta = await hentaitvScraper.getMetadata(item.id);
          if (meta && meta.episodes && meta.episodes.length > 0) {
            // Merge metadata into catalog item
            item.episodes = meta.episodes;
            item.hasFullMeta = true;
            item.description = meta.description || item.description;
            item.genres = meta.genres || item.genres;
            item.studio = meta.studio || item.studio;
            item.year = meta.year || item.year;
            item.releaseInfo = meta.releaseInfo || item.releaseInfo;
            item.lastUpdated = meta.lastUpdated || item.lastUpdated;
            return { success: true, id: item.id };
          }
          return { success: false, id: item.id, reason: 'no episodes' };
        } catch (err) {
          return { success: false, id: item.id, reason: err.message };
        }
      })
    );
    
    // Count results
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        enrichedCount++;
      } else {
        failedCount++;
      }
    }
    
    // Calculate ETA
    const elapsed = Date.now() - startTime;
    const completed = i + batch.length;
    const remaining = catalog.length - completed;
    const avgTimePerItem = elapsed / completed;
    const eta = remaining * avgTimePerItem;
    
    process.stdout.write(`\r   ${progressBar(completed, catalog.length)} | ETA: ${formatDuration(eta)}    `);
    
    // Delay between batches
    if (i + CONFIG.parallelBatchSize < catalog.length) {
      await sleep(CONFIG.delayBetweenBatches);
    }
  }
  
  const totalTime = Date.now() - startTime;
  console.log(`\n\n   ✅ Enriched: ${enrichedCount} | Failed: ${failedCount} | Time: ${formatDuration(totalTime)}\n`);
  
  return catalog;
}

/**
 * Load existing database
 */
function loadExistingDatabase() {
  const catalogPath = path.join(CONFIG.outputDir, CONFIG.catalogFile);
  
  if (fs.existsSync(catalogPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      console.log(`   📂 Loaded existing database: ${data.catalog?.length || 0} total series`);
      return data;
    } catch (error) {
      console.error(`   ❌ Failed to load existing database: ${error.message}`);
    }
  }
  
  return null;
}

/**
 * Merge HentaiTV data into existing database
 */
function mergeIntoDatabase(existingDb, htvSeries) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  🔀 MERGING INTO DATABASE');
  console.log(`${'─'.repeat(60)}\n`);
  
  if (!existingDb || !existingDb.catalog) {
    console.log('   ⚠️  No existing database found, creating new one');
    return {
      version: 2,
      buildDate: new Date().toISOString(),
      providers: { htv: { name: 'HentaiTV', itemCount: htvSeries.length, scrapedAt: new Date().toISOString() } },
      catalog: htvSeries.map(s => ({ ...s, provider: 'htv' })),
      slugRegistry: {},
      stats: { totalSeries: htvSeries.length, totalEnriched: htvSeries.filter(s => s.hasFullMeta).length, byProvider: { htv: htvSeries.length } }
    };
  }
  
  // Remove old HentaiTV entries
  const otherSeries = existingDb.catalog.filter(s => !s.id.startsWith('htv-'));
  console.log(`   Keeping ${otherSeries.length} non-HTV series`);
  console.log(`   Adding ${htvSeries.length} HTV series`);
  
  // Add new HentaiTV entries
  const htvWithProvider = htvSeries.map(s => ({ ...s, provider: 'htv' }));
  
  // Update providers
  const providers = { ...existingDb.providers };
  providers.htv = {
    name: 'HentaiTV',
    itemCount: htvSeries.length,
    scrapedAt: new Date().toISOString()
  };
  
  const merged = {
    ...existingDb,
    version: 2,
    buildDate: new Date().toISOString(),
    providers,
    catalog: [...otherSeries, ...htvWithProvider],
  };
  
  // Recalculate stats
  merged.stats = {
    totalSeries: merged.catalog.length,
    totalEnriched: merged.catalog.filter(i => i.hasFullMeta).length,
    totalEpisodes: merged.catalog.reduce((sum, item) => sum + (item.episodes ? item.episodes.length : 0), 0),
    byProvider: {}
  };
  
  for (const series of merged.catalog) {
    const provider = series.provider || series.id.split('-')[0];
    merged.stats.byProvider[provider] = (merged.stats.byProvider[provider] || 0) + 1;
  }
  
  console.log(`   ✅ Merged: ${merged.catalog.length} total series\n`);
  
  return merged;
}

/**
 * Save database to disk
 */
function saveDatabase(database) {
  console.log(`${'─'.repeat(60)}`);
  console.log('  💾 SAVING DATABASE');
  console.log(`${'─'.repeat(60)}\n`);
  
  // Ensure output directory exists
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }
  
  const catalogPath = path.join(CONFIG.outputDir, CONFIG.catalogFile);
  const catalogGzPath = path.join(CONFIG.outputDir, CONFIG.catalogGzFile);
  
  // Write uncompressed JSON
  const jsonData = JSON.stringify(database, null, 2);
  fs.writeFileSync(catalogPath, jsonData, 'utf8');
  const jsonSize = Buffer.byteLength(jsonData);
  console.log(`   📄 ${CONFIG.catalogFile}: ${(jsonSize / 1024 / 1024).toFixed(2)} MB`);
  
  // Write gzipped version
  const gzipData = zlib.gzipSync(jsonData, { level: 9 });
  fs.writeFileSync(catalogGzPath, gzipData);
  const gzSize = gzipData.length;
  console.log(`   📦 ${CONFIG.catalogGzFile}: ${(gzSize / 1024 / 1024).toFixed(2)} MB (${((1 - gzSize / jsonSize) * 100).toFixed(0)}% compression)\n`);
  
  return { jsonSize, gzSize };
}

/**
 * Main build function
 */
async function buildHentaiTVDatabase() {
  const startTime = Date.now();
  
  console.log('\n' + '═'.repeat(60));
  console.log('  🔨 BUILDING HENTAITV DATABASE');
  console.log('═'.repeat(60));
  
  try {
    // Scrape HentaiTV catalog
    const htvSeries = await scrapeHentaiTV();
    
    if (htvSeries.length === 0) {
      console.error('\n❌ No HentaiTV series scraped!');
      process.exit(1);
    }
    
    // Enrich with full metadata (episodes + dates)
    await enrichWithFullMetadata(htvSeries);
    
    // Load existing database
    const existingDb = loadExistingDatabase();
    
    // Merge
    const mergedDb = mergeIntoDatabase(existingDb, htvSeries);
    
    // Save
    const { gzSize } = saveDatabase(mergedDb);
    
    const totalTime = Date.now() - startTime;
    
    // Print summary
    console.log('═'.repeat(60));
    console.log('  📊 BUILD COMPLETE');
    console.log('═'.repeat(60));
    console.log(`
   Total Series:    ${mergedDb.stats.totalSeries.toLocaleString()}
   With Episodes:   ${mergedDb.stats.totalEnriched.toLocaleString()} (${Math.round(mergedDb.stats.totalEnriched / mergedDb.stats.totalSeries * 100)}%)
   Total Episodes:  ${mergedDb.stats.totalEpisodes.toLocaleString()}
   
   By Provider:
     • hmm: ${mergedDb.stats.byProvider.hmm?.toLocaleString() || 0}
     • hse: ${mergedDb.stats.byProvider.hse?.toLocaleString() || 0}
     • htv: ${mergedDb.stats.byProvider.htv?.toLocaleString() || 0}
   
   Build Time:      ${formatDuration(totalTime)}
   Database Size:   ${(gzSize / 1024 / 1024).toFixed(2)} MB (gzipped)
`);
    console.log('═'.repeat(60) + '\n');
    
  } catch (error) {
    console.error(`\n❌ Build failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the build
buildHentaiTVDatabase();
