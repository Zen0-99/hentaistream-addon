const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const malClient = require('../utils/mal');

class HentaiMamaScraper {
  constructor() {
    this.baseUrl = 'https://hentaimama.io';
    this.searchUrl = `${this.baseUrl}/episodes`;
    this.genresCache = null;
    this.genresCacheTime = null;
    this.enableMAL = true; // Feature flag for MAL integration
  }

  /**
   * Get list of available genres from HentaiMama
   */
  async getGenres() {
    // Cache genres for 24 hours
    if (this.genresCache && this.genresCacheTime && (Date.now() - this.genresCacheTime < 24 * 60 * 60 * 1000)) {
      return this.genresCache;
    }

    try {
      logger.info('Fetching HentaiMama genres');
      const response = await axios.get(`${this.baseUrl}/genres-filter/`);
      const $ = cheerio.load(response.data);
      
      const genres = [];
      $('.genres a, .genre-list a, a[href*="/genre/"]').each((i, elem) => {
        const $elem = $(elem);
        const name = $elem.text().trim();
        const href = $elem.attr('href');
        
        if (name && href && name.length > 2 && name.length < 30) {
          // Extract genre slug from URL
          const match = href.match(/\/genre\/([^\/]+)/);
          if (match) {
            genres.push({ name, slug: match[1] });
          }
        }
      });
      
      // Deduplicate
      const uniqueGenres = Array.from(
        new Map(genres.map(g => [g.slug, g])).values()
      );
      
      this.genresCache = uniqueGenres;
      this.genresCacheTime = Date.now();
      
      logger.info(`Found ${uniqueGenres.length} genres`);
      return uniqueGenres;
    } catch (error) {
      logger.error('Error fetching genres:', error.message);
      return [];
    }
  }

  /**
   * Get catalog by genre
   * @param {string} genre - Genre slug
   * @param {number} page - Page number (1-indexed)
   */
  async getCatalogByGenre(genre, page = 1) {
    return this.getCatalog(page, genre);
  }

  /**
   * Hybrid search: tag-based, keyword, and title search
   * @param {string} query - Search query
   * @returns {Array} - Array of series matching the query
   */
  async search(query) {
    try {
      const normalizedQuery = query.toLowerCase().trim();
      logger.info(`Searching HentaiMama for: "${query}"`);

      // Strategy 1: Tag/Genre search
      // Check if query matches any genre (case-insensitive)
      const genres = await this.getGenres();
      const matchingGenre = genres.find(g => 
        g.name.toLowerCase() === normalizedQuery ||
        g.slug.toLowerCase() === normalizedQuery
      );

      if (matchingGenre) {
        logger.info(`Tag search: "${query}" matched genre "${matchingGenre.name}"`);
        // Return genre catalog (1 page = 20 items)
        return await this.getCatalogByGenre(matchingGenre.slug, 1);
      }

      // Strategy 2: Keyword search for "Hentai" or "Anime Porn"
      // Only match if query is EXACTLY one of these keywords (not just contains)
      const exactKeywords = ['hentai', 'anime porn', 'anime', 'ecchi', 'porn'];
      if (exactKeywords.includes(normalizedQuery)) {
        logger.info(`Keyword search: "${query}" matched keyword, returning main catalog`);
        // Return main catalog (1 page = 20 items, sorted by popular)
        const catalog = await this.getCatalog(1, null, 'popular');
        return catalog.slice(0, 20); // Limit to exactly 20 results
      }

      // Strategy 3: Title search
      // Fetch multiple pages to ensure we find matches
      logger.info(`Title search: filtering catalog for "${query}"`);
      
      // Fetch first 3 pages (60 series total) for better search coverage
      const catalogPromises = [
        this.getCatalog(1, null, 'popular'),
        this.getCatalog(2, null, 'popular'),
        this.getCatalog(3, null, 'popular')
      ];
      
      const catalogPages = await Promise.all(catalogPromises);
      const allSeries = catalogPages.flat();
      
      // Deduplicate by ID
      const uniqueSeries = Array.from(
        new Map(allSeries.map(s => [s.id, s])).values()
      );
      
      logger.info(`Searching across ${uniqueSeries.length} series`);
      
      // Log first few series names for debugging
      logger.info(`Sample series names: ${uniqueSeries.slice(0, 5).map(s => s.name).join(', ')}`);
      
      // Split query into words for flexible matching (minimum 2 chars)
      const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length >= 2);
      logger.info(`Search query: "${normalizedQuery}", words: [${queryWords.join(', ')}]`);
      
      const results = uniqueSeries.filter(series => {
        const seriesName = series.name.toLowerCase();
        const seriesId = series.id.toLowerCase();
        
        // Also check genres (series.genres is an array)
        const seriesGenres = (series.genres || []).map(g => g.toLowerCase()).join(' ');
        
        // Check English title (ghost field for search)
        const englishTitle = (series.englishTitle || '').toLowerCase();
        
        // Log each series being checked (only first 3 for debugging)
        if (uniqueSeries.indexOf(series) < 3) {
          logger.info(`Checking series: "${series.name}" (id: ${series.id})`);
          logger.info(`  - englishTitle: "${series.englishTitle || 'none'}"`);
          logger.info(`  - genres: [${series.genres ? series.genres.join(', ') : 'none'}]`);
          logger.info(`  - seriesName.includes("${normalizedQuery}"): ${seriesName.includes(normalizedQuery)}`);
          logger.info(`  - englishTitle.includes("${normalizedQuery}"): ${englishTitle.includes(normalizedQuery)}`);
          logger.info(`  - seriesId.includes("${normalizedQuery}"): ${seriesId.includes(normalizedQuery)}`);
          logger.info(`  - seriesGenres.includes("${normalizedQuery}"): ${seriesGenres.includes(normalizedQuery)}`);
        }
        
        // Match if ANY query word is in series name, English title, ID, OR GENRES
        // OR if the full query is in any of those fields
        const matches = seriesName.includes(normalizedQuery) || 
               englishTitle.includes(normalizedQuery) ||
               seriesId.includes(normalizedQuery) ||
               seriesGenres.includes(normalizedQuery) ||
               queryWords.some(word => 
                 seriesName.includes(word) || 
                 englishTitle.includes(word) ||
                 seriesId.includes(word) || 
                 seriesGenres.includes(word)
               );
        
        if (matches) {
          logger.info(`✓ MATCH: "${series.name}" (matched in: ${
            seriesName.includes(normalizedQuery) || queryWords.some(w => seriesName.includes(w)) ? 'name ' : ''
          }${englishTitle.includes(normalizedQuery) || queryWords.some(w => englishTitle.includes(w)) ? 'englishTitle ' : ''
          }${seriesId.includes(normalizedQuery) || queryWords.some(w => seriesId.includes(w)) ? 'id ' : ''
          }${seriesGenres.includes(normalizedQuery) || queryWords.some(w => seriesGenres.includes(w)) ? 'genres' : ''})`);
        }
        
        return matches;
      });

      logger.info(`Title search found ${results.length} matches for "${query}"`);
      
      // Return max 20 results (1 page worth)
      return results.slice(0, 20);

    } catch (error) {
      logger.error(`Error searching HentaiMama for "${query}":`, error.message);
      return [];
    }
  }

  /**
   * Get catalog/recent episodes
   * @param {number} page - Page number (1-indexed)
   * @param {string} genre - Optional genre filter (slug)
   * @param {string} sortBy - Sort order: 'popular' (default) or 'recent'
   */
  async getCatalog(page = 1, genre = null, sortBy = 'popular') {
    try {
      const genreParam = genre ? ` (genre: ${genre})` : '';
      const sortParam = sortBy ? ` (sort: ${sortBy})` : '';
      logger.info(`Fetching HentaiMama catalog page ${page}${genreParam}${sortParam}`);
      
      // Determine base URL based on genre and sort
      let baseUrl;
      
      if (genre) {
        baseUrl = `${this.baseUrl}/genre/${genre}`;
      } else if (sortBy === 'popular') {
        baseUrl = `${this.baseUrl}/hentai-series`; // Use hentai-series for all-time top rated
      } else {
        baseUrl = this.searchUrl; // Recent episodes (by date)
      }
      
      // HentaiMama uses WordPress-style pagination: /page/2/, /page/3/, etc.
      // Page 1 has no /page/1/ suffix
      const url = page === 1 ? `${baseUrl}/` : `${baseUrl}/page/${page}/`;
      
      // Add filter parameter for popular sort
      const params = sortBy === 'popular' ? { filter: 'rating' } : {};
      
      const fullUrl = params.filter ? `${url}?filter=${params.filter}` : url;
      logger.info(`→ Fetching URL: ${fullUrl}`);
      
      const response = await axios.get(url, { params });

      const $ = cheerio.load(response.data);
      let episodes = []; // Changed to let for reassignment

      // Find episode cards - try multiple selectors
      const selectors = [
        '.episode-card',
        'article.post',
        '.post',
        'article',
        '.video-item',
        '.entry'
      ];

      let $elements = $();
      for (const selector of selectors) {
        $elements = $(selector);
        if ($elements.length > 0) {
          logger.info(`Found ${$elements.length} elements with selector: ${selector}`);
          break;
        }
      }

      const seriesMap = new Map(); // Group episodes by series

      $elements.each((i, elem) => {
        const $elem = $(elem);
        
        // Find the link - genre pages have tvshows links, episode pages have episodes links
        let link = $elem.find('a[href*="tvshows"], a[href*="episodes"]').first();
        if (!link.length) link = $elem.find('a').first();
        
        const url = link.attr('href');
        if (!url) return;
        
        // Determine if this is a series page or episode page
        const isSeriesPage = url.includes('/tvshows/');
        const isEpisodePage = url.includes('/episodes/');
        
        if (!isSeriesPage && !isEpisodePage) return;

        // Extract title from link text
        let title = link.text();
        
        // Remove "Episode X" pattern and extra whitespace
        title = title.replace(/Episode\s+\d+/gi, '').trim();
        title = title.replace(/\s+/g, ' ').trim();
        
        // If still empty, try other sources
        if (!title || title.length < 2) {
          title = link.attr('title') || 
                 $elem.find('h2, h3').first().text().trim() ||
                 'Unknown';
        }

        // Extract poster/thumbnail - try multiple sources
        let poster = $elem.find('img').first().attr('data-src') ||
                    $elem.find('img').first().attr('src') ||
                    $elem.find('img').first().attr('data-lazy-src') ||
                    link.find('img').attr('data-src') ||
                    link.find('img').attr('src') ||
                    '';

        // Filter out placeholder images
        if (poster && (poster.includes('data:image') || poster.includes('placeholder') || poster.length < 20)) {
          poster = '';
        }

        // Make sure poster is absolute URL
        if (poster && !poster.startsWith('http')) {
          poster = poster.startsWith('//') ? `https:${poster}` : `${this.baseUrl}${poster}`;
        }

        let seriesSlug, episodeSlug, episodeNumber;
        
        if (isSeriesPage) {
          // Extract series slug from tvshows URL
          const match = url.match(/tvshows\/([\w-]+)/);
          if (!match) return;
          seriesSlug = match[1];
          episodeSlug = null; // We don't have episode info yet
          episodeNumber = 1; // Default
        } else {
          // Extract episode slug from episodes URL
          const match = url.match(/episodes\/([\w-]+)/);
          if (!match || !title) return;
          episodeSlug = match[1];
          // Extract series slug by removing episode number suffix
          seriesSlug = episodeSlug.replace(/-episode-\d+$/, '');
          
          // Extract episode number
          const epMatch = episodeSlug.match(/-episode-(\d+)$/);
          episodeNumber = epMatch ? parseInt(epMatch[1]) : 1;
        }
        
        // Extract genres from tags if visible
        const genres = [];
        $elem.find('.tag, .genre, a[rel="tag"]').each((i, tag) => {
          const genreText = $(tag).text().trim();
          if (genreText && genreText.length > 2 && genreText.length < 30) {
            genres.push(genreText);
          }
        });

        // Group by series
        if (!seriesMap.has(seriesSlug)) {
          // Create series entry
          seriesMap.set(seriesSlug, {
            id: `hmm-${seriesSlug}`,
            name: title,
            poster: poster || undefined,
            genres: genres.length > 0 ? genres : undefined,
            type: 'series',
            episodes: [],
            latestEpisode: episodeNumber,
            isSeriesPage: isSeriesPage // Track if we found this via series page
          });
        } else {
          // Update latest episode number
          const series = seriesMap.get(seriesSlug);
          if (episodeNumber > series.latestEpisode) {
            series.latestEpisode = episodeNumber;
          }
        }
        
        // Add episode to series (only if we have episode info)
        if (episodeSlug) {
          const series = seriesMap.get(seriesSlug);
          series.episodes.push({
            number: episodeNumber,
            slug: episodeSlug,
            url: url.startsWith('http') ? url : `${this.baseUrl}${url}`,
            poster: poster
          });
        }
      });

      // Sort episodes within each series
      for (const series of seriesMap.values()) {
        series.episodes.sort((a, b) => a.number - b.number);
      }
      
      const seriesArray = Array.from(seriesMap.entries()); // Keep as entries for enrichment
      
      // Fetch series metadata in controlled batches (5 at a time for optimal performance)
      const batchSize = 5;
      const enrichedResults = [];
      
      for (let i = 0; i < seriesArray.length; i += batchSize) {
        const batch = seriesArray.slice(i, i + batchSize);
        const batchPromises = batch.map(async ([slug, series]) => {
        try {
          const seriesPageUrl = `${this.baseUrl}/tvshows/${slug}/`;
          const seriesResponse = await axios.get(seriesPageUrl, {
            timeout: 2000, // Fail fast on 404s
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          
          const $series = cheerio.load(seriesResponse.data);
          
          // Extract proper series cover art
          let seriesCover = $series('.poster img, .sheader img').first().attr('data-src') ||
                           $series('.poster img, .sheader img').first().attr('src') ||
                           '';
          
          if (seriesCover && !seriesCover.startsWith('http')) {
            seriesCover = seriesCover.startsWith('//') 
              ? `https:${seriesCover}` 
              : `${this.baseUrl}${seriesCover}`;
          }
          
          // Only use it if it's NOT a video snapshot
          if (seriesCover && !seriesCover.includes('mp4_snapshot') && !seriesCover.includes('data:image')) {
            series.poster = seriesCover;
          }
          
          // Extract genres from series page
          const seriesGenres = [];
          $series('.sgeneros a, .genre a, a[rel="tag"]').each((i, tag) => {
            const genreText = $series(tag).text().trim();
            if (genreText && genreText.length > 2 && genreText.length < 30) {
              seriesGenres.push(genreText);
            }
          });
          
          if (seriesGenres.length > 0) {
            series.genres = seriesGenres;
          }
          
          // Extract description
          const seriesDesc = $series('.wp-content p, .description, .entry-content p').first().text().trim() ||
                            $series('meta[property="og:description"]').attr('content') ||
                            '';
          
          if (seriesDesc && seriesDesc.length > 10) {
            series.description = seriesDesc.replace(/Watch.*?HentaiMama/gi, '').trim().substring(0, 300);
          }
          
          // Extract episode-specific thumbnails from series page
          const episodeThumbnails = new Map();
          $series('article').each((i, epElem) => {
            const $ep = $series(epElem);
            const epLink = $ep.find('a[href*="episodes"]').attr('href');
            const epImg = $ep.find('img').first().attr('data-src') || $ep.find('img').first().attr('src');
            
            if (epLink && epImg) {
              const epSlugMatch = epLink.match(/episodes\/([\w-]+)/);
              if (epSlugMatch) {
                let cleanImg = epImg;
                if (cleanImg && !cleanImg.startsWith('http')) {
                  cleanImg = cleanImg.startsWith('//') ? `https:${cleanImg}` : `${this.baseUrl}${cleanImg}`;
                }
                if (cleanImg && !cleanImg.includes('data:image')) {
                  episodeThumbnails.set(epSlugMatch[1], cleanImg);
                }
              }
            }
          });
          
          // Update episode posters with individual thumbnails
          if (episodeThumbnails.size > 0) {
            series.episodes.forEach(ep => {
              if (episodeThumbnails.has(ep.slug)) {
                ep.poster = episodeThumbnails.get(ep.slug);
              }
            });
          }
          
            return { slug, success: true };
          } catch (err) {
            // Fallback: try to get metadata from first episode page
          try {
            const firstEp = series.episodes[0];
            if (firstEp && firstEp.slug) {
              const epUrl = `${this.baseUrl}/episodes/${firstEp.slug}`;
              const epResponse = await axios.get(epUrl, {
                timeout: 2000,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
              });
              
              const $ep = cheerio.load(epResponse.data);
              
              // Extract genres from episode page
              const epGenres = [];
              $ep('.tag, .genre, a[rel="tag"]').each((i, tag) => {
                const genreText = $ep(tag).text().trim();
                if (genreText && genreText.length > 2 && genreText.length < 30) {
                  epGenres.push(genreText);
                }
              });
              
              if (epGenres.length > 0) {
                series.genres = epGenres;
              }
              
              // Extract description from episode page
              const epDesc = $ep('meta[property="og:description"]').attr('content') ||
                            $ep('meta[name="description"]').attr('content') ||
                            '';
              
              if (epDesc && epDesc.length > 10) {
                series.description = epDesc.substring(0, 200);
              }
              
                return { slug, success: true, source: 'episode-fallback' };
              }
            } catch (fallbackErr) {
              // Both failed
            }
            return { slug, success: false };
          }
        });
        
        // Wait for this batch to complete before starting the next
        const batchResults = await Promise.allSettled(batchPromises);
        enrichedResults.push(...batchResults);
      }
      
      const enrichedCount = enrichedResults.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      
      // Convert back to array and apply fallbacks for non-enriched series
      const enrichedSeries = Array.from(seriesArray, ([slug, series]) => {
        // Set basic description
        if (!series.description) {
          const epCount = series.episodes.length || 1;
          series.description = epCount > 1 ? `${epCount} episodes` : '1 episode';
        }
        
        // Ensure genres array exists for catalog preview
        if (!series.genres || series.genres.length === 0) {
          series.genres = ['Hentai'];
        }
        
        return series;
      });

      logger.info(`Found ${enrichedSeries.length} series (${enrichedCount} with full metadata)`);
      
      // Enrich with MAL data if enabled
      if (this.enableMAL && enrichedSeries.length > 0) {
        logger.info(`Enriching ${enrichedSeries.length} series with MAL data...`);
        
        // Enrich in batches of 3 to respect rate limits (3 req/sec)
        const batchSize = 3;
        const malEnrichedSeries = [];
        
        for (let i = 0; i < enrichedSeries.length; i += batchSize) {
          const batch = enrichedSeries.slice(i, i + batchSize);
          const batchPromises = batch.map(series => malClient.enrichSeries(series));
          const batchResults = await Promise.all(batchPromises);
          malEnrichedSeries.push(...batchResults);
        }
        
        const malMatchCount = malEnrichedSeries.filter(s => s.malId).length;
        logger.info(`MAL enrichment complete: ${malMatchCount}/${enrichedSeries.length} series matched`);
        
        return malEnrichedSeries;
      }
      
      return enrichedSeries;

    } catch (error) {
      logger.error('Error fetching HentaiMama catalog:', error.message);
      return [];
    }
  }

  /**
   * Get comprehensive metadata for a series
   * Fetches episode 1 to get full series details
   */
  async getMetadata(seriesId) {
    try {
      const cleanId = seriesId.replace('hmm-', '');
      
      // Determine if this is a series or episode ID
      const isEpisodeId = cleanId.match(/-episode-\d+$/);
      let seriesSlug, episodeSlug, seriesPageUrl;
      
      if (isEpisodeId) {
        // Extract series slug from episode ID
        episodeSlug = cleanId;
        seriesSlug = cleanId.replace(/-episode-\d+$/, '');
      } else {
        // This is a series ID - we'll fetch the series page first to find episode slugs
        seriesSlug = cleanId;
        seriesPageUrl = `${this.baseUrl}/tvshows/${seriesSlug}/`;
        episodeSlug = null; // Will be determined from series page
      }
      
      let $, response;
      let seriesPageLink = seriesPageUrl; // May already have it from series page lookup
      
      // If we don't have an episode slug, fetch the series page first
      if (!episodeSlug) {
        try {
          logger.info(`Fetching series page to find episodes: ${seriesPageUrl}`);
          const seriesResponse = await axios.get(seriesPageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 5000
          });
          
          const $series = cheerio.load(seriesResponse.data);
          
          // Find the first episode link
          const firstEpisodeLink = $series('a[href*="/episodes/"]').first().attr('href');
          if (firstEpisodeLink) {
            const epSlugMatch = firstEpisodeLink.match(/episodes\/([\w-]+)/);
            if (epSlugMatch) {
              episodeSlug = epSlugMatch[1];
              logger.info(`Found first episode slug from series page: ${episodeSlug}`);
            }
          }
        } catch (err) {
          logger.warn(`Could not fetch series page: ${err.message}`);
          // Fallback to guessing episode 1 slug
          episodeSlug = `${cleanId}-episode-1`;
        }
      }
      
      // If we still don't have an episode slug, try the guessed pattern
      if (!episodeSlug) {
        episodeSlug = `${seriesSlug}-episode-1`;
      }
      
      // Fetch episode page for metadata
      const url = `${this.baseUrl}/episodes/${episodeSlug}`;
      
      logger.info(`Fetching HentaiMama episode metadata for ${episodeSlug}`);
      response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': this.baseUrl
        }
      });
      $ = cheerio.load(response.data);
      
      // Extract the actual series page URL from the episode page (if we don't have it yet)
      if (!seriesPageLink) {
        seriesPageLink = $('a[href*="/tvshows/"]').first().attr('href');
      }
      let seriesPoster = '';
      
      if (seriesPageLink) {
        const seriesPageUrl = seriesPageLink.startsWith('http') ? seriesPageLink : `${this.baseUrl}${seriesPageLink}`;
        
        try {
          logger.info(`Fetching series cover from: ${seriesPageUrl}`);
          const seriesResponse = await axios.get(seriesPageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 3000
          });
          
          const $series = cheerio.load(seriesResponse.data);
          
          // Extract proper series cover art
          seriesPoster = $series('.poster img, .sheader img').first().attr('data-src') ||
                        $series('.poster img, .sheader img').first().attr('src') ||
                        '';
          
          // Make absolute URL
          if (seriesPoster && !seriesPoster.startsWith('http')) {
            seriesPoster = seriesPoster.startsWith('//') 
              ? `https:${seriesPoster}` 
              : `${this.baseUrl}${seriesPoster}`;
          }
          
          // Filter out placeholders and snapshots
          if (seriesPoster && (seriesPoster.includes('data:image') || 
                               seriesPoster.includes('placeholder') ||
                               seriesPoster.includes('mp4_snapshot'))) {
            seriesPoster = '';
          }
          
          if (seriesPoster) {
            logger.info(`Found series cover art from linked page`);
          }
        } catch (err) {
          // Non-critical error - continue with episode metadata
          logger.debug(`Could not fetch series cover: ${err.message}`);
        }
      }
      
      // Extract the ACTUAL series URL from the episode page (more reliable than guessing)
      const actualSeriesLink = $('a[href*="/tvshows/"]').first().attr('href');
      if (actualSeriesLink) {
        const actualSeriesSlugMatch = actualSeriesLink.match(/tvshows\/([\w-]+)/);
        if (actualSeriesSlugMatch) {
          seriesSlug = actualSeriesSlugMatch[1];
          logger.info(`Found actual series slug from episode page: ${seriesSlug}`);
        }
      }

      // Extract title - try multiple selectors
      let title = $('h1.entry-title').first().text().trim() ||
                 $('h1').first().text().trim() ||
                 $('.entry-title').first().text().trim() ||
                 $('meta[property=\"og:title\"]').attr('content') ||
                 cleanId.replace(/-/g, ' ');

      // Clean up title - remove site name and "Episode X"
      title = title.replace(/\s*[-–|]\s*HentaiMama.*$/i, '').trim();
      title = title.replace(/Episode\s+\d+/gi, '').trim();
      title = title.replace(/\s+/g, ' ').trim();
      
      // If title is empty or just the site name, extract from URL
      if (!title || title.toLowerCase() === 'hentaimama' || title.length < 3) {
        title = cleanId
          .replace(/-episode-\d+$/, '') // Remove -episode-1 suffix
          .replace(/-/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase()); // Title case
      }

      // Extract description FIRST - always needed regardless of cover art
      // This ensures series get proper metadata even if cover art fetch fails
      let description = $('meta[property="og:description"]').attr('content') ||
                       $('meta[name="description"]').attr('content') ||
                       $('.entry-content p').first().text().trim() ||
                       $('.description').text().trim() ||
                       '';

      // Clean up description
      description = description.replace(/Watch.*?HentaiMama/gi, '').trim();
      description = description.substring(0, 500); // Limit length

      // Try to extract tags/genres
      const genres = [];
      $('.tag, .genre, a[rel="tag"]').each((i, elem) => {
        const tag = $(elem).text().trim();
        if (tag && tag.length > 2 && tag.length < 30) {
          genres.push(tag);
        }
      });

      // Extract release date
      let releaseInfo = $('.published, .entry-date, time').first().text().trim() ||
                       $('meta[property="article:published_time"]').attr('content') ||
                       '';
      
      if (releaseInfo) {
        // Extract year from date
        const yearMatch = releaseInfo.match(/20\d{2}/);
        releaseInfo = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
      } else {
        releaseInfo = new Date().getFullYear().toString();
      }
      
      // Select poster: prioritize series cover, fallback to episode images
      let poster = seriesPoster || // Use series cover art if we got it
                  $('meta[property="og:image"]').attr('content') ||
                  $('.entry-content img').first().attr('data-src') ||
                  $('.entry-content img').first().attr('src') ||
                  $('.thumbnail img').first().attr('data-src') ||
                  $('.thumbnail img').first().attr('src') ||
                  $('video').attr('poster') ||
                  '';

      // Clean up poster URL
      if (poster) {
        poster = poster.trim();
      }

      // Filter out placeholder images
      if (poster && (poster.includes('data:image') || poster.includes('placeholder'))) {
        poster = '';
      }

      // Make poster absolute URL
      if (poster && !poster.startsWith('http')) {
        poster = poster.startsWith('//') ? `https:${poster}` : `${this.baseUrl}${poster}`;
      }

      // Try to discover all episodes from the series page
      logger.info(`Discovering episodes for series: ${seriesSlug}`);
      
      const episodesMap = new Map();
      
      // Try to fetch episodes from the series page first
      try {
        const seriesPageUrl = `${this.baseUrl}/tvshows/${seriesSlug}/`;
        const seriesPageResponse = await axios.get(seriesPageUrl, {
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        const $seriesPage = cheerio.load(seriesPageResponse.data);
        
        // Look for episode cards (article tags) on the series page
        $seriesPage('article').each((i, epElem) => {
          const $ep = $seriesPage(epElem);
          const epLink = $ep.find('a[href*="episodes"]').attr('href');
          const epTitle = $ep.find('.episodiotitle, .episode-title, a').first().text().trim();
          const epImg = $ep.find('img').first().attr('data-src') || $ep.find('img').first().attr('src');
          
          if (epLink) {
            const epSlugMatch = epLink.match(/episodes\/([\w-]+)/);
            const epNumMatch = epLink.match(/episode-(\d+)/);
            
            if (epSlugMatch && epNumMatch) {
              const epNum = parseInt(epNumMatch[1]);
              const epSlug = epSlugMatch[1];
              
              if (!episodesMap.has(epNum)) {
                // Extract and clean episode thumbnail
                let episodePoster = epImg;
                if (episodePoster && !episodePoster.startsWith('http')) {
                  episodePoster = episodePoster.startsWith('//') ? `https:${episodePoster}` : `${this.baseUrl}${episodePoster}`;
                }
                if (episodePoster && episodePoster.includes('data:image')) {
                  episodePoster = '';
                }
                
                episodesMap.set(epNum, {
                  number: epNum,
                  slug: epSlug,
                  id: `hmm-${epSlug}`,
                  title: epTitle || `Episode ${epNum}`,
                  poster: episodePoster || undefined
                });
              }
            }
          }
        });
        
        logger.info(`Found ${episodesMap.size} episodes on series page`);
      } catch (err) {
        logger.warn(`Could not fetch series page for episode discovery: ${err.message}`);
      }
      
      // Convert to sorted array
      let episodes = Array.from(episodesMap.values()).sort((a, b) => a.number - b.number);
      
      // If no episodes found via catalog, add current episode
      if (episodes.length === 0) {
        const currentEpMatch = episodeSlug.match(/episode-(\d+)$/);
        const currentEpNum = currentEpMatch ? parseInt(currentEpMatch[1]) : 1;
        episodes = [{
          number: currentEpNum,
          slug: episodeSlug,
          id: `hmm-${episodeSlug}`,
          title: `Episode ${currentEpNum}`
        }];
      }
      
      logger.info(`Found ${episodes.length} episodes for ${seriesSlug}`);

      return {
        id: seriesId,
        seriesId: `hmm-${seriesSlug}`,
        seriesSlug: seriesSlug,
        name: title,
        poster: poster || undefined,
        description,
        genres: genres.length > 0 ? genres : ['Hentai'],
        type: 'series',
        runtime: '25 min',
        releaseInfo,
        episodes: episodes
      };

    } catch (error) {
      logger.error(`Error fetching HentaiMama metadata for ${seriesId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get stream URLs using direct scraping (following Python plugin logic)
   */
  async getStreams(episodeId) {
    try {
      const cleanId = episodeId.replace('hmm-', '');
      const pageUrl = `${this.baseUrl}/episodes/${cleanId}`;
      
      logger.info(`Fetching HentaiMama streams for ${cleanId}`);
      
      // Step 1: Get the episode page
      const pageResponse = await axios.get(pageUrl);
      const $ = cheerio.load(pageResponse.data);

      // Step 2: Find AJAX data (jwplayerOptions or similar)
      const scriptContent = $('script').toArray()
        .map(el => $(el).html())
        .join('\n');

      // Look for jwplayerOptions, player data, or direct video URLs
      let videoData = null;

      // Try to find jwplayer setup
      const jwMatch = scriptContent.match(/jwplayer\([^)]+\)\.setup\((\{[^}]+\})\)/);
      if (jwMatch) {
        try {
          videoData = JSON.parse(jwMatch[1]);
        } catch (e) {
          logger.error('Failed to parse jwplayer data:', e.message);
        }
      }

      // Try to find direct sources
      if (!videoData) {
        const sourcesMatch = scriptContent.match(/sources:\s*(\[[^\]]+\])/);
        if (sourcesMatch) {
          try {
            videoData = { sources: eval(sourcesMatch[1]) };
          } catch (e) {
            logger.error('Failed to eval sources:', e.message);
          }
        }
      }

      // Try WordPress AJAX approach (as per Python plugin)
      if (!videoData) {
        // Look for get_player_contents AJAX call with 'a' parameter
        const actionMatch = scriptContent.match(/action:\s*['"]([^'"]+)['"]/);
        const aMatch = scriptContent.match(/a:\s*['"]?(\d+)['"]?/);
        
        if (actionMatch && aMatch) {
          logger.info(`Making AJAX call: action=${actionMatch[1]}, a=${aMatch[1]}`);
          
          const ajaxResponse = await axios.post(
            `${this.baseUrl}/wp-admin/admin-ajax.php`,
            new URLSearchParams({
              action: actionMatch[1],
              a: aMatch[1]
            }),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': pageUrl
              }
            }
          );

          // Response is array of iframe HTML strings
          if (ajaxResponse.data && Array.isArray(ajaxResponse.data)) {
            logger.info(`Got ${ajaxResponse.data.length} player iframes`);
            
            // Try each iframe
            for (const iframeHtml of ajaxResponse.data) {
              // Extract iframe src
              const srcMatch = iframeHtml.match(/src=["']([^"']+)["']/);
              if (srcMatch) {
                const iframeUrl = srcMatch[1];
                try {
                  logger.info(`Fetching iframe: ${iframeUrl}`);
                  const iframeResponse = await axios.get(iframeUrl);
                  const $iframe = cheerio.load(iframeResponse.data);
                  
                  // Find jwplayer or video sources in iframe
                  const iframeScript = $iframe('script').toArray()
                    .map(el => $iframe(el).html())
                    .join('\n');
                  
                  // Try multiple patterns for sources
                  let sources = null;
                  
                  // Pattern 1: sources: [{...}]
                  const sourcesMatch1 = iframeScript.match(/sources:\s*(\[[^\]]+\])/);
                  if (sourcesMatch1) {
                    try {
                      sources = eval(sourcesMatch1[1]);
                    } catch (e) {
                      logger.error('Failed to eval sources pattern 1:', e.message);
                    }
                  }
                  
                  // Pattern 2: "file":"url"
                  if (!sources) {
                    const fileMatches = iframeScript.match(/"file"\s*:\s*"([^"]+)"/g);
                    if (fileMatches) {
                      sources = fileMatches.map(m => {
                        const url = m.match(/"file"\s*:\s*"([^"]+)"/)[1];
                        return { file: url };
                      });
                    }
                  }
                  
                  if (sources && sources.length > 0) {
                    videoData = { sources };
                    logger.info(`Found ${sources.length} sources in iframe`);
                    break;
                  }
                } catch (e) {
                  logger.error(`Failed to fetch iframe: ${e.message}`);
                }
              }
            }
          }
        }
      }

      // Extract streams from videoData
      if (videoData && videoData.sources) {
        const streams = videoData.sources
          .filter(s => s.file)
          .map(source => ({
            url: source.file,
            quality: source.label || 'Unknown',
            type: source.type || 'video/mp4'
          }))
          .sort((a, b) => {
            const aHeight = parseInt(a.quality) || 0;
            const bHeight = parseInt(b.quality) || 0;
            return bHeight - aHeight;
          });

        logger.info(`Found ${streams.length} streams for ${cleanId}`);
        return streams;
      }

      logger.warn(`No streams found for ${cleanId}`);
      return [];

    } catch (error) {
      logger.error(`Error fetching HentaiMama streams for ${episodeId}:`, error.message);
      throw error;
    }
  }
}

module.exports = new HentaiMamaScraper();
