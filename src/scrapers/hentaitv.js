const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { parseDate, extractYear } = require('../utils/dateParser');
const httpClient = require('../utils/httpClient');
const slugRegistry = require('../cache/slugRegistry');

class HentaiTVScraper {
  constructor() {
    this.baseUrl = 'https://hentai.tv';
    this.apiUrl = 'https://hentai.tv/wp-json/wp/v2';
    this.name = 'HentaiTV';
    this.prefix = 'htv-';
    this.client = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    });
    
    // Known patterns where "+" needs to be restored in video URLs
    // The video CDN (r2.1hanime.com) uses "+" for certain title components
    this.plusPatterns = [
      { from: /^1ldk-jk-/i, to: '1ldk-+-jk-' },  // 1LDK + JK series
      // Add more patterns as discovered
    ];
    
    // Prefixes that should be removed from video slugs
    // r2.1hanime.com often doesn't include "ova-" prefix
    this.removablePrefixes = ['ova-', 'ona-', 'special-'];
    
    // Top genres to check for metadata (most common ones)
    this.topGenres = [
      'big-boobs', 'blow-job', 'uncensored', 'censored', 'hd',
      'creampie', 'school-girl', 'rape', 'harem', 'anal',
      'bondage', 'virgin', 'milf', 'ntr', 'ahegao',
      'plot', 'romance', 'comedy', 'fantasy', 'tentacle',
      'incest', 'netorare', 'yuri', 'futanari', 'monster'
    ];
  }

  /**
   * Parse episode number from a slug
   * @param {string} slug - Episode slug (e.g., "series-name-episode-1")
   * @returns {number|null} Episode number or null if not found
   */
  parseEpisodeNumber(slug) {
    if (!slug) return null;
    const match = slug.match(/-episode-(\d+)$/i);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Fetch episode metadata from WordPress API
   * @param {string} episodeSlug - Episode slug (e.g., "series-name-episode-1")
   */
  async fetchEpisodeFromAPI(episodeSlug) {
    try {
      const response = await this.client.get(
        `${this.apiUrl}/episodes?slug=${episodeSlug}&_embed`
      );
      
      if (response.data && response.data.length > 0) {
        const ep = response.data[0];
        const contentHtml = ep.content?.rendered || '';
        const $ = cheerio.load(contentHtml);
        
        // Try to get description from .sh-description first, then fall back to text content
        let description = $('.sh-description').text().trim();
        
        if (!description) {
          // Fall back to plain text content (strip HTML tags)
          // Also remove "Series Name Episode X is:" prefix if present
          description = $('p').text().trim() || $(contentHtml).text().trim();
          
          // Clean up common prefixes like "Series Name Episode 1 is:"
          const prefixMatch = description.match(/^.+?\s+Episode\s+\d+\s+is:\s*/i);
          if (prefixMatch) {
            description = description.substring(prefixMatch[0].length).trim();
          }
        }
        
        // Parse the full date from WordPress API
        const fullDate = parseDate(ep.date) || null;
        const year = fullDate ? extractYear(fullDate) : null;
        
        return {
          id: ep.id,
          title: ep.title?.rendered,
          slug: ep.slug,
          description: description || null,
          poster: ep._embedded?.['wp:featuredmedia']?.[0]?.source_url || null,
          date: ep.date,
          lastUpdated: fullDate,
          year: year
        };
      }
      return null;
    } catch (error) {
      logger.debug(`[HentaiTV] API fetch failed for ${episodeSlug}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch episode page to get BOTH description AND genres in a single request
   * This is more efficient than API + genre page checks
   * @param {string} episodeSlug - Episode slug (e.g., "series-name-episode-1")
   */
  async fetchEpisodePageMetadata(episodeSlug) {
    try {
      const url = `${this.baseUrl}/hentai/${episodeSlug}/`;
      const response = await this.client.get(url, { 
        timeout: 8000,
        maxRedirects: 0, // Don't follow redirect to interstitial
        headers: {
          ...this.client.defaults.headers,
          'Cookie': 'inter=1' // Bypass interstitial page
        },
        validateStatus: status => status < 400
      });
      
      const $ = cheerio.load(response.data);
      
      // Extract genres from aria-label buttons that link to /genre/
      // Format: <a class="btn..." aria-label="big boobs" href="https://hentai.tv/genre/big-boobs/">
      const genres = [];
      $('a[aria-label][href*="/genre/"]').each((i, el) => {
        const label = $(el).attr('aria-label');
        if (label) {
          // Skip year-like values (e.g., "1986", "2024") - these are NOT genres
          if (/^\d{4}$/.test(label.trim())) {
            return; // Skip this one
          }
          
          // Capitalize each word: "big boobs" -> "Big Boobs"
          const formatted = label
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
          if (!genres.includes(formatted)) {
            genres.push(formatted);
          }
        }
      });
      
      // Extract brand/studio from links to /brand/
      // Format 1: <a class="btn..." aria-label="pink pineapple" href="https://hentai.tv/brand/pink-pineapple/">
      // Format 2: <a href="https://hentai.tv/brand/softcell/">SoftCell</a> (no aria-label)
      let studio = null;
      
      // Try aria-label first (more reliable)
      $('a[aria-label][href*="/brand/"]').each((i, el) => {
        const label = $(el).attr('aria-label');
        if (label) {
          // Capitalize each word: "pink pineapple" -> "Pink Pineapple"
          studio = label
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
          return false; // Take first one only
        }
      });
      
      // Fallback: Get studio from link text if no aria-label
      if (!studio) {
        $('a[href*="/brand/"]').each((i, el) => {
          const text = $(el).text().trim();
          if (text && text.length > 1 && text.length < 50) {
            studio = text;
            return false; // Take first one only
          }
        });
      }
      
      // Extract description from the prose div
      let description = '';
      const proseDiv = $('div.prose').first();
      if (proseDiv.length) {
        description = proseDiv.text().trim();
      }
      
      // Also try meta description as fallback
      if (!description) {
        description = $('meta[property="og:description"]').attr('content') || '';
      }
      
      // Extract poster from og:image
      const poster = $('meta[property="og:image"]').attr('content') || '';
      
      // Extract view count from the page
      // Format: <p class="text-silver-200">18,565 views</p>
      let viewCount = null;
      $('p.text-silver-200, .text-silver-200').each((i, el) => {
        const text = $(el).text().trim();
        const viewMatch = text.match(/([\d,]+)\s*views/i);
        if (viewMatch) {
          viewCount = parseInt(viewMatch[1].replace(/,/g, ''));
        }
      });
      
      // Extract ACTUAL Release Date (not upload date) from episode info
      // Format: <span class="text-silver-100 block">Release Date</span><span>1986-07-13 16:04:52</span>
      let releaseDate = null;
      let releaseYear = null;
      $('span.text-silver-100').each((i, el) => {
        const labelText = $(el).text().trim();
        if (labelText.toLowerCase().includes('release date')) {
          // Get the next sibling span which contains the actual date
          const dateSpan = $(el).next('span');
          const dateText = dateSpan.text().trim();
          // Date format: "1986-07-13 16:04:52"
          const dateMatch = dateText.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (dateMatch) {
            releaseYear = parseInt(dateMatch[1]);
            releaseDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
            logger.debug(`[HentaiTV] Found Release Date: ${releaseDate}, year: ${releaseYear}`);
          }
          return false; // Break after finding first
        }
      });
      
      logger.debug(`[HentaiTV] Episode page ${episodeSlug}: ${genres.length} genres, ${viewCount || 0} views, studio: ${studio || 'none'}, releaseDate: ${releaseDate || 'none'}`);
      
      return {
        description: description || null,
        genres: genres.length > 0 ? genres : null,
        poster: poster || null,
        viewCount: viewCount,
        studio: studio,
        releaseDate: releaseDate,
        releaseYear: releaseYear
      };
    } catch (error) {
      logger.debug(`[HentaiTV] Episode page fetch failed for ${episodeSlug}: ${error.message}`);
      return { description: null, genres: null, poster: null, viewCount: null, studio: null };
    }
  }

  /**
   * Find genres for an episode by checking genre pages
   * @param {string} episodeSlug - Episode slug to search for
   * @deprecated Use fetchEpisodePageMetadata instead - gets genres from episode page directly
   */
  async findGenresForEpisode(episodeSlug) {
    try {
      const foundGenres = [];
      
      // Check genre pages in parallel for speed
      const results = await Promise.all(
        this.topGenres.map(async (genre) => {
          try {
            const res = await this.client.get(`${this.baseUrl}/genre/${genre}/`, {
              timeout: 5000
            });
            return { genre, found: res.data.includes(episodeSlug) };
          } catch (e) {
            return { genre, found: false };
          }
        })
      );
      
      results.forEach(r => {
        if (r.found) {
          // Convert slug to display name (e.g., "big-boobs" -> "Big Boobs")
          const displayName = r.genre
            .replace(/-/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
          foundGenres.push(displayName);
        }
      });
      
      return foundGenres;
    } catch (error) {
      logger.warn(`[HentaiTV] Genre detection failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate possible video slug variations for r2.1hanime.com
   * The CDN URL format can vary, so we try multiple possibilities
   */
  generateVideoSlugVariations(episodeSlug) {
    // Base transformation: remove "-episode-" and keep just the number
    const baseSlug = episodeSlug.replace(/-episode-(\d+)$/, '-$1');
    const variations = [baseSlug];
    
    // Try removing common prefixes (ova-, ona-, etc.)
    for (const prefix of this.removablePrefixes) {
      if (baseSlug.toLowerCase().startsWith(prefix)) {
        const withoutPrefix = baseSlug.substring(prefix.length);
        variations.unshift(withoutPrefix); // Add at start (most likely)
      }
    }
    
    // Try known "+" patterns
    for (const pattern of this.plusPatterns) {
      if (pattern.from.test(baseSlug)) {
        const plusSlug = baseSlug.replace(pattern.from, pattern.to);
        variations.unshift(plusSlug); // Add at start (most likely)
      }
      // Also try "+" pattern on variations without prefix
      for (const v of [...variations]) {
        if (pattern.from.test(v) && !variations.includes(v.replace(pattern.from, pattern.to))) {
          variations.push(v.replace(pattern.from, pattern.to));
        }
      }
    }
    
    // Also try the original slug without -episode- transformation
    // Some videos might use full episode format
    const altSlug = episodeSlug.replace(/-episode-/, '-');
    if (!variations.includes(altSlug)) {
      variations.push(altSlug);
    }
    
    return variations;
  }

  /**
   * Fetch catalog from search page - includes view counts for each episode
   * This is used for "popular" sorting since view counts indicate popularity
   * @param {number} page - Page number (1-indexed)
   * @returns {Promise<Array>} Array of series items with view counts
   */
  async getCatalogFromSearchPage(page = 1) {
    try {
      const url = page === 1 
        ? `${this.baseUrl}/?s=` 
        : `${this.baseUrl}/page/${page}/?s=`;
      
      logger.info(`[HentaiTV] Fetching catalog from search page ${page}: ${url}`);
      
      const response = await this.client.get(url, {
        timeout: 15000,
        headers: {
          ...this.client.defaults.headers,
          'Cookie': 'inter=1' // Bypass interstitial page
        },
        validateStatus: status => status < 400
      });
      
      const $ = cheerio.load(response.data);
      
      // Parse episodes with view counts from the search results
      // HentaiTV uses figure elements for posters, with links in parent containers
      const episodeMap = new Map();
      
      // First, build a map of poster URLs by finding figure elements with images
      // Each figure is inside a card container (crsl-slde class) with exactly one link
      const posterMap = new Map(); // episodeSlug -> posterUrl
      $('figure').each((i, el) => {
        const $figure = $(el);
        const $img = $figure.find('img[src*="wp-content/uploads"]');
        if (!$img.length) return;
        
        const posterUrl = $img.attr('src') || '';
        
        // Card container is 2 levels up from figure
        const $cardContainer = $figure.parent().parent();
        
        // Get the first link to /hentai/ in this card
        const $link = $cardContainer.find('a[href*="/hentai/"]').first();
        if ($link.length) {
          const href = $link.attr('href') || '';
          const slugMatch = href.match(/\/hentai\/([^\/]+)/);
          if (slugMatch) {
            posterMap.set(slugMatch[1], posterUrl);
          }
        }
      });
      
      // Now parse all episode links
      $('a[href*="/hentai/"]').each((i, el) => {
        const $link = $(el);
        const href = $link.attr('href') || '';
        
        // Only process episode links
        if (!href.includes('/hentai/')) return;
        
        const title = $link.text().trim();
        if (!title || title.length < 5) return;
        
        // Get slug from href
        const slugMatch = href.match(/\/hentai\/([^\/]+)/);
        if (!slugMatch) return;
        const episodeSlug = slugMatch[1];
        
        // Parse series name and episode number from title
        // Handle both "Episode" and "Episodio" (Spanish titles)
        const episodeMatch = title.match(/^(.+?)\s+Episod[eo]\s+(\d+)$/i);
        if (!episodeMatch) return;
        
        const seriesName = episodeMatch[1].trim();
        const episodeNum = parseInt(episodeMatch[2]);
        
        // Look for view count in nearby elements
        let views = null;
        const $container = $link.closest('div').parent();
        $container.find('*').each((j, child) => {
          const text = $(child).text().trim();
          if (/^[\d,]+$/.test(text) && text.length >= 4) {
            const num = parseInt(text.replace(/,/g, ''));
            if (num > 1000 && num < 100000000) {
              views = num;
              return false;
            }
          }
        });
        
        // Get poster URL from the posterMap we built earlier
        const poster = posterMap.get(episodeSlug) || '';
        
        // Create series slug
        const seriesSlug = seriesName.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        if (!seriesSlug) return;
        
        // *** CRITICAL: Store the REAL episode slug in the registry ***
        // This is the key optimization - we know the actual slug from the URL
        slugRegistry.set('htv', seriesSlug, episodeNum, episodeSlug);
        
        // Group by series - accumulate view counts from all episodes
        if (!episodeMap.has(seriesSlug)) {
          episodeMap.set(seriesSlug, {
            id: `${this.prefix}${seriesSlug}`,
            type: 'series',
            name: seriesName,
            poster: poster,
            totalViews: views || 0,
            episodeCount: 1,
            maxEpisodeViews: views || 0,
            // Store the REAL slug for episode 1 if this is episode 1
            episode1Slug: episodeNum === 1 ? episodeSlug : `${seriesSlug}-episode-1`,
            // Track real slugs we've discovered
            knownSlugs: { [episodeNum]: episodeSlug }
          });
        } else {
          const series = episodeMap.get(seriesSlug);
          series.episodeCount++;
          // Store this episode's real slug
          series.knownSlugs[episodeNum] = episodeSlug;
          // Update episode1Slug if this is episode 1
          if (episodeNum === 1) {
            series.episode1Slug = episodeSlug;
          }
          if (views) {
            series.totalViews += views;
            if (views > series.maxEpisodeViews) {
              series.maxEpisodeViews = views;
            }
          }
          // Update poster if we have one and series doesn't
          if (!series.poster && poster) {
            series.poster = poster;
          }
        }
      });
      
      // Convert to array and use average views per episode as the viewCount
      const seriesArray = Array.from(episodeMap.values()).map(series => ({
        ...series,
        viewCount: series.maxEpisodeViews, // Use max episode views as indicator
        ratingType: 'views'
      }));
      
      logger.info(`[HentaiTV] Found ${seriesArray.length} unique series with view counts from search page ${page}`);
      
      // ===== OPTIMIZED BATCH METADATA FETCHING VIA WORDPRESS API =====
      // Use axios (this.client) which handles gzip decompression automatically
      // (undici returns compressed data without auto-decompress)
      const itemsToFetch = seriesArray.slice(0, 20);
      
      if (itemsToFetch.length > 0) {
        logger.info(`[HentaiTV] Batch fetching metadata via WordPress API for ${itemsToFetch.length} items...`);
        const startTime = Date.now();
        
        // Build WordPress API URLs - use the FIRST KNOWN REAL slug from knownSlugs
        const fetchPromises = itemsToFetch.map(series => {
          const knownEpisodes = Object.keys(series.knownSlugs || {});
          const firstKnownSlug = knownEpisodes.length > 0 
            ? series.knownSlugs[knownEpisodes[0]] 
            : series.episode1Slug;
          const url = `${this.apiUrl}/episodes?slug=${encodeURIComponent(firstKnownSlug)}&_embed`;
          return this.client.get(url).catch(err => ({ error: err.message }));
        });
        
        const batchResults = await Promise.allSettled(fetchPromises);
        
        logger.info(`[HentaiTV] WordPress API batch fetch completed in ${Date.now() - startTime}ms`);
        
        // Process results - WordPress API returns arrays
        let enrichedCount = 0;
        let emptyResponses = 0;
        for (let i = 0; i < itemsToFetch.length; i++) {
          const series = itemsToFetch[i];
          const result = batchResults[i];
          
          // Check for successful response
          const response = result.status === 'fulfilled' ? result.value : null;
          if (!response || response.error || !response.data) {
            continue;
          }
          
          try {
            // Axios auto-parses JSON, so response.data is already an array
            const episodes = response.data;
            if (!Array.isArray(episodes) || episodes.length === 0) {
              emptyResponses++;
              continue;
            }
            
            const ep = episodes[0];
            
            // Extract genres and studio from class_list
            // Format: "genre-big-boobs", "brand-pink-pineapple"
            if (ep.class_list && Array.isArray(ep.class_list)) {
              const genres = [];
              for (const cls of ep.class_list) {
                if (cls.startsWith('genre-')) {
                  // Convert "genre-big-boobs" to "Big Boobs"
                  const genre = cls.replace('genre-', '').split('-')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                  if (genre && !genres.includes(genre)) genres.push(genre);
                }
                if (cls.startsWith('brand-')) {
                  // Convert "brand-pink-pineapple" to "Pink Pineapple"
                  series.studio = cls.replace('brand-', '').split('-')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                }
              }
              if (genres.length > 0) series.genres = genres;
            }
            
            // Extract description from content.rendered
            if (ep.content && ep.content.rendered) {
              // Strip HTML tags and get text
              const text = ep.content.rendered.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (text) series.description = text.substring(0, 300);
            }
            
            // Extract lastUpdated (Last air date) from WordPress API date field
            // HentaiTV API provides full ISO date in ep.date
            if (ep.date) {
              const fullDate = parseDate(ep.date);
              if (fullDate) {
                series.lastUpdated = fullDate;
                // Also extract year
                const yearFromDate = extractYear(fullDate);
                if (yearFromDate) {
                  series.year = yearFromDate;
                  series.releaseInfo = String(yearFromDate);
                }
                logger.debug(`[HentaiTV] Found lastUpdated ${fullDate} for ${series.name}`);
              }
            }
            
            // Extract poster from embedded featured media
            if (ep._embedded && ep._embedded['wp:featuredmedia'] && ep._embedded['wp:featuredmedia'][0]) {
              const media = ep._embedded['wp:featuredmedia'][0];
              if (media.source_url && !series.poster) {
                series.poster = media.source_url;
              }
            }
            
            // Store the real slug from API in registry
            if (ep.slug) {
              const episodeNum = this.parseEpisodeNumber(ep.slug);
              if (episodeNum) {
                slugRegistry.set('htv', series.id, episodeNum, ep.slug);
              }
            }
            
            enrichedCount++;
          } catch (e) {
            logger.debug(`[HentaiTV] Enrichment parse error for ${series.id}: ${e.message}`);
          }
        }
        
        logger.info(`[HentaiTV] Enriched ${enrichedCount}/${itemsToFetch.length} items with metadata${emptyResponses > 0 ? ` (${emptyResponses} empty API responses)` : ''}`);
      }
      
      // QUALITY GATE: Filter out series with inadequate metadata
      // HentaiTV items with promotional descriptions or no posters should be dropped
      const qualitySeries = seriesArray.filter(series => {
        // Must have basic fields
        if (!series.id || !series.name) {
          return false;
        }
        
        // Must have a poster (no placeholder TV icons in catalog)
        if (!series.poster || series.poster.includes('data:image')) {
          logger.debug(`[HentaiTV] No poster for "${series.name}" - dropping from catalog`);
          return false;
        }
        
        // Check if description is promotional/generic
        const desc = (series.description || '').toLowerCase();
        const isPromoDescription = 
          desc.includes('watch all') && desc.includes('episode') && desc.includes('hentaitv') ||
          desc.includes('stream the complete series') ||
          desc.includes('in hd quality on hentaitv') ||
          desc.match(/^.+?\s+-\s+watch\s+all\s+\d+\s+episode/i) ||
          !desc || desc.length < 20;
        
        if (isPromoDescription) {
          // Only drop if we also don't have good genres
          const hasGoodGenres = series.genres && 
                               Array.isArray(series.genres) && 
                               series.genres.length > 1 &&
                               !series.genres.every(g => ['Hentai', 'Anime', 'Adult Animation'].includes(g));
          
          if (!hasGoodGenres) {
            logger.debug(`[HentaiTV] Promotional description and no genres for "${series.name}" - dropping`);
            return false;
          }
        }
        
        return true;
      });
      
      const droppedCount = seriesArray.length - qualitySeries.length;
      if (droppedCount > 0) {
        logger.info(`[HentaiTV] Quality gate: ${droppedCount}/${seriesArray.length} series dropped (no poster or promotional desc)`);
      }
      
      return qualitySeries;
      
    } catch (error) {
      logger.error(`[HentaiTV] Search page catalog error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get catalog - uses WordPress API for fast access to episodes with full metadata
   * @param {number} page - Page number (1-indexed)
   * @param {string} genre - Optional genre filter (not supported by API, falls back to scraping)
   * @param {string} sortBy - Sort order: 'popular' uses search page with views, 'recent' uses API
   */
  async getCatalog(page = 1, genre = null, sortBy = 'popular') {
    try {
      // For "popular" sort, use search page which includes view counts
      if (sortBy === 'popular' && !genre) {
        return this.getCatalogFromSearchPage(page);
      }
      
      logger.info(`[HentaiTV] Fetching catalog page ${page} via WordPress API`);
      
      // Use WordPress API - gives us 20 episodes per page with full metadata
      // This is MUCH faster than scraping + individual API calls
      const perPage = 20;
      const apiUrl = `${this.apiUrl}/episodes?per_page=${perPage}&page=${page}&_embed`;
      
      const response = await this.client.get(apiUrl);
      const episodes = response.data;
      
      if (!episodes || episodes.length === 0) {
        logger.info(`[HentaiTV] No more episodes from API on page ${page}`);
        return [];
      }
      
      // Group episodes by series (remove "Episode X" suffix to get series name)
      const seriesMap = new Map();
      
      for (const ep of episodes) {
        // Parse title to extract series name
        const title = ep.title?.rendered || '';
        const seriesMatch = title.match(/^(.+?)\s+Episode\s+(\d+)$/i);
        
        if (!seriesMatch) continue;
        
        const seriesName = seriesMatch[1].trim();
        const episodeNum = parseInt(seriesMatch[2]);
        
        // Create slug from series name
        const slug = seriesName.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        if (!slug) continue;
        
        // Get poster from embedded media
        const poster = ep._embedded?.['wp:featuredmedia']?.[0]?.source_url || '';
        
        // Get description from content (strip HTML)
        const rawDesc = ep.content?.rendered || '';
        const description = rawDesc.replace(/<[^>]*>/g, '').trim();
        
        // Group by series - keep first episode's data and track the episode slug for metadata fetch
        // Parse date from WordPress API response
        const episodeDate = parseDate(ep.date) || null;
        const episodeYear = episodeDate ? extractYear(episodeDate) : null;
        
        if (!seriesMap.has(slug)) {
          // Truncate description at word boundary for catalog
          let catalogDesc = description;
          if (catalogDesc.length > 350) {
            catalogDesc = catalogDesc.substring(0, 350);
            const lastSpace = catalogDesc.lastIndexOf(' ');
            if (lastSpace > 200) catalogDesc = catalogDesc.substring(0, lastSpace);
            catalogDesc = catalogDesc.trim() + '...';
          }
          
          seriesMap.set(slug, {
            id: `${this.prefix}${slug}`,
            type: 'series',
            name: seriesName,
            poster: poster,
            description: catalogDesc || `Watch ${seriesName} in HD`,
            genres: null, // Will be fetched from episode page
            episodeCount: 1,
            latestEpisode: episodeNum,
            lowestEpisodeNum: episodeNum,
            // Always use episode 1 slug for consistent metadata (genres are same across all episodes)
            episode1Slug: `${slug}-episode-1`,
            // Date tracking for weekly/monthly releases
            lastUpdated: episodeDate,
            year: episodeYear
          });
        } else {
          const series = seriesMap.get(slug);
          series.episodeCount++;
          if (episodeNum > series.latestEpisode) {
            series.latestEpisode = episodeNum;
            // Update lastUpdated to the most recent episode's date
            if (episodeDate && (!series.lastUpdated || episodeDate > series.lastUpdated)) {
              series.lastUpdated = episodeDate;
            }
          }
          if (episodeNum < series.lowestEpisodeNum) {
            series.lowestEpisodeNum = episodeNum;
          }
          // Keep first poster if current is empty
          if (!series.poster && poster) {
            series.poster = poster;
          }
          // Update year if not set
          if (!series.year && episodeYear) {
            series.year = episodeYear;
          }
        }
      }
      
      // Fetch genres from episode pages in batches (like HentaiMama does)
      // This is efficient: 1 request per series gets both description AND genres
      // Always use episode 1 for consistent metadata across catalog and detail view
      const seriesArray = Array.from(seriesMap.values());
      const batchSize = 5; // Parallel batch size
      
      for (let i = 0; i < seriesArray.length; i += batchSize) {
        const batch = seriesArray.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (series) => {
          try {
            const pageData = await this.fetchEpisodePageMetadata(series.episode1Slug);
            
            if (pageData.genres && pageData.genres.length > 0) {
              series.genres = pageData.genres;
            }
            // Always prefer episode page description for consistency with detail view
            if (pageData.description) {
              series.description = pageData.description.substring(0, 300);
            }
            // Update poster if we got one
            if (pageData.poster && !series.poster) {
              series.poster = pageData.poster;
            }
            // Store view count for rating calculation
            if (pageData.viewCount !== null) {
              series.viewCount = pageData.viewCount;
            }
            // Store studio/brand
            if (pageData.studio) {
              series.studio = pageData.studio;
            }
          } catch (e) {
            logger.debug(`[HentaiTV] Failed to fetch page metadata for ${series.name}: ${e.message}`);
          }
        }));
      }
      
      // Convert to array with final data
      const results = seriesArray.map(series => ({
        id: series.id,
        type: 'series',
        name: series.name,
        poster: series.poster,
        description: series.description,
        genres: series.genres || ['Hentai', 'Anime', 'Adult Animation'], // Fallback if no genres found
        viewCount: series.viewCount || null, // For rating calculation
        ratingType: 'views', // Indicates this provider uses view-based ratings
        // Date fields for sorting catalogs
        lastUpdated: series.lastUpdated || null,
        year: series.year || null,
        releaseInfo: series.year ? String(series.year) : undefined
      }));
      
      // QUALITY GATE: Filter out items without proper metadata
      const qualityResults = results.filter(series => {
        // Must have poster
        if (!series.poster || series.poster.includes('data:image')) {
          return false;
        }
        // Check promotional description
        const desc = (series.description || '').toLowerCase();
        if (desc.includes('watch') && desc.includes('hentaitv') && desc.includes('in hd')) {
          return false;
        }
        return true;
      });
      
      logger.info(`[HentaiTV] Found ${qualityResults.length} unique series on page ${page} (from ${episodes.length} episodes, ${results.length - qualityResults.length} filtered)`);
      return qualityResults;
      
    } catch (error) {
      logger.error(`[HentaiTV] Catalog error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get catalog by genre - fetches from dedicated genre pages
   * @param {string} genre - Genre slug (e.g., "3d", "big-boobs", "adventure")
   * @param {number} page - Page number (1-indexed)
   * @returns {Promise<Array>} Array of series items with matching genre
   */
  async getCatalogByGenre(genre, page = 1) {
    try {
      // Convert genre to URL-friendly slug
      const genreSlug = genre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const url = `${this.baseUrl}/genre/${genreSlug}/page/${page}/`;
      logger.info(`[HentaiTV] Fetching genre ${genre} page ${page}: ${url}`);
      
      const response = await this.client.get(url, {
        timeout: 10000,
        headers: {
          ...this.client.defaults.headers,
          'Cookie': 'inter=1'
        },
        validateStatus: status => status < 400
      });
      
      const $ = cheerio.load(response.data);
      const items = [];
      const seriesSeen = new Set();
      
      // Convert genre slug to display name (e.g., "3d" -> "3D", "big-boobs" -> "Big Boobs")
      const genreDisplayName = genreSlug
        .split('-')
        .map(word => word.toUpperCase() === word.toLowerCase() ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      // HentaiTV genre pages use links to /hentai/ paths
      // The structure is: <a href="https://hentai.tv/hentai/series-episode-X/">Title</a>
      $('a[href*="/hentai/"]').each((i, el) => {
        try {
          const $el = $(el);
          const link = $el.attr('href');
          const title = $el.text().trim();
          
          if (!link || !title || title.length < 3) return;
          
          // Skip navigation/footer links
          if (title.toLowerCase() === 'hentai' || title.toLowerCase() === 'home') return;
          
          // Extract series name (remove "Episode X" suffix)
          const seriesMatch = title.match(/^(.+?)\s+Episode\s+(\d+)$/i);
          const seriesName = seriesMatch ? seriesMatch[1].trim() : title;
          
          // Create series slug
          const slug = seriesName.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          
          if (!slug || slug.length < 2 || seriesSeen.has(slug)) return;
          seriesSeen.add(slug);
          
          // Try to get poster from sibling/parent img element
          let poster = '';
          const $parent = $el.closest('div');
          if ($parent.length) {
            poster = $parent.find('img').first().attr('src') ||
                     $parent.find('img').first().attr('data-src') || '';
          }
          if (!poster) {
            // Try looking in preceding siblings
            poster = $el.parent().prev().find('img').attr('src') ||
                     $el.parent().parent().find('img').first().attr('src') || '';
          }
          
          items.push({
            id: `${this.prefix}${slug}`,
            type: 'series',
            name: seriesName,
            poster: poster,
            description: `Watch ${seriesName} in HD`,
            genres: [genreDisplayName], // Include the genre we're filtering by
            lastUpdated: null,
            year: null
          });
        } catch (e) {
          logger.debug(`[HentaiTV] Error parsing genre item: ${e.message}`);
        }
      });
      
      logger.info(`[HentaiTV] Found ${items.length} series on genre ${genre} page ${page}`);
      return items;
      
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`[HentaiTV] Genre page not found: ${genre} (404)`);
        return [];
      }
      logger.error(`[HentaiTV] Genre catalog error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get catalog items filtered by release year
   * HentaiTV doesn't have year filter pages - return null to signal fallback to local filtering
   * @param {number|string} year - Year to filter by
   * @param {number} page - Page number (1-indexed)
   * @returns {Promise<Array|null>} null to indicate no direct year fetching
   */
  async getCatalogByYear(year, page = 1) {
    // HentaiTV doesn't have dedicated year pages
    // Return null to signal the catalog handler to use local filtering instead
    logger.info(`[HentaiTV] No year pages available, will use local filtering for year ${year}`);
    return null;
  }

  /**
   * Get catalog items filtered by brand/studio
   * HentaiTV uses /brand/studio-name/ URL pattern
   * @param {string} studio - Studio name (will be converted to slug)
   * @param {number} page - Page number (1-indexed)
   * @returns {Promise<Array>} Array of series items
   */
  async getCatalogByStudio(studio, page = 1) {
    try {
      // Convert studio name to URL slug
      const studioSlug = studio.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const url = `${this.baseUrl}/brand/${studioSlug}/page/${page}/`;
      logger.info(`[HentaiTV] Fetching studio ${studio} page ${page}: ${url}`);
      
      const response = await this.client.get(url, {
        timeout: 10000,
        headers: {
          ...this.client.defaults.headers,
          'Cookie': 'inter=1'
        },
        validateStatus: status => status < 400
      });
      
      const $ = cheerio.load(response.data);
      return this._parseYearStudioPage($, null, studio);
    } catch (error) {
      logger.error(`[HentaiTV] Studio catalog error: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse HentaiTV year/studio page HTML
   */
  _parseYearStudioPage($, year = null, studio = null) {
    const items = [];
    const seriesSeen = new Set();
    
    // HentaiTV shows episodes, we need to extract series
    $('article, .video-item, .hentry').each((i, el) => {
      try {
        const $item = $(el);
        const $link = $item.find('a').first();
        const href = $link.attr('href') || '';
        
        // Extract episode slug from /hentai/slug/
        const slugMatch = href.match(/\/hentai\/([^\/]+)/);
        if (!slugMatch) return;
        
        const epSlug = slugMatch[1];
        // Extract series name from episode slug (remove -episode-X)
        const seriesSlug = epSlug.replace(/-episode-\d+$/i, '');
        
        if (seriesSeen.has(seriesSlug)) return;
        seriesSeen.add(seriesSlug);
        
        const title = $item.find('h2, h3, .entry-title').text().trim() ||
                     $item.find('img').attr('alt') || '';
        // Clean up title - remove "Episode X" suffix
        const seriesTitle = title.replace(/\s+Episode\s+\d+$/i, '').trim();
        
        const poster = $item.find('img').attr('data-src') ||
                      $item.find('img').attr('src') || '';
        
        const item = {
          id: `${this.prefix}${seriesSlug}`,
          type: 'series',
          name: seriesTitle,
          poster: poster,
          year: year ? parseInt(year) : null,
          studio: studio || null,
          releaseInfo: year ? String(year) : undefined
        };
        
        if (item.name && item.poster) {
          items.push(item);
        }
      } catch (err) {
        logger.debug(`[HentaiTV] Error parsing year/studio item: ${err.message}`);
      }
    });
    
    logger.info(`[HentaiTV] Found ${items.length} series from year/studio page`);
    return items;
  }

  /**
   * Search for series - uses WordPress API for speed and full metadata
   */
  async search(query) {
    try {
      logger.info(`[HentaiTV] Searching for: "${query}" via WordPress API`);
      
      // Use WordPress API search
      const apiUrl = `${this.apiUrl}/episodes?search=${encodeURIComponent(query)}&per_page=20&_embed`;
      const response = await this.client.get(apiUrl);
      const episodes = response.data;
      
      if (!episodes || episodes.length === 0) {
        logger.info(`[HentaiTV] No search results for "${query}"`);
        return [];
      }
      
      // Group episodes by series
      const seriesMap = new Map();
      
      for (const ep of episodes) {
        const title = ep.title?.rendered || '';
        const seriesMatch = title.match(/^(.+?)\s+Episode\s+(\d+)$/i);
        
        if (!seriesMatch) continue;
        
        const seriesName = seriesMatch[1].trim();
        const slug = seriesName.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        if (!slug || seriesMap.has(slug)) continue;
        
        const poster = ep._embedded?.['wp:featuredmedia']?.[0]?.source_url || '';
        const rawDesc = ep.content?.rendered || '';
        const description = rawDesc.replace(/<[^>]*>/g, '').trim();
        
        // Truncate description at word boundary for catalog
        let desc = description;
        if (desc.length > 350) {
          desc = desc.substring(0, 350);
          const lastSpace = desc.lastIndexOf(' ');
          if (lastSpace > 200) desc = desc.substring(0, lastSpace);
          desc = desc.trim() + '...';
        }
        
        seriesMap.set(slug, {
          id: `${this.prefix}${slug}`,
          type: 'series',
          name: seriesName,
          poster: poster,
          description: desc || `Watch ${seriesName} in HD`,
          genres: ['Hentai', 'Anime', 'Adult Animation']
        });
      }
      
      const results = Array.from(seriesMap.values());
      logger.info(`[HentaiTV] Search found ${results.length} results`);
      return results;
      
    } catch (error) {
      logger.error(`[HentaiTV] Search error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get metadata for a series
   * Uses WordPress API for descriptions and checks genre pages for genres
   * @param {string} seriesId - Series ID with prefix
   */
  async getMetadata(seriesId) {
    try {
      const slug = seriesId.replace(this.prefix, '');
      logger.info(`[HentaiTV] Fetching metadata for: ${slug}`);
      
      // Search for episodes of this series
      const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(slug.replace(/-/g, ' '))}`;
      const response = await this.client.get(searchUrl);
      const $ = cheerio.load(response.data);
      
      let seriesName = '';
      let poster = '';
      const episodes = [];
      const episodeSet = new Set();
      
      $('figure img').each((i, el) => {
        const $img = $(el);
        const src = $img.attr('src') || '';
        const alt = $img.attr('alt') || '';
        
        if (!src.includes('/uploads/') || !alt) return;
        
        const match = alt.match(/^(.+?)\s+Episode\s+(\d+)$/i);
        if (!match) return;
        
        const name = match[1].trim();
        const epNum = parseInt(match[2]);
        
        // Create slug to match
        const itemSlug = name.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        // Check if this matches our series
        if (itemSlug !== slug) return;
        
        // Capture series name and poster
        if (!seriesName) seriesName = name;
        if (!poster) poster = src;
        
        // Add episode if not already added
        if (!episodeSet.has(epNum)) {
          episodeSet.add(epNum);
          
          // Create episode slug for streaming
          const epSlug = `${slug}-episode-${epNum}`;
          
          episodes.push({
            id: `${this.prefix}${epSlug}`,
            slug: epSlug,
            number: epNum,
            title: `Episode ${epNum}`,
            poster: src
          });
        }
      });
      
      // Sort episodes by number
      episodes.sort((a, b) => a.number - b.number);
      
      // If no episodes found, create episode 1
      if (episodes.length === 0) {
        episodes.push({
          id: `${this.prefix}${slug}-episode-1`,
          slug: `${slug}-episode-1`,
          number: 1,
          title: 'Episode 1',
          poster: poster
        });
      }
      
      // Use episode 1's poster as the main series poster
      const seriesPoster = episodes[0]?.poster || poster;
      
      // Generate a proper title from the slug
      const displayName = seriesName || slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .replace(/\bOva\b/gi, 'OVA')
        .replace(/\bOna\b/gi, 'ONA');
      
      // Try to get description and genres from episode page (single request gets both!)
      let description = null;
      let genres = ['Hentai', 'Anime', 'Adult Animation']; // Default genres
      let studio = null;
      let seriesYear = null;  // Actual release year (not upload year)
      
      // Fetch episode 1 page - gets BOTH description AND genres in one request
      const firstEpisodeSlug = episodes[0]?.slug;
      if (firstEpisodeSlug) {
        logger.debug(`[HentaiTV] Fetching episode page metadata for ${firstEpisodeSlug}`);
        
        const pageData = await this.fetchEpisodePageMetadata(firstEpisodeSlug);
        
        // Use page description if available
        if (pageData?.description) {
          description = pageData.description;
          logger.info(`[HentaiTV] Got description from page: ${description.substring(0, 50)}...`);
        }
        
        // Use page poster if available and better quality
        if (pageData?.poster && !seriesPoster) {
          episodes[0].poster = pageData.poster;
        }
        
        // Use page genres if found
        if (pageData?.genres && pageData.genres.length > 0) {
          genres = pageData.genres;
          logger.info(`[HentaiTV] Got genres from page: ${genres.join(', ')}`);
        }
        
        // Use page studio if found
        if (pageData?.studio) {
          studio = pageData.studio;
          logger.info(`[HentaiTV] Got studio from page: ${studio}`);
        }
        
        // Use ACTUAL Release Date year from page (not upload date!)
        if (pageData?.releaseYear) {
          seriesYear = pageData.releaseYear;
          logger.info(`[HentaiTV] Got actual release year from page: ${seriesYear}`);
        }
        
        // Set episode released date from actual Release Date
        if (pageData?.releaseDate && episodes.length > 0) {
          episodes[0].released = new Date(pageData.releaseDate).toISOString();
          logger.debug(`[HentaiTV] Episode 1 actual release: ${episodes[0].released}`);
        }
      }
      
      // Generate fallback description if API didn't provide one
      if (!description) {
        description = `${displayName} - Watch all ${episodes.length} episode${episodes.length > 1 ? 's' : ''} in HD quality on HentaiTV. Stream the complete series online for free.`;
      }
      
      // ===== FETCH EPISODE DATES FROM WORDPRESS API =====
      // The WordPress API returns dates for each episode
      let seriesLastUpdated = null;
      
      try {
        // Fetch dates for first 5 episodes to determine series lastUpdated
        const episodeSlugsToFetch = episodes.slice(0, 5).map(ep => ep.slug);
        logger.info(`[HentaiTV] Fetching dates for ${episodeSlugsToFetch.length} episodes via API...`);
        
        for (const epSlug of episodeSlugsToFetch) {
          try {
            const apiUrl = `${this.apiUrl}/episodes?slug=${epSlug}`;
            const apiResp = await this.client.get(apiUrl, { timeout: 5000 });
            
            if (apiResp.data && apiResp.data.length > 0) {
              const epData = apiResp.data[0];
              const epDate = epData.date; // WordPress date format: "2023-09-22T18:39:13"
              
              if (epDate) {
                // Find matching episode and set released date
                const matchingEp = episodes.find(e => e.slug === epSlug);
                if (matchingEp) {
                  matchingEp.released = new Date(epDate).toISOString();
                  logger.debug(`[HentaiTV] Episode ${matchingEp.number} date: ${matchingEp.released}`);
                  
                  // Track latest episode date
                  const dateObj = new Date(epDate);
                  if (!seriesLastUpdated || dateObj > seriesLastUpdated) {
                    seriesLastUpdated = dateObj;
                  }
                }
              }
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (err) {
            logger.debug(`[HentaiTV] Could not fetch date for episode ${epSlug}: ${err.message}`);
          }
        }
        
        if (seriesLastUpdated) {
          logger.info(`[HentaiTV] Series lastUpdated from episodes: ${seriesLastUpdated.toISOString()}`);
        }
      } catch (err) {
        logger.debug(`[HentaiTV] Episode date fetching failed: ${err.message}`);
      }
      
      logger.info(`[HentaiTV] Found ${episodes.length} episodes for ${displayName}${studio ? `, studio: ${studio}` : ''}${seriesYear ? `, year: ${seriesYear}` : ''}`);
      
      return {
        id: seriesId,
        type: 'series',
        name: displayName,
        poster: episodes[0]?.poster || seriesPoster,
        background: episodes[0]?.poster || seriesPoster,
        description: description,
        genres: genres,
        studio: studio,
        year: seriesYear,  // Actual release year (not upload year)
        releaseInfo: seriesYear ? String(seriesYear) : (episodes.length > 1 ? `${episodes.length} Episodes` : undefined),
        lastUpdated: seriesLastUpdated ? seriesLastUpdated.toISOString() : undefined,
        episodes: episodes
      };
      
    } catch (error) {
      logger.error(`[HentaiTV] Metadata error: ${error.message}`);
      return null;
    }
  }

  /**
   * Find the real episode slug using registry or WordPress API
   * This is the key optimization - instead of trying 4 variations, we look up or query the exact slug
   * @param {string} seriesSlug - Normalized series slug (without episode)
   * @param {number|string} episodeNum - Episode number
   * @returns {Promise<string|null>} Real slug if found, null otherwise
   */
  async findRealSlug(seriesSlug, episodeNum) {
    // Clean the series slug
    const cleanSlug = seriesSlug
      .replace(/^htv-/, '')
      .replace(/-episode-\d+$/, '')
      .replace(/-the-animation$/, '');
    
    // Step 1: Check the slug registry (instant O(1) lookup)
    const cachedSlug = slugRegistry.get('htv', cleanSlug, episodeNum);
    if (cachedSlug) {
      logger.info(`[HentaiTV] Slug registry HIT: ${cleanSlug}:${episodeNum} -> ${cachedSlug}`);
      return cachedSlug;
    }
    
    // Step 2: Query WordPress API to find the exact slug
    logger.info(`[HentaiTV] Slug registry MISS, querying WordPress API for: ${cleanSlug}`);
    try {
      const searchTerm = cleanSlug.replace(/-/g, ' ');
      const apiUrl = `${this.apiUrl}/episodes?search=${encodeURIComponent(searchTerm)}&per_page=30`;
      
      const response = await this.client.get(apiUrl, { timeout: 8000 });
      const episodes = response.data;
      
      if (!episodes || episodes.length === 0) {
        logger.debug(`[HentaiTV] No API results for: ${searchTerm}`);
        return null;
      }
      
      // Find the episode with matching number
      // Title format: "Series Name Episode X" or "Series Name Episodio X"
      for (const ep of episodes) {
        const title = ep.title?.rendered || '';
        const match = title.match(/^(.+?)\s+Episod[eo]\s+(\d+)$/i);
        
        if (match) {
          const epNum = parseInt(match[2]);
          const realSlug = ep.slug;
          
          // Store ALL discovered slugs in registry for future use
          const epSeriesName = match[1].trim().toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-');
          slugRegistry.set('htv', epSeriesName, epNum, realSlug);
          
          // Check if this is the episode we're looking for
          if (epNum === parseInt(episodeNum)) {
            // Verify this matches our series (fuzzy match)
            if (epSeriesName.includes(cleanSlug) || cleanSlug.includes(epSeriesName)) {
              logger.info(`[HentaiTV] WordPress API found: ${realSlug}`);
              return realSlug;
            }
          }
        }
      }
      
      logger.debug(`[HentaiTV] Episode ${episodeNum} not found in API results`);
      return null;
      
    } catch (error) {
      logger.debug(`[HentaiTV] WordPress API query failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get streams for an episode
   * OPTIMIZED: Uses slug registry and WordPress API instead of guessing
   * @param {string} episodeId - Episode ID with prefix (e.g., "htv-series-name-episode-1" or just the slug)
   */
  async getStreams(episodeId) {
    try {
      let slug = episodeId.replace(this.prefix, '');
      logger.info(`[HentaiTV] Fetching streams for: ${slug}`);
      
      // Parse episode number from the slug
      const episodeMatch = slug.match(/-episode-(\d+)$/) || slug.match(/-(\d+)$/);
      const episodeNum = episodeMatch ? parseInt(episodeMatch[1]) : 1;
      const baseSlug = slug.replace(/-episode-\d+$/, '').replace(/-\d+$/, '');
      
      // Try to find the real slug via registry or API
      const realSlug = await this.findRealSlug(baseSlug, episodeNum);
      if (realSlug && realSlug !== slug) {
        logger.info(`[HentaiTV] Using real slug: ${realSlug} (instead of ${slug})`);
        slug = realSlug;
      }
      
      // Build the episode URL - HentaiTV uses /hentai/series-episode-X/
      const episodeUrl = `${this.baseUrl}/hentai/${slug}/`;
      
      // Attempt to fetch the page
      // Note: This will likely redirect to interstitial
      const response = await this.client.get(episodeUrl, {
        maxRedirects: 5,
        validateStatus: status => status < 400
      });
      
      const $ = cheerio.load(response.data);
      const html = response.data;
      const streams = [];
      
      // Check if we got the actual episode page (not interstitial)
      const title = $('title').text().toLowerCase();
      const isInterstitial = title.includes('lnter') || title.includes('inter');
      
      if (isInterstitial) {
        logger.warn(`[HentaiTV] Hit interstitial page for ${slug}`);
        
        // Strategy 1: Try to construct the r2.1hanime.com video URL directly
        // Try multiple URL variations
        const videoSlugVariations = this.generateVideoSlugVariations(slug);
        
        for (const videoSlug of videoSlugVariations) {
          const videoUrl = `https://r2.1hanime.com/${videoSlug}.mp4`;
          logger.info(`[HentaiTV] Trying direct URL: ${videoUrl}`);
          
          try {
            // Verify the URL exists
            const headResponse = await this.client.head(videoUrl, {
              headers: { 'Referer': 'https://nhplayer.com/' },
              timeout: 5000
            });
            
            if (headResponse.status === 200) {
              streams.push({
                url: videoUrl,
                title: 'HentaiTV MP4',
                name: this.name
              });
              logger.info(`[HentaiTV] Direct URL works!`);
              break; // Found a working URL, stop trying variations
            }
          } catch (urlError) {
            logger.debug(`[HentaiTV] Direct URL failed: ${urlError.message}`);
          }
        }
        
        // Strategy 2: Try to find nhplayer iframe in page anyway
        if (streams.length === 0) {
          const nhplayerMatch = html.match(/nhplayer\.com\/v\/([a-zA-Z0-9]+)/);
          if (nhplayerMatch) {
            const nhplayerId = nhplayerMatch[1];
            logger.info(`[HentaiTV] Found nhplayer ID: ${nhplayerId}`);
            
            // Fetch nhplayer page to get video URL
            try {
              const nhResponse = await this.client.get(`https://nhplayer.com/v/${nhplayerId}/`, {
                headers: { 'Referer': this.baseUrl }
              });
              
              // Extract base64 encoded video URL from data-id attribute
              const dataIdMatch = nhResponse.data.match(/data-id=["']([^"']+)/);
              if (dataIdMatch) {
                const dataId = dataIdMatch[1];
                const urlMatch = dataId.match(/u=([^&]+)/);
                if (urlMatch) {
                  const videoUrl = Buffer.from(urlMatch[1], 'base64').toString();
                  if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
                    streams.push({
                      url: videoUrl,
                      title: `HentaiTV ${videoUrl.includes('.m3u8') ? 'HLS' : 'MP4'}`,
                      name: this.name
                    });
                    logger.info(`[HentaiTV] Extracted video URL: ${videoUrl}`);
                  }
                }
              }
            } catch (nhError) {
              logger.warn(`[HentaiTV] Could not fetch nhplayer: ${nhError.message}`);
            }
          }
        }
        
        // If still no streams, log warning
        if (streams.length === 0) {
          logger.warn(`[HentaiTV] Could not get streams for ${slug}`);
        }
      } else {
        // We got the actual page - look for video sources
        logger.info(`[HentaiTV] Got actual episode page`);
        
        // Check for nhplayer iframe
        $('iframe').each((i, el) => {
          const src = $(el).attr('src') || '';
          
          // nhplayer iframe
          if (src.includes('nhplayer.com')) {
            const idMatch = src.match(/nhplayer\.com\/v\/([a-zA-Z0-9]+)/);
            if (idMatch) {
              logger.info(`[HentaiTV] Found nhplayer iframe: ${idMatch[1]}`);
              // Would need to fetch this iframe's content
            }
          }
          
          // Check for encoded source URL in iframe
          if (src.includes('source=')) {
            const sourceMatch = src.match(/source=([^&]+)/);
            if (sourceMatch) {
              try {
                const videoUrl = decodeURIComponent(sourceMatch[1]);
                if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
                  streams.push({
                    url: videoUrl,
                    title: `HentaiTV ${videoUrl.includes('.m3u8') ? 'HLS' : 'MP4'}`,
                    name: this.name
                  });
                }
              } catch (e) {}
            }
          }
        });
        
        // Direct video sources
        $('source[src*=".mp4"], video source').each((i, el) => {
          const src = $(el).attr('src');
          if (src) {
            streams.push({
              url: src.startsWith('http') ? src : `${this.baseUrl}${src}`,
              title: 'HentaiTV MP4',
              name: this.name
            });
          }
        });
        
        // Look for video URL patterns in scripts
        const videoPatterns = [
          /file["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/gi,
          /source["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/gi,
          /["'](https?:\/\/[^"']*\.mp4[^"']*)/gi
        ];
        
        for (const pattern of videoPatterns) {
          let match;
          while ((match = pattern.exec(html)) !== null) {
            const url = match[1];
            if (!streams.some(s => s.url === url)) {
              streams.push({
                url: url,
                title: 'HentaiTV MP4',
                name: this.name
              });
            }
          }
        }
      }
      
      logger.info(`[HentaiTV] Found ${streams.length} streams`);
      return streams;
      
    } catch (error) {
      logger.error(`[HentaiTV] Stream error: ${error.message}`);
      return [];
    }
  }
}

// Export singleton instance
module.exports = new HentaiTVScraper();
