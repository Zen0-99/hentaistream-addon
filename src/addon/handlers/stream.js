const cache = require('../../cache');
const logger = require('../../utils/logger');
const parser = require('../../utils/parser');
const hentaimamaScraper = require('../../scrapers/hentaimama');
const oppaiStreamScraper = require('../../scrapers/oppaistream');
const hentaiseaScraper = require('../../scrapers/hentaisea');
const hentaitvScraper = require('../../scrapers/hentaitv');
const { getOppaiStreamSlug } = require('../../utils/seriesNameMatcher');
const config = require('../../config/env');

/**
 * Extract search term from slug for fuzzy matching
 * "rance-01-hikari-o-motomete-the-animation-episode-1" -> "rance"
 * "enjo-kouhai-episode-1" -> "enjo kouhai"
 */
function extractSearchTerm(slug) {
  // Remove episode suffix
  let clean = slug.replace(/-episode-\d+$/, '');
  
  // Remove common suffixes that may differ between providers
  clean = clean
    .replace(/-the-animation$/, '')
    .replace(/-animation$/, '')
    .replace(/-ova$/, '')
    .replace(/-ona$/, '')
    .replace(/-uncensored$/, '')
    .replace(/-subbed$/, '')
    .replace(/-dubbed$/, '');
  
  // Split by dash and take meaningful words
  const words = clean.split('-').filter(w => w.length > 1);
  
  // For series with numbered titles like "rance-01", return just the name part
  // But keep the number if it's part of the actual title
  if (words.length >= 2 && /^\d+$/.test(words[1])) {
    // Check if it looks like a version number (01, 02, etc.)
    return words[0]; // Just return "rance"
  }
  
  // Return first 3 words max for search (more specific = fewer false positives)
  return words.slice(0, 3).join(' ');
}

/**
 * Extract multiple search terms for better cross-language matching
 * Returns array of search terms to try
 */
function extractMultipleSearchTerms(slug) {
  const terms = [];
  
  // Remove episode suffix
  let clean = slug.replace(/-episode-\d+$/, '');
  
  // Remove common suffixes
  clean = clean
    .replace(/-the-animation$/, '')
    .replace(/-animation$/, '')
    .replace(/-ova$/, '')
    .replace(/-ona$/, '');
  
  const words = clean.split('-').filter(w => w.length > 1);
  
  // Primary search: first word (for series like "Rance 01")
  if (words[0]) {
    terms.push(words[0]);
  }
  
  // Secondary: first 2-3 words (for multi-word titles)
  if (words.length >= 2) {
    terms.push(words.slice(0, 2).join(' '));
    if (words.length >= 3) {
      terms.push(words.slice(0, 3).join(' '));
    }
  }
  
  // For Japanese-named series, try to extract key words
  // "hikari-o-motomete" might have English equivalent "quest for hikari"
  const japaneseKeywords = ['hikari', 'kokoro', 'ai', 'yume', 'hime'];
  for (const word of words) {
    if (japaneseKeywords.includes(word) && !terms.includes(word)) {
      // Try combined with first word
      terms.push(`${words[0]} ${word}`);
    }
  }
  
  return [...new Set(terms)];
}

/**
 * Generate slug variations for matching across providers
 * Different sites may have different naming conventions
 */
function generateSlugVariations(cleanSlug, episodeNum) {
  const variations = [];
  
  // Extract base series slug (without episode)
  const baseSlug = cleanSlug.replace(/-episode-\d+$/, '');
  
  // Original format
  variations.push(`${baseSlug}-episode-${episodeNum}`);
  
  // Without "the-animation" suffix
  if (baseSlug.includes('-the-animation')) {
    const withoutAnim = baseSlug.replace(/-the-animation$/, '');
    variations.push(`${withoutAnim}-episode-${episodeNum}`);
  }
  
  // With "the-animation" suffix if not present
  if (!baseSlug.includes('-the-animation') && !baseSlug.includes('-animation')) {
    variations.push(`${baseSlug}-the-animation-episode-${episodeNum}`);
  }
  
  // Try hyphenated episode number (some sites use this)
  variations.push(`${baseSlug}-${episodeNum}`);
  
  // Try without romanization prefixes
  const prefixes = ['hikari-o-motomete-', 'quest-for-', 'sabaku-no-'];
  for (const prefix of prefixes) {
    if (baseSlug.includes(prefix)) {
      const withoutPrefix = baseSlug.replace(prefix, '');
      variations.push(`${withoutPrefix}-episode-${episodeNum}`);
    }
  }
  
  return [...new Set(variations)]; // Remove duplicates
}

/**
 * Stream handler
 */
async function streamHandler(args) {
  const { type, id } = args;
  
  logger.info(`Stream request: ${id}`, { type });

  // Validate type - accept both 'series' (standard) and 'hentai' (custom type)
  if (type !== 'series' && type !== 'hentai') {
    logger.warn(`Unsupported type: ${type}`);
    return { streams: [] };
  }

  // Shorter cache for streams (they may expire)
  const cacheKey = cache.key('stream', id);
  const ttl = cache.getTTL('stream');

  try {
    return await cache.wrap(cacheKey, ttl, async () => {
      const { slug } = parser.parseVideoId(id);
      const episodeMatch = id.match(/:1:(\d+)$/);
      const episodeNum = episodeMatch ? episodeMatch[1] : '1';
      
      logger.info(`Extracting streams from all providers for: ${slug}`);
      
      // Clean slug - remove all provider prefixes and the addon's "hentai-" prefix
      const cleanSlug = slug
        .replace(/^hmm-/i, '')
        .replace(/^hse-/i, '')
        .replace(/^htv-/i, '')
        .replace(/^hentaimama-/i, '')
        .replace(/^hentaisea-/i, '')
        .replace(/^hentaitv-/i, '')
        .replace(/^hentai-/i, ''); // Remove addon prefix added in catalog
      
      // Generate slug variations for cross-provider matching
      const slugVariations = generateSlugVariations(cleanSlug, episodeNum);
      logger.info(`Trying slug variations: ${slugVariations.slice(0, 3).join(', ')}...`);
      
      /**
       * Try to get streams from a provider, attempting multiple slug variations
       */
      async function tryProviderWithVariations(scraper, providerName, variations) {
        for (const variation of variations) {
          try {
            const streams = await scraper.getStreams(variation);
            if (streams && streams.length > 0) {
              logger.info(`[${providerName}] Found streams with slug: ${variation}`);
              return streams.map(s => ({ ...s, provider: providerName }));
            }
          } catch (err) {
            // 404 is expected for non-matching slugs, only log other errors
            if (!err.message?.includes('404') && !err.message?.includes('Not found')) {
              logger.debug(`[${providerName}] Error with ${variation}: ${err.message}`);
            }
          }
        }
        return [];
      }
      
      /**
       * Try HentaiTV directly - it has its own smart slug resolution via registry + WordPress API
       * No need to try multiple variations, just pass the base info and let it figure out the real slug
       */
      async function tryHentaiTV(baseSlug, epNum) {
        try {
          // Pass a standard slug format - HentaiTV's getStreams will find the real slug internally
          const standardSlug = `${baseSlug}-episode-${epNum}`;
          const streams = await hentaitvScraper.getStreams(standardSlug);
          if (streams && streams.length > 0) {
            logger.info(`[HentaiTV] Found ${streams.length} streams`);
            return streams.map(s => ({ ...s, provider: 'HentaiTV' }));
          }
        } catch (err) {
          if (!err.message?.includes('404') && !err.message?.includes('Not found')) {
            logger.debug(`[HentaiTV] Error: ${err.message}`);
          }
        }
        return [];
      }
      
      // ALWAYS poll ALL providers in parallel for maximum stream availability
      // HentaiTV uses smart slug resolution, others use variation matching
      const [hmmResult, hseResult, htvResult] = await Promise.allSettled([
        tryProviderWithVariations(hentaimamaScraper, 'HentaiMama', slugVariations),
        tryProviderWithVariations(hentaiseaScraper, 'HentaiSea', slugVariations),
        tryHentaiTV(cleanSlug.replace(/-episode-\d+$/, ''), episodeNum)
      ]);
      
      // Collect all successful streams
      const allStreams = [];
      
      // Track which providers found streams
      const foundProviders = new Set();
      
      if (hmmResult.status === 'fulfilled' && hmmResult.value?.length > 0) {
        allStreams.push(...hmmResult.value);
        foundProviders.add('HentaiMama');
        logger.info(`Found ${hmmResult.value.length} streams from HentaiMama`);
      }
      
      if (hseResult.status === 'fulfilled' && hseResult.value?.length > 0) {
        allStreams.push(...hseResult.value);
        foundProviders.add('HentaiSea');
        logger.info(`Found ${hseResult.value.length} streams from HentaiSea`);
      }
      
      if (htvResult.status === 'fulfilled' && htvResult.value?.length > 0) {
        allStreams.push(...htvResult.value);
        foundProviders.add('HentaiTV');
        logger.info(`Found ${htvResult.value.length} streams from HentaiTV`);
      }
      
      // If some providers didn't find streams, try search-based fallback
      const searchTerm = extractSearchTerm(cleanSlug);
      const baseSeriesSlug = cleanSlug.replace(/-episode-\d+$/, '');
      const humanReadableTitle = baseSeriesSlug.replace(/-/g, ' ');
      
      // Simple title similarity check - returns true if titles share significant words
      function titleMatches(title1, title2) {
        const normalize = (s) => s.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        const words1 = normalize(title1).split(' ').filter(w => w.length > 2);
        const words2 = normalize(title2).split(' ').filter(w => w.length > 2);
        
        // Count matching words
        const matches = words1.filter(w => words2.includes(w)).length;
        
        // Need at least 2 matching words or 50% of shorter title's words
        const minWords = Math.min(words1.length, words2.length);
        return matches >= 2 || matches >= minWords * 0.5;
      }
      
      if (!foundProviders.has('HentaiSea') && searchTerm.length >= 3) {
        try {
          // Try multiple search terms for better cross-language matching
          const searchTerms = extractMultipleSearchTerms(cleanSlug);
          logger.info(`[HentaiSea] Trying search fallback with terms: ${searchTerms.join(', ')}`);
          
          let foundViaSearch = false;
          
          for (const term of searchTerms) {
            if (foundViaSearch) break;
            
            const searchResults = await hentaiseaScraper.search(term);
            
            // For single-word searches (like "rance"), be more strict about matching
            // Filter by title having the exact word at the start
            const relevantResults = searchResults.filter(r => {
              const name = (r.name || '').toLowerCase();
              const termLower = term.toLowerCase();
              
              // For single word, must start with that word
              if (term.split(' ').length === 1) {
                return name.startsWith(termLower) || name.includes(` ${termLower}`);
              }
              
              // For multi-word, use title matching
              return titleMatches(r.name || '', humanReadableTitle);
            });
            
            logger.info(`[HentaiSea] "${term}": ${relevantResults.length}/${searchResults.length} results match`);
            
            for (const result of relevantResults.slice(0, 2)) {
              const resultSlug = result.id.replace('hse-', '');
              const epSlug = `${resultSlug}-episode-${episodeNum}`;
              
              try {
                const streams = await hentaiseaScraper.getStreams(epSlug);
                if (streams && streams.length > 0) {
                  const mappedStreams = streams.map(s => ({ ...s, provider: 'HentaiSea' }));
                  allStreams.push(...mappedStreams);
                  logger.info(`[HentaiSea] Found ${streams.length} streams via search for: ${resultSlug}`);
                  foundViaSearch = true;
                  break;
                }
              } catch (e) {
                // Continue to next search result
              }
            }
          }
        } catch (err) {
          logger.debug(`[HentaiSea] Search fallback failed: ${err.message}`);
        }
      }
      
      if (!foundProviders.has('HentaiTV') && searchTerm.length >= 3) {
        try {
          logger.info(`[HentaiTV] Trying search fallback for: "${searchTerm}"`);
          // HentaiTV uses WordPress API for search
          const searchUrl = `https://hentai.tv/wp-json/wp/v2/episodes?search=${encodeURIComponent(searchTerm)}&per_page=10`;
          const response = await require('axios').get(searchUrl, { timeout: 5000 });
          
          if (response.data && response.data.length > 0) {
            // Find episode matching our episode number AND title
            for (const ep of response.data) {
              const title = ep.title?.rendered || '';
              const epMatch = title.match(/Episode\s+(\d+)/i);
              
              // Check episode number matches
              if (epMatch && epMatch[1] === episodeNum) {
                // Check title similarity
                const seriesTitle = title.replace(/\s+Episode\s+\d+$/i, '');
                if (titleMatches(seriesTitle, humanReadableTitle)) {
                  // Extract slug from link
                  const linkMatch = ep.link?.match(/\/hentai\/([^\/]+)/);
                  if (linkMatch) {
                    const epSlug = linkMatch[1];
                    try {
                      const streams = await hentaitvScraper.getStreams(epSlug);
                      if (streams && streams.length > 0) {
                        const mappedStreams = streams.map(s => ({ ...s, provider: 'HentaiTV' }));
                        allStreams.push(...mappedStreams);
                        logger.info(`[HentaiTV] Found ${streams.length} streams via search for: ${epSlug}`);
                        break;
                      }
                    } catch (e) {
                      // Continue
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          logger.debug(`[HentaiTV] Search fallback failed: ${err.message}`);
        }
      }
      
      if (allStreams.length === 0) {
        logger.warn(`No streams found for ${id}`);
        return { streams: [] };
      }
      
      // Map to Stremio format
      const stremioStreams = allStreams.map(stream => {
        // Title shows episode and quality info
        let titleLabel;
        if (stream.quality && stream.quality !== 'Unknown') {
          titleLabel = `Episode ${episodeNum} - ${stream.quality}`;
        } else {
          titleLabel = `Episode ${episodeNum}`;
        }
        
        // Determine the final URL - use proxy for streams that need it
        let finalUrl = stream.url;
        if (stream.needsProxy && stream.proxyType === 'jwplayer' && stream.jwplayerUrl) {
          // HentaiSea: Use proxy with jwplayer URL to get fresh auth token each time
          const baseUrl = config.server.baseUrl;
          finalUrl = `${baseUrl}/video-proxy?jwplayer=${encodeURIComponent(stream.jwplayerUrl)}`;
          logger.info(`Stream: ${stream.provider} | ${titleLabel} -> PROXIED (jwplayer) via ${baseUrl}`);
        } else if (stream.needsProxy) {
          // Generic proxy for other IP-restricted URLs
          const baseUrl = config.server.baseUrl;
          finalUrl = `${baseUrl}/video-proxy?episodeId=${encodeURIComponent(slug)}`;
          logger.info(`Stream: ${stream.provider} | ${titleLabel} -> PROXIED (episodeId) via ${baseUrl}`);
        } else {
          // Log stream URL for debugging
          logger.info(`Stream: ${stream.provider} | ${titleLabel} -> ${stream.url.substring(0, 100)}...`);
        }
        
        return {
          name: stream.provider,
          title: titleLabel,
          url: finalUrl,
        };
      });

      logger.info(`Returning ${stremioStreams.length} total streams for ${id}`);
      return { streams: stremioStreams };
    });
  } catch (error) {
    logger.error(`Error in stream handler for ${id}:`, error);
    return { streams: [] };
  }
}

module.exports = streamHandler;
