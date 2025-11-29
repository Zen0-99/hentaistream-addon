const cache = require('../../cache');
const logger = require('../../utils/logger');
const hentaimamaScraper = require('../../scrapers/hentaimama');

/**
 * Get scraper based on catalog ID
 */
function getScraper(id) {
  if (id.startsWith('hentaimama-')) {
    return hentaimamaScraper;
  }
  return hentaimamaScraper;  // Default
}

/**
 * Catalog handler with infinite scroll
 * 
 * APPROACH: Maintain a growing cache of series as we fetch them.
 * Never think about "pages" - just keep fetching until we have enough items.
 */
async function catalogHandler(args) {
  const { type, id, extra = {} } = args;
  
  logger.info(`Catalog request: ${id}`, { type, extra });

  // Only handle series type
  if (type !== 'series') {
    logger.warn(`Unsupported type: ${type} for catalog ${id}`);
    return { metas: [] };
  }

  // Only handle our catalogs
  if (!id.startsWith('hentaimama-')) {
    logger.warn(`Unknown catalog ID: ${id}`);
    return { metas: [] };
  }

  // Extract genre from catalog ID (e.g., 'hentaimama-genre-uncensored')
  const catalogGenreMatch = id.match(/^hentaimama-genre-(.+)$/);
  const catalogGenre = catalogGenreMatch ? catalogGenreMatch[1] : null;
  
  // Also check for genre in extra parameters (from filter dropdown)
  const extraGenre = extra.genre ? extra.genre.toLowerCase().replace(/\s+/g, '-') : null;
  
  // Use extra genre if provided, otherwise use catalog genre
  const genre = extraGenre || catalogGenre;

  const skip = parseInt(extra.skip) || 0;
  const limit = parseInt(extra.limit) || 20; // Use Stremio's requested limit (usually 20)
  
  logger.info(`Request: skip=${skip}, limit=${limit}`);
  
  const scraper = getScraper(id);
  const ttl = cache.getTTL('catalog');
  
  // Cache key for the entire accumulated series list
  const catalogCacheKey = cache.key('catalog', `${id}:${genre || 'all'}:accumulated`);
  
  // Get or create the accumulated series cache
  let catalogData = await cache.wrap(catalogCacheKey, ttl, async () => {
    return {
      series: [],          // All series fetched so far
      nextPage: 1,         // Next page to fetch from source
      isComplete: false    // Whether we've reached the end
    };
  });
  
  // Keep fetching until we have enough series to satisfy skip + limit
  const targetCount = skip + limit;
  
  while (catalogData.series.length < targetCount && !catalogData.isComplete) {
    logger.info(`Have ${catalogData.series.length} series, need ${targetCount}, fetching page ${catalogData.nextPage}`);
    
    // Fetch next page
    let newSeries;
    if (genre) {
      newSeries = await scraper.getCatalogByGenre(genre, catalogData.nextPage);
    } else {
      newSeries = await scraper.getCatalog(catalogData.nextPage, null, 'popular');
    }
    
    if (!newSeries || newSeries.length === 0) {
      logger.info(`Page ${catalogData.nextPage} returned no results - end of catalog`);
      catalogData.isComplete = true;
      break;
    }
    
    // CRITICAL: Deduplicate across ALL accumulated series!
    // HentaiMama pages can return same series on different pages
    const existingIds = new Set(catalogData.series.map(s => s.id));
    const trulyNewSeries = newSeries.filter(s => !existingIds.has(s.id));
    
    logger.info(`Page ${catalogData.nextPage} returned ${newSeries.length} items → ${trulyNewSeries.length} NEW unique series (${newSeries.length - trulyNewSeries.length} duplicates skipped)`);
    
    // Only add series we don't already have
    if (trulyNewSeries.length > 0) {
      catalogData.series.push(...trulyNewSeries);
      await cache.set(catalogCacheKey, catalogData, ttl);
    }
    
    catalogData.nextPage++;
    
    // Safety: if we get 5 pages in a row with no new series, we're done
    if (trulyNewSeries.length === 0) {
      logger.warn(`⚠️  Page ${catalogData.nextPage - 1} had no new series - might be end of catalog`);
      // Don't break immediately, try a few more pages
    }
  }
  
  // Slice the exact items requested
  const result = catalogData.series.slice(skip, skip + limit);
  
  logger.info(`📤 Returning ${result.length} items (total cached: ${catalogData.series.length})`);
  
  return { metas: result };
}

module.exports = catalogHandler;
