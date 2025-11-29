const cache = require('../../cache');
const logger = require('../../utils/logger');
const hentaimamaScraper = require('../../scrapers/hentaimama');

/**
 * Meta handler
 */
async function metaHandler(args) {
  const { type, id } = args;
  
  logger.info(`Meta request: ${id}`, { type });

  // Validate type
  if (type !== 'series') {
    logger.warn(`Unsupported type: ${type}`);
    return { meta: null };
  }

  const cacheKey = cache.key('meta', id);
  const ttl = cache.getTTL('meta');

  return cache.wrap(cacheKey, ttl, async () => {
    const data = await hentaimamaScraper.getMetadata(id);
    
    if (!data) {
      logger.warn(`No metadata found for ${id}`);
      return { meta: null };
    }

    // Transform to Stremio meta format
    const meta = {
      id: data.seriesId || data.id,
      type: 'series',
      name: data.name,
      poster: data.poster || undefined,
      background: data.poster || undefined, // Use poster as background too
      description: data.description || '',
      releaseInfo: data.releaseInfo || '',
      runtime: data.runtime || '',
      genres: data.genres || undefined,
      // Build videos array from episodes with individual thumbnails
      videos: (data.episodes || []).map(ep => ({
        id: `${ep.id}:1:${ep.number}`,
        title: ep.title || `Episode ${ep.number}`,
        season: 1,
        episode: ep.number,
        thumbnail: ep.poster || data.poster || undefined, // Use episode's poster first
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
  });
}

module.exports = metaHandler;
