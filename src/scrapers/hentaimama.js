const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { parseDate, extractYear, getMostRecentDate } = require('../utils/dateParser');
const httpClient = require('../utils/httpClient');

// Cloudflare Worker proxy URL (set via environment variable)
// Deploy the worker from cloudflare-worker/worker.js to get this URL
const CF_PROXY_URL = process.env.CF_PROXY_URL || null;

// Multiple User-Agents to rotate through (some sites block specific ones)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Get a random User-Agent
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Build headers with optional custom User-Agent
function buildHeaders(customUA = null) {
  return {
    'User-Agent': customUA || getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };
}

class HentaiMamaScraper {
  constructor() {
    this.baseUrl = 'https://hentaimama.io';
    this.searchUrl = `${this.baseUrl}/episodes`;
    this.genresCache = null;
    this.genresCacheTime = null;
    this.name = 'HentaiMama'; // Provider name for rating aggregation
    this.prefix = 'hmm'; // Provider prefix for IDs
    this.maxRetries = 3; // Number of retries
    
    // Log proxy status on construction
    if (CF_PROXY_URL) {
      logger.info(`[HentaiMama] Cloudflare Worker proxy enabled: ${CF_PROXY_URL}`);
    } else {
      logger.info('[HentaiMama] No CF_PROXY_URL set, using direct requests (may get blocked on cloud hosting)');
    }
  }

  /**
   * Make a resilient HTTP request using Cloudflare Worker proxy (if available)
   * Falls back to direct axios requests
   * @param {string} url - URL to fetch
   * @param {object} options - Additional options
   * @returns {Promise<object>} Response with { data, status }
   */
  async makeRequest(url, options = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Use Cloudflare Worker proxy if available (best for cloud hosting)
        if (CF_PROXY_URL) {
          const proxyUrl = `${CF_PROXY_URL}?url=${encodeURIComponent(url)}`;
          const response = await axios.get(proxyUrl, {
            timeout: 30000, // Longer timeout for proxy
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });
          
          // Check if the proxied request returned 403
          const proxiedStatus = response.headers['x-proxied-status'];
          if (proxiedStatus === '403') {
            throw { status: 403, message: 'Forbidden (via proxy)' };
          }
          
          return { data: response.data, status: response.status };
        }
        
        // Direct request (works locally, may fail on cloud hosting)
        const headers = buildHeaders();
        const response = await axios.get(url, {
          headers,
          timeout: 15000,
        });
        return response;
      } catch (error) {
        lastError = error;
        const status = error.status || error.response?.status || error.code || 'network error';
        
        if (status === 403 && attempt < this.maxRetries) {
          logger.warn(`[HentaiMama] Attempt ${attempt} failed (${status}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
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
      const response = await this.makeRequest(`${this.baseUrl}/genres-filter/`);
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
      const errorMsg = error.response?.status 
        ? `HTTP ${error.response.status}` 
        : (error.message || 'Unknown error');
      logger.warn(`Could not fetch genres: ${errorMsg} (addon will work without genre catalogs)`);
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
   * Get catalog items filtered by release year
   * HentaiMama uses advance-search with years_filter query parameter
   * @param {number|string} year - Year to filter by
   * @param {number} page - Page number (1-indexed)
   * @returns {Promise<Array>} Array of series items
   */
  async getCatalogByYear(year, page = 1) {
    try {
      // HentaiMama uses advance-search with years_filter param
      // Format: /advance-search/?years_filter[]=YYYY&submit=Submit
      const url = page === 1 
        ? `${this.baseUrl}/advance-search/?years_filter%5B%5D=${year}&submit=Submit`
        : `${this.baseUrl}/advance-search/page/${page}/?years_filter%5B%5D=${year}&submit=Submit`;
      logger.info(`[HentaiMama] Fetching year ${year} page ${page}: ${url}`);
      
      const response = await this.makeRequest(url);
      const $ = cheerio.load(response.data);
      
      // _parseArticleItems will filter to only items with verified matching year
      return this._parseArticleItems($, year, null);
    } catch (error) {
      logger.error(`[HentaiMama] Year catalog error: ${error.message}`);
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
      logger.info(`[HentaiMama] Fetching studio ${studio} page ${page}: ${url}`);
      
      const response = await this.makeRequest(url);
      const $ = cheerio.load(response.data);
      
      return this._parseArticleItems($, null, studio);
    } catch (error) {
      logger.error(`[HentaiMama] Studio catalog error: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse article items from catalog page (shared helper)
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {string|null} filterYear - Year filter (items without verified year will be excluded)
   * @param {string|null} filterStudio - Studio filter
   */
  _parseArticleItems($, filterYear = null, filterStudio = null) {
    const items = [];
    
    $('article').each((i, el) => {
      try {
        const $article = $(el);
        const $link = $article.find('a').first();
        const href = $link.attr('href') || '';
        
        // Only process series links, not episode links
        if (!href.includes('/hentai-series/')) return;
        
        const slugMatch = href.match(/\/hentai-series\/([^\/]+)/);
        if (!slugMatch) return;
        const slug = slugMatch[1];
        
        const title = $article.find('.data h3, h3, .title').text().trim() ||
                     $article.find('img').attr('alt') || '';
        
        const poster = $article.find('img').attr('data-src') ||
                      $article.find('img').attr('src') || '';
        
        // Extract year from page content only - DO NOT use filter parameter
        // We only trust what we can actually extract from the page
        const yearText = $article.find('.data span, .metadata, .year').text();
        const yearMatch = yearText.match(/(\d{4})/);
        const extractedYear = yearMatch ? parseInt(yearMatch[1]) : null;
        
        // Studio info is not in catalog listings, only on detail pages
        const extractedStudio = null;
        
        const item = {
          id: `${this.prefix}-${slug}`,
          type: 'series',
          name: title,
          poster: poster.startsWith('//') ? `https:${poster}` : poster,
          year: extractedYear,
          studio: extractedStudio,
          releaseInfo: extractedYear ? String(extractedYear) : undefined
        };
        
        if (item.name && item.poster) {
          items.push(item);
        }
      } catch (err) {
        logger.debug(`[HentaiMama] Error parsing article: ${err.message}`);
      }
    });
    
    logger.info(`[HentaiMama] Found ${items.length} items from year/studio page`);
    
    // If filtering by year, only return items where we verified the year
    if (filterYear) {
      const yearNum = parseInt(filterYear);
      const filtered = items.filter(item => item.year === yearNum);
      logger.info(`[HentaiMama] Year ${filterYear}: ${items.length} total, ${filtered.length} with verified year`);
      return filtered;
    }
    
    // If filtering by studio, assign the studio from filter (we trust the studio page)
    if (filterStudio) {
      items.forEach(item => {
        item.studio = filterStudio;
      });
      logger.info(`[HentaiMama] Studio ${filterStudio}: ${items.length} items`);
    }
    
    return items;
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
      let url = page === 1 ? `${baseUrl}/` : `${baseUrl}/page/${page}/`;
      
      // Add filter parameter for popular sort - MUST be in the URL itself
      // because makeRequest uses the URL directly
      if (sortBy === 'popular') {
        url += url.includes('?') ? '&filter=rating' : '?filter=rating';
      }
      
      logger.info(`→ Fetching URL: ${url}`);
      
      const response = await this.makeRequest(url);

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
      
      // ===== OPTIMIZED BATCH METADATA FETCHING =====
      // Use batch fetch via CF Worker: 15-20 URLs per request instead of 5 sequential batches
      const seriesUrls = seriesArray.map(([slug]) => `${this.baseUrl}/tvshows/${slug}/`);
      
      logger.info(`[HentaiMama] Batch fetching metadata for ${seriesUrls.length} series...`);
      const startTime = Date.now();
      
      // Fetch all series pages in batch (15 URLs per CF Worker request)
      const batchResults = await httpClient.batchFetch(seriesUrls, { timeout: 30000 });
      
      logger.info(`[HentaiMama] Batch fetch completed in ${Date.now() - startTime}ms`);
      
      // Process all results
      let enrichedCount = 0;
      for (let i = 0; i < seriesArray.length; i++) {
        const [slug, series] = seriesArray[i];
        const result = batchResults[i];
        
        if (!result || !result.success || !result.body) {
          continue;
        }
        
        try {
          const $series = cheerio.load(result.body);
          
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
          
          // Extract proper title with colon from series page
          const seriesTitle = $series('.sheader h1, .data h1').first().text().trim() ||
                             $series('meta[property="og:title"]').attr('content') ||
                             '';
          if (seriesTitle && seriesTitle.length > 2) {
            series.name = seriesTitle;
          }
          
          // Extract release year from series page .date element
          const dateText = $series('.date, span.date').first().text().trim();
          if (dateText) {
            const yearMatch = dateText.match(/(19|20)\d{2}/);
            if (yearMatch) {
              series.year = yearMatch[0];
              series.releaseInfo = yearMatch[0]; // Year only for catalog display
            }
          }
          
          // Extract lastUpdated from article meta for weekly/monthly filtering
          // Try modified time first (more relevant), then published time
          const modifiedTime = $series('meta[property="article:modified_time"]').attr('content');
          const publishedTime = $series('meta[property="article:published_time"]').attr('content');
          const metaDate = modifiedTime || publishedTime;
          if (metaDate) {
            const fullDate = parseDate(metaDate);
            if (fullDate) {
              series.lastUpdated = fullDate;
              logger.debug(`[HentaiMama] Found lastUpdated ${fullDate} for ${series.name}`);
            }
          }
          
          // Extract rating from series page (DooPlay theme)
          // Selector: .dt_rating_vgs contains the rating value (e.g., "8.9")
          const ratingText = $series('.dt_rating_vgs').first().text().trim();
          if (ratingText) {
            const ratingValue = parseFloat(ratingText);
            if (!isNaN(ratingValue) && ratingValue >= 0 && ratingValue <= 10) {
              series.rating = ratingValue;
              series.ratingType = 'direct';
            }
          }
          
          // Extract vote count if available
          const voteText = $series('.rating-count').first().text().trim();
          if (voteText) {
            const voteCount = parseInt(voteText.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(voteCount)) {
              series.voteCount = voteCount;
            }
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
          
          // Extract studio from series page
          // Look for links to /studio/ pages in the header/data section
          let studio = null;
          $series('.sheader .data a[href*="/studio/"], .sgeneros a[href*="/studio/"], a[href*="/studio/"]').each((i, el) => {
            const studioText = $series(el).text().trim();
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
          
          if (studio) {
            series.studio = studio;
          }
          
          // Extract description
          const seriesDesc = $series('.wp-content p, .description, .entry-content p').first().text().trim() ||
                            $series('meta[property="og:description"]').attr('content') ||
                            '';
          
          if (seriesDesc && seriesDesc.length > 10) {
            let desc = seriesDesc.replace(/Watch.*?HentaiMama/gi, '').trim();
            // Truncate at word boundary for catalog display
            if (desc.length > 350) {
              desc = desc.substring(0, 350);
              const lastSpace = desc.lastIndexOf(' ');
              if (lastSpace > 200) desc = desc.substring(0, lastSpace);
              desc = desc.trim() + '...';
            }
            series.description = desc;
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
          
          enrichedCount++;
        } catch (err) {
          logger.debug(`[HentaiMama] Error parsing metadata for ${slug}: ${err.message}`);
        }
      }
      
      logger.info(`[HentaiMama] Enriched ${enrichedCount}/${seriesArray.length} series with metadata`);
      
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
        
        // IMPORTANT: If fetched from a genre page, ensure that genre is in the genres array
        // This is critical for local genre filtering to work correctly
        if (genre) {
          // Convert genre slug back to display name (e.g., "3d" -> "3D", "big-boobs" -> "Big Boobs")
          const genreDisplayName = genre.split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          
          // Check if this genre (or similar) is already in the array
          const hasGenre = series.genres.some(g => 
            g.toLowerCase() === genre.toLowerCase() ||
            g.toLowerCase().replace(/\s+/g, '-') === genre.toLowerCase() ||
            g.toLowerCase().includes(genre.toLowerCase()) ||
            genre.toLowerCase().includes(g.toLowerCase().replace(/\s+/g, '-'))
          );
          
          if (!hasGenre) {
            series.genres.unshift(genreDisplayName);
            logger.debug(`[HentaiMama] Added genre "${genreDisplayName}" to ${series.name}`);
          }
        }
        
        // Ensure releaseInfo is set if year exists
        if (series.year && !series.releaseInfo) {
          series.releaseInfo = series.year;
        }
        
        return series;
      });

      logger.info(`Found ${enrichedSeries.length} series (${enrichedCount} with full metadata)`);
      
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
          const seriesResponse = await this.makeRequest(seriesPageUrl, { timeout: 5000 });
          
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
      response = await this.makeRequest(url);
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
          const seriesResponse = await this.makeRequest(seriesPageUrl, { timeout: 3000 });
          
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
      // Note: Episode pages often have promotional descriptions, so we'll try to replace this
      // with the series page description later if available
      let description = $('meta[property="og:description"]').attr('content') ||
                       $('meta[name="description"]').attr('content') ||
                       $('.entry-content p').first().text().trim() ||
                       $('.description').text().trim() ||
                       '';

      // Clean up description - aggressively remove ALL promotional text patterns
      // These patterns appear on HentaiMama episode pages and should be stripped
      const isPromoText = (text) => {
        if (!text || text.length < 10) return true;
        const promoPatterns = [
          /^Stream\s+.+?\s+Episode\s+\d+/i,
          /^Watch\s+.+?\s+Episode\s+\d+/i,
          /We have thousands of hentai videos/i,
          /Hentaimama have thousands/i,
          /New videos added weekly/i,
          /your viewing pleasure/i,
          /for free\.\s*We have/i,
          /English Subtitle for free/i,
          /thousands of free hentai/i,
          /3D porn all of your/i
        ];
        return promoPatterns.some(p => p.test(text));
      };
      
      // If the ENTIRE description is promotional (starts with Stream/Watch), clear it entirely
      // This is because the promotional text often includes ALL the patterns joined together
      if (/^(Stream|Watch)\s+.+?\s+Episode\s+\d+/i.test(description)) {
        logger.info(`Episode page has promotional description, will need series page description`);
        description = ''; // Clear it, we'll get it from series page
      } else {
        // Clean up promotional phrases if mixed with real content
        description = description
          .replace(/Watch.*?HentaiMama/gi, '')
          .replace(/Stream\s+.+?\s+Episode\s+\d+\s+with\s+English\s+Subtitle\s+for\s+free\.?/gi, '')
          .replace(/We have thousands of hentai videos.*?(?:viewing pleasure!?)?/gi, '')
          .replace(/Hentaimama have thousands.*?(?:viewing pleasure!?)?/gi, '')
          .replace(/New videos added weekly\.?/gi, '')
          .replace(/online\.\s*$/gi, '')
          .trim();
      }

      // Try to extract tags/genres
      const genres = [];
      $('.tag, .genre, a[rel="tag"]').each((i, elem) => {
        const tag = $(elem).text().trim();
        if (tag && tag.length > 2 && tag.length < 30) {
          genres.push(tag);
        }
      });

      // Extract release date AND proper title from series page (more reliable than episode page)
      let releaseInfo = '';
      let seriesTitle = '';
      let studio = null;
      
      // Try to fetch year, title, studio AND DESCRIPTION from series page if we have the link
      if (seriesPageLink) {
        try {
          const seriesUrl = seriesPageLink.startsWith('http') ? seriesPageLink : `${this.baseUrl}${seriesPageLink}`;
          const seriesResponse = await this.makeRequest(seriesUrl, { timeout: 3000 });
          const $seriesPage = cheerio.load(seriesResponse.data);
          
          // Extract proper title with colon from series page
          seriesTitle = $seriesPage('.sheader h1, .data h1').first().text().trim() ||
                       $seriesPage('meta[property="og:title"]').attr('content') ||
                       '';
          if (seriesTitle && seriesTitle.length > 2) {
            title = seriesTitle;
            logger.info(`Found proper title from series page: ${title}`);
          }
          
          // CRITICAL: Get description from series page (not episode page promo text)
          // The series page has the actual story description, episode pages have SEO promo text
          // Try multiple paragraphs to find one that's NOT promotional text
          let seriesDesc = '';
          $seriesPage('.wp-content p, .description p, .entry-content p').each((i, el) => {
            if (seriesDesc) return; // Already found good description
            const text = $seriesPage(el).text().trim();
            // Skip promotional/SEO text patterns
            if (!text || text.length < 20) return;
            if (/Stream\s+.+?\s+Episode\s+\d+\s+with\s+English/i.test(text)) return;
            if (/We have thousands of hentai videos/i.test(text)) return;
            if (/Hentaimama have thousands/i.test(text)) return;
            if (/New videos added weekly/i.test(text)) return;
            if (/for free\.\s*We have/i.test(text)) return;
            if (/your viewing pleasure/i.test(text)) return;
            // This paragraph looks like real content
            seriesDesc = text;
          });
          
          // Fallback to og:description if no good paragraph found
          // BUT only if it's not promotional text
          if (!seriesDesc) {
            const ogDesc = $seriesPage('meta[property="og:description"]').attr('content') || '';
            if (ogDesc && !isPromoText(ogDesc)) {
              seriesDesc = ogDesc;
            }
          }
          
          if (seriesDesc && seriesDesc.length > 20 && !isPromoText(seriesDesc)) {
            // Final cleanup of any promotional remnants
            description = seriesDesc
              .replace(/Watch.*?HentaiMama/gi, '')
              .replace(/Stream\s+.+?\s+for\s+free\./gi, '')
              .replace(/We have thousands.*?online\./gi, '')
              .replace(/New videos added weekly\./gi, '')
              .replace(/Hentaimama have thousands.*?pleasure!/gi, '')
              .trim();
            
            // Only use if we have meaningful content left
            if (description.length > 20) {
              logger.info(`Found proper description from series page: ${description.substring(0, 50)}...`);
            } else {
              // Reset to empty so we use fallback
              description = '';
            }
          }
          
          // Extract year from .date element on series page
          const dateText = $seriesPage('.date, span.date').first().text().trim();
          if (dateText) {
            const yearMatch = dateText.match(/(19|20)\d{2}/);
            if (yearMatch) {
              releaseInfo = yearMatch[0];
              logger.info(`Found release year from series page: ${releaseInfo}`);
            }
          }
          
          // Extract studio from series page metadata
          $seriesPage('.sgeneros a, .data a[href*="studio"]').each((i, el) => {
            const href = $seriesPage(el).attr('href') || '';
            if (href.includes('/studio/')) {
              studio = $seriesPage(el).text().trim();
            }
          });
          if (studio) {
            logger.info(`Found studio from series page: ${studio}`);
          }
        } catch (err) {
          logger.debug(`Could not fetch series page for year: ${err.message}`);
        }
      }
      
      // Fallback to episode page meta (less reliable)
      // Also capture full date for weekly/monthly filtering
      let episodePublishDate = null;
      if (!releaseInfo) {
        const epDateText = $('meta[property="article:published_time"]').attr('content') || '';
        if (epDateText) {
          // Parse full date for filtering capabilities
          episodePublishDate = parseDate(epDateText);
          // Extract year for display
          const year = extractYear(epDateText);
          releaseInfo = year ? year.toString() : '';
        }
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
        const seriesPageResponse = await this.makeRequest(seriesPageUrl, { timeout: 5000 });
        
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

      // Filter out studio from genres (HentaiMama marks studios with same rel="tag" as genres)
      const filteredGenres = genres.filter(g => 
        !studio || g.toLowerCase() !== studio.toLowerCase()
      );
      
      // FINAL VALIDATION: Ensure description is not promotional text
      // If after all cleaning we still have promo text, use a generic description
      if (!description || description.length < 20 || isPromoText(description)) {
        // Generate a simple description from the title and genres
        const genreText = filteredGenres.length > 0 ? filteredGenres.slice(0, 3).join(', ') : 'Hentai';
        description = `${title} - A ${genreText} series.`;
        logger.info(`Using generated description (original was promotional): ${description}`);
      }
      
      return {
        id: seriesId,
        seriesId: `hmm-${seriesSlug}`,
        seriesSlug: seriesSlug,
        name: title,
        poster: poster || undefined,
        description,
        genres: filteredGenres.length > 0 ? filteredGenres : ['Hentai'],
        studio: studio,
        type: 'series',
        releaseInfo,
        episodes: episodes
      };

    } catch (error) {
      const errorMsg = error.response?.status === 404 
        ? `Series not found (404): ${seriesId}`
        : `${error.message} (${error.response?.status || 'unknown'})`;
      
      logger.error(`Error fetching HentaiMama metadata for ${seriesId}: ${errorMsg}`);
      
      // Return null instead of throwing to allow graceful degradation
      return null;
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
      const pageResponse = await this.makeRequest(pageUrl);
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
          
          let ajaxResponse;
          const ajaxUrl = `${this.baseUrl}/wp-admin/admin-ajax.php`;
          const postData = new URLSearchParams({
            action: actionMatch[1],
            a: aMatch[1]
          }).toString();
          
          // Use Cloudflare Worker proxy if available (for cloud hosting)
          if (CF_PROXY_URL) {
            // Route POST through proxy by encoding params in URL
            const proxyUrl = `${CF_PROXY_URL}?url=${encodeURIComponent(ajaxUrl)}&method=POST&body=${encodeURIComponent(postData)}`;
            ajaxResponse = await axios.get(proxyUrl, {
              timeout: 30000,
              headers: {
                'Accept': 'application/json',
              }
            });
          } else {
            // Direct request (works locally)
            ajaxResponse = await axios.post(ajaxUrl, postData, {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': pageUrl
              }
            });
          }

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
                  const iframeResponse = await this.makeRequest(iframeUrl, { timeout: 10000 });
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

      logger.debug(`No streams found for ${cleanId}`);
      return [];

    } catch (error) {
      // 404 errors are expected when content doesn't exist on this provider
      // Don't log these as errors to reduce noise
      if (error.response?.status === 404 || error.message?.includes('404')) {
        logger.debug(`[HentaiMama] Content not found: ${episodeId}`);
        return [];
      }
      logger.error(`Error fetching HentaiMama streams for ${episodeId}:`, error.message);
      throw error;
    }
  }
}

module.exports = new HentaiMamaScraper();
