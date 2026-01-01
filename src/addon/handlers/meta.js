const cache = require('../../cache');
const logger = require('../../utils/logger');
const hentaimamaScraper = require('../../scrapers/hentaimama');
const oppaiStreamScraper = require('../../scrapers/oppaistream');
const hentaiseaScraper = require('../../scrapers/hentaisea');
const hentaitvScraper = require('../../scrapers/hentaitv');
const config = require('../../config/env');
const ratingNormalizer = require('../../utils/ratingNormalizer');
const { isPromotionalDescription } = require('../../utils/descriptionHelper');
const { getFromDatabase, isDatabaseReady } = require('../../utils/catalogAggregator');

/**
 * Mark a series as broken (returns 500 errors)
 * These will be filtered from catalog results
 */
async function markSeriesAsBroken(seriesId) {
  const brokenSeriesKey = cache.key('system', 'broken-series');
  const brokenSeries = await cache.get(brokenSeriesKey) || [];
  
  if (!brokenSeries.includes(seriesId)) {
    brokenSeries.push(seriesId);
    // Store for 24 hours - broken series may get fixed
    await cache.set(brokenSeriesKey, brokenSeries, 86400);
    logger.info(`Marked series as broken: ${seriesId}`);
  }
}

/**
 * Meta handler
 */
async function metaHandler(args) {
  const { type, id } = args;
  logger.info(`🎬 Meta: ${id}`);

  // Validate type
  if (type !== 'series') {
    logger.warn(`Unsupported type: ${type}`);
    return { meta: null };
  }

  // Step 1: Check pre-bundled database first for FULL metadata
  // Database v2 includes episodes with release dates - no scraping needed!
  let dbData = null;
  if (isDatabaseReady()) {
    dbData = getFromDatabase(id);
    if (dbData && dbData.hasFullMeta && dbData.episodes && dbData.episodes.length > 0) {
      // Database has full metadata - return directly without scraping
      return buildMetaResponse(dbData, dbData);
    }
  }

  // Step 2: Not in database or incomplete - use cache.wrap with scraping
  const cacheKey = cache.key('meta', id);
  const ttl = cache.getTTL('meta');

  return cache.wrap(cacheKey, ttl, async () => {
    let data;
    
    // Try scraping for metadata not in database
    try {
      // Determine which scraper to use based on ID prefix
      let scraper = hentaimamaScraper; // Default
      
      if (id.startsWith('hmm-') || id.startsWith('hentaimama-')) {
        scraper = hentaimamaScraper;
      } else if (id.startsWith('hse-') || id.startsWith('hentaisea-')) {
        scraper = hentaiseaScraper;
      } else if (id.startsWith('htv-') || id.startsWith('hentaitv-')) {
        scraper = hentaitvScraper;
      } else if (id.startsWith('os-') || id.startsWith('oppaistream-')) {
        scraper = oppaiStreamScraper;
      }
      
      data = await scraper.getMetadata(id);
    } catch (error) {
      logger.error(`Failed to fetch metadata for ${id}: ${error.message}`);
      
      // If scraping failed but we have database data, use that
      if (dbData) {
        data = dbData;
      } else {
        // Mark series as broken if it returns 500 error
        if (error.message?.includes('500') || error.response?.status === 500) {
          await markSeriesAsBroken(id);
        }
        return { meta: null };
      }
    }
    
    if (!data && !dbData) {
      logger.warn(`No metadata found for ${id}`);
      return { meta: null };
    }
    
    // Step 3: Merge database data with scraped data (if we scraped)
    if (dbData && data && data !== dbData) {
      // Use database rating if scraped doesn't have one
      if ((data.rating === undefined || data.rating === null || isNaN(data.rating)) && dbData.rating !== undefined) {
        data.rating = dbData.rating;
        data.ratingType = dbData.ratingType;
        data.voteCount = dbData.voteCount;
      }
      
      // Use database description if scraped doesn't have one or is promotional
      if ((!data.description || isPromotionalDescription(data.description)) && dbData.description) {
        data.description = dbData.description;
      }
      
      // Use database genres if scraped doesn't have any
      if ((!data.genres || data.genres.length === 0) && dbData.genres) {
        data.genres = dbData.genres;
      }
      
      // Use database studio if scraped doesn't have one
      if (!data.studio && dbData.studio) {
        data.studio = dbData.studio;
      }
    } else if (!data && dbData) {
      data = dbData;
    }

    return buildMetaResponse(data, dbData);
  });
}

/**
 * Build meta response from data
 */
function buildMetaResponse(data, dbData) {
    // Build rating breakdown for description (if multiple providers)
    // Uses priority-based rating: HentaiMama > HentaiTV > HentaiSea > N/A
    let ratingBreakdownText = '';
    let displayRating = '★ N/A'; // Default to N/A
    
    if (data.ratingBreakdown && Object.keys(data.ratingBreakdown).length >= 1) {
      const providerNames = {
        hmm: 'HentaiMama',
        htv: 'HentaiTV',
        hse: 'HentaiSea'
      };
      
      // Get priority-based rating (pass vote count for minimum threshold check)
      const ratingResult = ratingNormalizer.getPriorityRating(data.ratingBreakdown, data.voteCount);
      displayRating = ratingNormalizer.formatRatingForDisplay(ratingResult.rating, ratingResult.isNA);
      
      // Only show breakdown if multiple sources exist
      if (Object.keys(data.ratingBreakdown).length > 1) {
        const parts = Object.entries(data.ratingBreakdown)
          .map(([prefix, ratingInfo]) => {
            const name = providerNames[prefix] || prefix;
            if (typeof ratingInfo === 'object' && ratingInfo !== null) {
              if (ratingInfo.type === 'views') {
                const viewsFormatted = ratingInfo.raw >= 1000 
                  ? `${(ratingInfo.raw / 1000).toFixed(1)}k` 
                  : ratingInfo.raw;
                return `${name}: ${viewsFormatted} views`;
              } else {
                return `${name}: ${ratingInfo.raw || ratingInfo.normalized}/10`;
              }
            }
            return `${name}: ${ratingInfo}/10`;
          });
        
        ratingBreakdownText = `\n\nRatings: ${parts.join(' | ')} (Using: ${providerNames[ratingResult.source] || ratingResult.source})`;
      }
    } else if (data.rating !== undefined && data.rating !== null && !isNaN(data.rating)) {
      // Fallback for direct rating field
      displayRating = `★ ${data.rating.toFixed(1)}`;
    }
    
    // Build genre data for Stremio
    // When `links` is present, Stremio ignores the `genres` array for display
    // So we need to put BOTH genres AND studio into the links array
    const genres = data.genres || [];
    
    // Build links array with BOTH genres and studio
    const isLocalhost = config.server.baseUrl.includes('localhost') || config.server.baseUrl.includes('127.0.0.1');
    const manifestUrl = `${config.server.baseUrl}/manifest.json`;
    
    // Genre links
    const genreLinks = genres.map(genre => ({
      name: genre,
      category: 'Genres',
      url: isLocalhost 
        ? `stremio:///search?search=${encodeURIComponent(genre)}`
        : `stremio:///discover/${encodeURIComponent(manifestUrl)}/series/hentai?genre=${encodeURIComponent(genre)}`
    }));
    
    // Studio link
    const studioLinks = data.studio ? [{
      name: data.studio,
      category: 'Studio',
      url: `stremio:///search?search=${encodeURIComponent(data.studio)}`
    }] : [];
    
    // Combine all links - genres first, then studio (for display order)
    const allLinks = [...genreLinks, ...studioLinks];
    
    // Clean up promotional descriptions
    let cleanDescription = data.description || '';
    if (isPromotionalDescription(cleanDescription)) {
      cleanDescription = 'No Description';
    }
    
    // Transform to Stremio meta format
    const meta = {
      id: data.seriesId || data.id,
      type: 'series',
      name: data.name,
      poster: data.poster || undefined,
      background: data.poster || undefined,
      description: cleanDescription + ratingBreakdownText,
      releaseInfo: data.releaseInfo || data.year || undefined,
      // Show rating in runtime field (avoids IMDb logo)
      // Always shows a rating - either numeric or "★ N/A"
      runtime: displayRating,
      // Keep genres array for backwards compatibility and catalog filtering
      genres: genres.length > 0 ? genres : undefined,
      // Links array with BOTH genres and studio - this is what Stremio displays
      links: allLinks.length > 0 ? allLinks : undefined,
      // Build videos array from episodes with individual thumbnails and release dates
      videos: (data.episodes || []).map(ep => ({
        id: `${ep.id}:1:${ep.number}`,
        title: ep.title || `Episode ${ep.number}`,
        season: 1,
        episode: ep.number,
        thumbnail: ep.poster || data.poster || undefined, // Use episode's poster first
        released: ep.released || undefined, // Add release date (ISO string) for Stremio display
      })),
    };
    
    // If no episodes, create a single episode entry
    if (meta.videos.length === 0) {
      meta.videos = [{
        id: `${data.id}:1:1`,
        title: data.name,
        season: 1,
        episode: 1,
        thumbnail: data.poster || undefined,
      }];
    }

    return { meta };
}

module.exports = metaHandler;
