/**
 * HentaiSea Scraper
 * Uses /latest-series/ and /watch/{slug}/ URL patterns
 */

const cheerio = require('cheerio');
const BaseScraper = require('./base');
const logger = require('../utils/logger');
const { parseDate, extractYear } = require('../utils/dateParser');
const httpClient = require('../utils/httpClient');

class HentaiSeaScraper extends BaseScraper {
  constructor() {
    super('HentaiSea');
    this.baseUrl = 'https://hentaisea.com';
    this.prefix = 'hse-';
  }

  /**
   * Get catalog by genre wrapper
   */
  async getCatalogByGenre(genre, page = 1) {
    return this.getCatalog(page, genre);
  }

  /**
   * Get catalog items filtered by release year
   * @param {number|string} year - Year to filter by
   * @param {number} page - Page number (1-indexed)
   * @returns {Promise<Array>} Array of series items
   */
  async getCatalogByYear(year, page = 1) {
    try {
      // HentaiSea uses /release/YYYY/ URL pattern
      const url = `${this.baseUrl}/release/${year}/page/${page}/`;
      logger.info(`[HentaiSea] Fetching year ${year} page ${page}: ${url}`);
      
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      // _parseCatalogPage will filter to only items with verified matching year
      return this._parseCatalogPage($, year, null);
    } catch (error) {
      logger.error(`[HentaiSea] Year catalog error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get catalog items filtered by studio
   * @param {string} studio - Studio name (will be converted to slug)
   * @param {number} page - Page number (1-indexed)
   * @returns {Promise<Array>} Array of series items
   */
  async getCatalogByStudio(studio, page = 1) {
    try {
      // Convert studio name to URL slug: "Pink Pineapple" -> "pink-pineapple"
      const studioSlug = studio.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const url = `${this.baseUrl}/studio/${studioSlug}/page/${page}/`;
      logger.info(`[HentaiSea] Fetching studio ${studio} page ${page}: ${url}`);
      
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      return this._parseCatalogPage($, null, studio);
    } catch (error) {
      logger.error(`[HentaiSea] Studio catalog error: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse catalog page HTML (shared by getCatalog, getCatalogByYear, getCatalogByStudio)
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {string|null} filterYear - Year filter (items without this year will be excluded)
   * @param {string|null} filterStudio - Studio filter (items without matching studio will be excluded)
   */
  _parseCatalogPage($, filterYear = null, filterStudio = null) {
    const items = [];
    
    // Parse article.item.tvshows elements
    $('article.item.tvshows').each((i, el) => {
      try {
        const $item = $(el);
        
        // Get poster image
        const posterImg = $item.find('.poster img');
        const poster = posterImg.attr('data-lazy-src') || posterImg.attr('src') || '';
        
        // Get title
        const titleEl = $item.find('.data h3 a');
        const title = titleEl.text().trim();
        const href = titleEl.attr('href') || '';
        
        // Extract slug from URL
        const slugMatch = href.match(/\/watch\/([^\/]+)/);
        if (!slugMatch) return;
        const slug = slugMatch[1];
        
        // Get description
        const description = $item.find('.texto').text().trim() || '';
        
        // Get genres
        const genres = [];
        $item.find('.mta a[rel="tag"]').each((j, tagEl) => {
          const genre = $(tagEl).text().trim();
          if (genre) genres.push(genre);
        });
        
        // Extract year from the item's metadata (NOT from filter parameter)
        // We only trust what we can extract from the page itself
        // Year is in: <div class="metadata"> <span>2022</span> </div>
        const yearMatch = $item.find('.metadata span').text().match(/(\d{4})/);
        const extractedYear = yearMatch ? parseInt(yearMatch[1]) : null;
        
        // Extract studio from genres/tags if possible
        // Studio info is usually not in the catalog listing, only on detail pages
        let extractedStudio = null;
        // Check if any genre looks like a studio name (will be enriched from detail page later)
        
        const item = {
          id: `${this.prefix}${slug}`,
          type: 'series',
          name: title,
          poster: poster,
          description: description,
          genres: genres,
          year: extractedYear,
          studio: extractedStudio,
          releaseInfo: extractedYear ? String(extractedYear) : undefined
        };
        
        if (item.name && item.poster) {
          items.push(item);
        }
      } catch (err) {
        logger.debug(`[HentaiSea] Error parsing catalog item: ${err.message}`);
      }
    });
    
    logger.info(`[HentaiSea] Found ${items.length} items in catalog`);
    
    // If filtering by year, only return items where we could verify the year
    if (filterYear) {
      const yearNum = parseInt(filterYear);
      const filtered = items.filter(item => item.year === yearNum);
      logger.info(`[HentaiSea] Year ${filterYear}: ${items.length} total items, ${filtered.length} with verified year`);
      return filtered;
    }
    
    // If filtering by studio, we can't verify from catalog listing alone
    // Return all items but mark them with the filter studio (will be verified on detail page)
    // For now, trust the studio page returns correct results
    if (filterStudio) {
      items.forEach(item => {
        item.studio = filterStudio;
      });
      logger.info(`[HentaiSea] Studio ${filterStudio}: ${items.length} items (studio assigned from filter)`);
    }
    
    return items;
  }

  /**
   * Get trending/popular items with position-based ratings
   * Uses /trending/ page which is sorted by popularity
   * Position in list determines rating: #1 = 9.5, #30 = ~7.0
   * Fetches metadata from individual series pages for genres, year, description
   * @param {number} page - Page number (1-indexed)
   * @returns {Promise<Array>} Array of series items with ratings and full metadata
   */
  async getTrending(page = 1) {
    try {
      const url = `${this.baseUrl}/trending/page/${page}/`;
      logger.info(`[HentaiSea] Fetching trending page ${page}: ${url}`);
      
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      const items = [];
      const itemsPerPage = 30; // Typical items per page
      const basePosition = (page - 1) * itemsPerPage;
      
      // Parse article.item.tvshows elements - get basic info first
      $('article.item.tvshows').each((i, el) => {
        try {
          const $item = $(el);
          
          // Get poster image
          const posterImg = $item.find('.poster img');
          const poster = posterImg.attr('data-lazy-src') || posterImg.attr('src') || '';
          
          // Get title
          const titleEl = $item.find('.data h3 a');
          const title = titleEl.text().trim();
          const href = titleEl.attr('href') || '';
          
          // Extract slug from URL
          const slugMatch = href.match(/\/watch\/([^\/]+)/);
          if (!slugMatch) return;
          const slug = slugMatch[1];
          
          // Try to get embedded metadata (may not exist on trending page)
          const description = $item.find('.texto').text().trim() || '';
          const genres = [];
          $item.find('.mta a[rel="tag"]').each((j, tagEl) => {
            const genre = $(tagEl).text().trim();
            if (genre) genres.push(genre);
          });
          const yearMatch = $item.find('.data span').text().match(/(\d{4})/);
          const year = yearMatch ? parseInt(yearMatch[1]) : null;
          
          // Calculate rating based on position in trending list
          const position = basePosition + i + 1;
          const rating = Math.max(5.0, Math.round((9.5 - (position * 0.05)) * 10) / 10);
          
          const item = {
            id: `${this.prefix}${slug}`,
            type: 'series',
            name: title,
            poster: poster,
            slug: slug, // Keep slug for metadata fetch
            description: description,
            genres: genres,
            year: year,
            releaseInfo: year ? String(year) : undefined,
            rating: rating,
            ratingType: 'trending',
            trendingPosition: position
          };
          
          if (item.name && item.poster) {
            items.push(item);
          }
        } catch (err) {
          logger.debug(`[HentaiSea] Error parsing trending item: ${err.message}`);
        }
      });
      
      // ===== OPTIMIZED BATCH METADATA FETCHING =====
      // Use axios (this.client) with Promise.allSettled for parallel fetching
      // Axios follows redirects properly unlike undici, which is required for HentaiSea
      const maxMetadataFetch = 20;
      const itemsToFetch = items.slice(0, maxMetadataFetch);
      
      if (itemsToFetch.length > 0) {
        logger.info(`[HentaiSea] Batch fetching metadata for ${itemsToFetch.length} trending items...`);
        const startTime = Date.now();
        
        // Parallel fetch all series pages using axios (follows redirects)
        const fetchPromises = itemsToFetch.map(item => 
          this.client.get(`${this.baseUrl}/watch/${item.slug}/`).catch(err => ({ error: err.message }))
        );
        const batchResults = await Promise.allSettled(fetchPromises);
        
        logger.info(`[HentaiSea] Batch fetch completed in ${Date.now() - startTime}ms`);
        
        // Process results
        let enrichedCount = 0;
        for (let i = 0; i < itemsToFetch.length; i++) {
          const item = itemsToFetch[i];
          const result = batchResults[i];
          
          // Check for successful response
          const response = result.status === 'fulfilled' ? result.value : null;
          if (!response || response.error || !response.data) {
            logger.debug(`[HentaiSea] Skip ${item.name}: status=${result.status}, error=${response?.error || 'no data'}`);
            delete item.slug;
            continue;
          }
          
          try {
            const $meta = cheerio.load(response.data);
            
            // Get genres from series page using rel="tag" links (same as getMetadata)
            if (!item.genres || item.genres.length === 0) {
              const genres = [];
              $meta('a[rel="tag"]').each((j, tagEl) => {
                const genre = $meta(tagEl).text().trim();
                if (genre && !genres.includes(genre)) genres.push(genre);
              });
              if (genres.length > 0) item.genres = genres;
            }
            
            // Get year from series page (same selector as getMetadata)
            if (!item.year) {
              const yearText = $meta('.sheader .data .extra span.date, .date, time').first().text();
              const yearMatch = yearText.match(/(\d{4})/);
              if (yearMatch) {
                item.year = parseInt(yearMatch[1]);
                item.releaseInfo = String(item.year);
              }
            }
            
            // Get description from series page
            if (!item.description) {
              let desc = '';
              $meta('.wp-content p').each((j, el) => {
                const text = $meta(el).text().trim();
                if (text && !text.startsWith('Watch ') && text.length > 50) {
                  desc = text;
                  return false; // Break
                }
              });
              if (desc) item.description = desc.substring(0, 500);
            }
            
            // Get studio (same selector as getMetadata)
            $meta('.sheader .data a[href*="/studio/"], a[href*="/studio/"]').each((j, el) => {
              const studioText = $meta(el).text().trim();
              if (studioText && studioText.length > 1 && studioText.length < 50) {
                item.studio = studioText;
                return false; // Take first one only
              }
            });
            
            enrichedCount++;
          } catch (metaErr) {
            logger.debug(`[HentaiSea] Metadata parse error for ${item.name}: ${metaErr.message}`);
          }
          
          // Clean up temporary slug property
          delete item.slug;
        }
        
        logger.info(`[HentaiSea] Enriched ${enrichedCount}/${itemsToFetch.length} items with metadata`);
        
        // Debug: Show sample of enriched data
        const withGenres = items.filter(i => i.genres && i.genres.length > 0);
        logger.info(`[HentaiSea] Items with genres: ${withGenres.length}/${items.length}`);
        if (withGenres.length > 0) {
          logger.debug(`[HentaiSea] Sample: ${withGenres[0].name} - genres: ${withGenres[0].genres.join(', ')}`);
        }
      }
      
      logger.info(`[HentaiSea] Trending complete: ${items.length} items (page ${page})`);
      return items;
      
    } catch (error) {
      logger.error(`[HentaiSea] Trending error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get catalog items from latest-series page or trending page
   * @param {number} page - Page number (1-indexed)
   * @param {string} genre - Optional genre filter
   * @param {string} sortBy - Sort order: 'popular' uses /trending/, 'recent' uses /latest-series/
   * @returns {Promise<Array>} Array of series items
   */
  async getCatalog(page = 1, genre = null, sortBy = 'popular') {
    try {
      // For popular sort without genre filter, use trending page
      if (sortBy === 'popular' && !genre) {
        return this.getTrending(page);
      }
      
      let url;
      if (genre) {
        url = `${this.baseUrl}/genre/${genre}/page/${page}/`;
      } else {
        url = `${this.baseUrl}/latest-series/page/${page}/`;
      }
      
      logger.info(`[HentaiSea] Fetching catalog page ${page}: ${url}`);
      
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      const items = [];
      
      // Parse article.item.tvshows elements
      $('article.item.tvshows').each((i, el) => {
        try {
          const $item = $(el);
          
          // Get poster image (series cover, not episode thumbnail)
          const posterImg = $item.find('.poster img');
          const poster = posterImg.attr('data-lazy-src') || posterImg.attr('src') || '';
          
          // Get title
          const titleEl = $item.find('.data h3 a');
          const title = titleEl.text().trim();
          const href = titleEl.attr('href') || '';
          
          // Extract slug from URL: /watch/slug/
          const slugMatch = href.match(/\/watch\/([^\/]+)/);
          if (!slugMatch) return;
          const slug = slugMatch[1];
          
          // Get description
          const description = $item.find('.texto').text().trim() || '';
          
          // Get genres from .mta a[rel="tag"]
          const genres = [];
          $item.find('.mta a[rel="tag"]').each((j, tagEl) => {
            const genre = $(tagEl).text().trim();
            if (genre) genres.push(genre);
          });
          
          // Get year if available
          const yearMatch = $item.find('.data span').text().match(/(\d{4})/);
          const year = yearMatch ? parseInt(yearMatch[1]) : null;
          
          const item = {
            id: `${this.prefix}${slug}`,
            type: 'series',
            name: title,
            poster: poster,
            description: description,
            genres: genres,
            year: year,
            releaseInfo: year ? String(year) : undefined // Year only for catalog display
          };
          
          if (item.name && item.poster) {
            items.push(item);
          }
        } catch (err) {
          logger.debug(`[HentaiSea] Error parsing catalog item: ${err.message}`);
        }
      });
      
      logger.info(`[HentaiSea] Found ${items.length} items in catalog`);
      return items;
      
    } catch (error) {
      logger.error(`[HentaiSea] Catalog error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get detailed metadata for a series
   * @param {string} seriesId - Series ID with prefix
   */
  async getMetadata(seriesId) {
    try {
      const slug = seriesId.replace(this.prefix, '');
      const url = `${this.baseUrl}/watch/${slug}/`;
      
      logger.info(`[HentaiSea] Fetching metadata: ${url}`);
      
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      // Get title
      const title = $('h1.entry-title').text().trim() || 
                    $('.sheader .data h1').text().trim() || 
                    $('title').text().replace(' – HentaiSea', '').trim();
      
      // Get poster
      const posterImg = $('.poster img');
      const poster = posterImg.attr('data-lazy-src') || posterImg.attr('src') || '';
      
      // Get description - look for the main content description
      let description = '';
      $('.wp-content p').each((i, el) => {
        const text = $(el).text().trim();
        // Skip generic "Watch X" descriptions, get actual synopsis
        if (text && !text.startsWith('Watch ') && text.length > 50) {
          description = text;
          return false; // break
        }
      });
      // Fallback to first paragraph if no good description found
      if (!description) {
        description = $('.wp-content p').first().text().trim() || '';
      }
      
      // Get genres/tags using rel=tag links (specific to this series)
      const genres = [];
      $('a[rel="tag"]').each((i, el) => {
        const genre = $(el).text().trim();
        if (genre && !genres.includes(genre)) {
          genres.push(genre);
        }
      });
      
      // Extract studio from series page
      // Look for links to /studio/ pages
      let studio = null;
      $('.sheader .data a[href*="/studio/"], a[href*="/studio/"]').each((i, el) => {
        const studioText = $(el).text().trim();
        if (studioText && studioText.length > 1 && studioText.length < 50) {
          // Normalize capitalization (prefer Title Case over ALL CAPS)
          if (studioText === studioText.toUpperCase() && studioText.length > 3) {
            studio = studioText.split(' ')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ');
          } else {
            studio = studioText;
          }
          return false; // Take first one only
        }
      });
      
      // Get year from date if available
      const yearText = $('.sheader .data .extra span.date, .date, time').first().text();
      const yearMatch = yearText.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;
      
      // Extract lastUpdated from article meta for weekly/monthly filtering
      // Try modified time first (more relevant), then published time
      const modifiedTime = $('meta[property="article:modified_time"]').attr('content');
      const publishedTime = $('meta[property="article:published_time"]').attr('content');
      const metaDate = modifiedTime || publishedTime;
      const lastUpdated = metaDate ? parseDate(metaDate) : null;
      if (lastUpdated) {
        logger.debug(`[HentaiSea] Found lastUpdated ${lastUpdated} for ${title}`);
      }
      
      // Get episodes
      const episodes = [];
      
      // Try episode list selectors
      $('#seasons .se-c .se-a li, .episodios li').each((i, el) => {
        try {
          const $ep = $(el);
          const epLink = $ep.find('a').first();
          const epHref = epLink.attr('href') || '';
          const epTitle = $ep.find('.episodiotitle a').text().trim() || 
                          epLink.text().trim() ||
                          $ep.find('.epst').text().trim();
          
          // Extract episode slug
          const epSlugMatch = epHref.match(/\/episodes\/([^\/]+)/);
          if (!epSlugMatch) return;
          const epSlug = epSlugMatch[1];
          
          // Try to extract episode number
          const epNumMatch = epTitle.match(/(?:Episode|Ep\.?)\s*(\d+)/i) ||
                            epSlug.match(/episode-(\d+)/i);
          const epNum = epNumMatch ? parseInt(epNumMatch[1]) : i + 1;
          
          // Get episode thumbnail if available
          const epThumb = $ep.find('img').attr('data-lazy-src') || 
                          $ep.find('img').attr('src') || 
                          poster;
          
          episodes.push({
            id: `${this.prefix}${epSlug}`,
            slug: epSlug,
            number: epNum,
            title: epTitle || `Episode ${epNum}`,
            poster: epThumb
          });
        } catch (err) {
          logger.debug(`[HentaiSea] Error parsing episode: ${err.message}`);
        }
      });
      
      // Sort episodes by number
      episodes.sort((a, b) => a.number - b.number);
      
      logger.info(`[HentaiSea] Found ${episodes.length} episodes for ${title}, studio: ${studio || 'none'}`);
      
      return {
        id: seriesId,
        type: 'series',
        name: title,
        poster: poster,
        background: poster,
        description: description,
        genres: genres,
        studio: studio,
        year: year,
        lastUpdated: lastUpdated,
        episodes: episodes
      };
      
    } catch (error) {
      logger.error(`[HentaiSea] Metadata error: ${error.message}`);
      return null;
    }
  }

  /**
   * Search for series
   */
  async search(query) {
    try {
      const url = `${this.baseUrl}/?s=${encodeURIComponent(query)}`;
      
      logger.info(`[HentaiSea] Searching: ${query}`);
      
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      const results = [];
      
      // Parse search results (similar structure to catalog)
      $('.result-item, article.item').each((i, el) => {
        try {
          const $item = $(el);
          
          const posterImg = $item.find('.poster img, .image img');
          const poster = posterImg.attr('data-lazy-src') || posterImg.attr('src') || '';
          
          const titleEl = $item.find('.title a, .data h3 a');
          const title = titleEl.text().trim();
          const href = titleEl.attr('href') || '';
          
          // Only include series (not episodes)
          if (!href.includes('/watch/')) return;
          
          const slugMatch = href.match(/\/watch\/([^\/]+)/);
          if (!slugMatch) return;
          const slug = slugMatch[1];
          
          const description = $item.find('.texto, .contenido p').text().trim() || '';
          
          results.push({
            id: `${this.prefix}${slug}`,
            type: 'series',
            name: title,
            poster: poster,
            description: description
          });
        } catch (err) {
          logger.debug(`[HentaiSea] Error parsing search result: ${err.message}`);
        }
      });
      
      logger.info(`[HentaiSea] Found ${results.length} search results`);
      return results;
      
    } catch (error) {
      logger.error(`[HentaiSea] Search error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get streams for an episode
   * @param {string} episodeId - Episode ID with prefix
   */
  async getStreams(episodeId) {
    try {
      const episodeSlug = episodeId.replace(this.prefix, '');
      const url = `${this.baseUrl}/episodes/${episodeSlug}/`;
      
      logger.info(`[HentaiSea] Fetching streams: ${url}`);
      
      const response = await this.client.get(url);
      const html = response.data;
      const $ = cheerio.load(html);
      
      const streams = [];
      
      // Method 1: Try dooplay_player AJAX
      // Note: The page uses single quotes for attributes: data-post='48206'
      const postIdMatch = html.match(/data-post=['"](\d+)['"]/);
      const numbeMatch = html.match(/data-nume=['"](\d+)['"]/);
      
      if (postIdMatch && numbeMatch) {
        try {
          logger.info(`[HentaiSea] Trying dooplay_player AJAX: post=${postIdMatch[1]}, nume=${numbeMatch[1]}`);
          
          const formData = new URLSearchParams();
          formData.append('action', 'doo_player_ajax');
          formData.append('post', postIdMatch[1]);
          formData.append('nume', numbeMatch[1]);
          formData.append('type', 'tv');
          
          const ajaxResponse = await this.client.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, formData.toString(), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': url,
              'X-Requested-With': 'XMLHttpRequest'
            }
          });
          
          const responseData = ajaxResponse.data;
          
          // Response can be JSON or HTML iframe
          if (typeof responseData === 'object' && responseData.embed_url) {
            // JSON response
            const embedUrl = responseData.embed_url;
            logger.info(`[HentaiSea] Got embed URL from JSON: ${embedUrl}`);
            const directStream = await this.extractStreamFromEmbed(embedUrl);
            if (directStream) streams.push(directStream);
          } else if (typeof responseData === 'string') {
            // HTML iframe response - extract the full iframe src URL
            logger.info(`[HentaiSea] Got HTML iframe response`);
            
            // Extract the full jwplayer iframe URL (includes source parameter)
            const iframeSrcMatch = responseData.match(/src=['"]([^'"]+jwplayer[^'"]+)['"]/);
            if (iframeSrcMatch) {
              let jwplayerUrl = iframeSrcMatch[1];
              // Ensure full URL
              if (jwplayerUrl.startsWith('//')) {
                jwplayerUrl = 'https:' + jwplayerUrl;
              } else if (!jwplayerUrl.startsWith('http')) {
                jwplayerUrl = this.baseUrl + jwplayerUrl;
              }
              
              logger.info(`[HentaiSea] Found jwplayer URL: ${jwplayerUrl.substring(0, 80)}...`);
              
              // Store the jwplayer URL for proxy to use (fetches fresh auth on each request)
              streams.push({
                url: jwplayerUrl, // Store jwplayer URL, not video URL
                jwplayerUrl: jwplayerUrl,
                title: `HentaiSea MP4`,
                name: this.name,
                needsProxy: true,
                proxyType: 'jwplayer'  // Tells proxy to fetch fresh auth from this URL
              });
            }
            
            // Fallback: try to extract source URL directly (won't have auth tokens)
            if (streams.length === 0) {
              const sourceMatch = responseData.match(/source=([^&'"]+)/);
              if (sourceMatch) {
                const videoUrl = decodeURIComponent(sourceMatch[1]);
                logger.warn(`[HentaiSea] Using unauthenticated URL (may not work): ${videoUrl}`);
                if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
                  streams.push({
                    url: videoUrl,
                    title: `HentaiSea ${videoUrl.includes('.m3u8') ? 'HLS' : 'MP4'} (may require browser)`,
                    name: this.name,
                    needsProxy: true
                  });
                }
              }
            }
          }
        } catch (ajaxErr) {
          logger.warn(`[HentaiSea] AJAX failed: ${ajaxErr.message}`);
        }
      }
      
      // Method 2: Look for direct video sources in page
      $('source[src*=".mp4"], source[src*=".m3u8"]').each((i, el) => {
        const src = $(el).attr('src');
        const type = $(el).attr('type') || 'video/mp4';
        if (src) {
          streams.push({
            url: src,
            title: `HentaiSea ${type.includes('m3u8') ? 'HLS' : 'MP4'}`,
            name: this.name
          });
        }
      });
      
      // Method 3: Look for iframe embeds
      const iframeSrcs = [];
      $('iframe[src*="embed"], iframe[src*="player"]').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src) iframeSrcs.push(src);
      });
      
      // Method 4: Extract from inline scripts
      const videoUrlPatterns = [
        /file["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/gi,
        /source["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/gi,
        /src["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/gi,
        /file["']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)/gi,
        /["']?(https?:\/\/[^"']*\.mp4[^"']*)/gi,
        /["']?(https?:\/\/[^"']*\.m3u8[^"']*)/gi
      ];
      
      for (const pattern of videoUrlPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          const videoUrl = match[1];
          if (videoUrl && !videoUrl.includes('thumbnail') && !videoUrl.includes('poster')) {
            const isDuplicate = streams.some(s => s.url === videoUrl);
            if (!isDuplicate) {
              streams.push({
                url: videoUrl,
                title: `HentaiSea ${videoUrl.includes('.m3u8') ? 'HLS' : 'MP4'}`,
                name: this.name
              });
            }
          }
        }
      }
      
      // Process iframes
      for (const iframeSrc of iframeSrcs) {
        try {
          const directStream = await this.extractStreamFromEmbed(iframeSrc);
          if (directStream) {
            streams.push(directStream);
          }
        } catch (err) {
          logger.debug(`[HentaiSea] Failed to process iframe: ${err.message}`);
        }
      }
      
      logger.info(`[HentaiSea] Found ${streams.length} streams`);
      return streams;
      
    } catch (error) {
      logger.error(`[HentaiSea] Stream error: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract direct stream URL from an embed URL
   */
  async extractStreamFromEmbed(embedUrl) {
    try {
      // Make sure we have a full URL
      if (!embedUrl.startsWith('http')) {
        if (embedUrl.startsWith('//')) {
          embedUrl = 'https:' + embedUrl;
        } else {
          embedUrl = this.baseUrl + embedUrl;
        }
      }
      
      logger.debug(`[HentaiSea] Extracting from embed: ${embedUrl}`);
      
      const response = await this.client.get(embedUrl, {
        headers: {
          'Referer': this.baseUrl
        }
      });
      
      const html = response.data;
      
      // Look for video URLs
      const patterns = [
        /file["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/i,
        /source["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/i,
        /src["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/i,
        /file["']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)/i,
        /["'](https?:\/\/[^"']*\.mp4[^"']*)/i,
        /["'](https?:\/\/[^"']*\.m3u8[^"']*)/i
      ];
      
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const videoUrl = match[1];
          if (!videoUrl.includes('thumbnail') && !videoUrl.includes('poster')) {
            return {
              url: videoUrl,
              title: `HentaiSea ${videoUrl.includes('.m3u8') ? 'HLS' : 'MP4'}`,
              name: this.name
            };
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.debug(`[HentaiSea] Embed extraction failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get available genres
   */
  async getGenres() {
    try {
      const response = await this.client.get(`${this.baseUrl}/genre/`);
      const $ = cheerio.load(response.data);
      
      const genres = [];
      
      $('a[href*="/genre/"]').each((i, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr('href') || '';
        const slugMatch = href.match(/\/genre\/([^\/]+)/);
        
        if (slugMatch && name) {
          genres.push({
            id: slugMatch[1],
            name: name
          });
        }
      });
      
      // Remove duplicates
      const uniqueGenres = genres.filter((g, i, arr) => 
        arr.findIndex(x => x.id === g.id) === i
      );
      
      return uniqueGenres;
    } catch (error) {
      logger.error(`[HentaiSea] Genre fetch error: ${error.message}`);
      return [];
    }
  }
}

module.exports = new HentaiSeaScraper();
