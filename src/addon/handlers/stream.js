const cache = require('../../cache');
const logger = require('../../utils/logger');
const parser = require('../../utils/parser');
const hentaimamaScraper = require('../../scrapers/hentaimama');

/**
 * Stream handler
 */
async function streamHandler(args) {
  const { type, id } = args;
  
  logger.info(`Stream request: ${id}`, { type });

  // Validate type
  if (type !== 'series') {
    logger.warn(`Unsupported type: ${type}`);
    return { streams: [] };
  }

  // Shorter cache for streams (they may expire)
  const cacheKey = cache.key('stream', id);
  const ttl = cache.getTTL('stream');

  try {
    return await cache.wrap(cacheKey, ttl, async () => {
      const { slug } = parser.parseVideoId(id);
      
      logger.info(`Extracting streams for: ${slug}`);
      const streams = await hentaimamaScraper.getStreams(slug);
      
      if (!streams || streams.length === 0) {
        logger.warn(`No streams found for ${id}`);
        return { streams: [] };
      }

      // Extract episode number from video ID (format: hmm-slug-episode-N:1:N)
      const episodeMatch = id.match(/:1:(\d+)$/);
      const episodeNum = episodeMatch ? episodeMatch[1] : '1';
      
      // Map to Stremio format
      const stremioStreams = streams.map(stream => {
        // Build quality label for name field (what user sees in stream list)
        let qualityLabel;
        if (stream.quality && stream.quality !== 'Unknown') {
          qualityLabel = `Episode ${episodeNum} | HentaiMama - ${stream.quality}`;
        } else {
          qualityLabel = `Episode ${episodeNum} | HentaiMama`;
        }
        
        return {
          name: qualityLabel,
          title: 'HentaiMama',
          url: stream.url,
        };
      });

      logger.info(`Returning ${stremioStreams.length} streams for ${id}`);
      return { streams: stremioStreams };
    });
  } catch (error) {
    logger.error(`Error in stream handler for ${id}:`, error);
    return { streams: [] };
  }
}

module.exports = streamHandler;
