const axios = require('axios');
const logger = require('./logger');

/**
 * MAL API Client using Jikan v4 (unofficial MAL REST API)
 * Docs: https://docs.api.jikan.moe/
 */
class MALClient {
  constructor() {
    this.baseUrl = 'https://api.jikan.moe/v4';
    this.cache = new Map();
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    this.rateLimitDelay = 334; // ~3 requests per second (1000ms / 3 = 333ms)
    this.lastRequestTime = 0;
  }

  /**
   * Rate limiting: ensure we don't exceed 3 requests per second
   */
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Get cached data if available and not expired
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    const isExpired = Date.now() - cached.timestamp > this.cacheExpiry;
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  /**
   * Store data in cache
   */
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Search for anime by name
   * @param {string} query - Anime name to search for
   * @param {number} limit - Max results (default: 5)
   * @returns {Array} - Array of anime results
   */
  async searchAnime(query, limit = 5) {
    try {
      const cacheKey = `search:${query.toLowerCase()}`;
      const cached = this.getCached(cacheKey);
      
      if (cached) {
        logger.info(`MAL cache hit for search: "${query}"`);
        return cached;
      }

      await this.waitForRateLimit();
      
      logger.info(`Searching MAL for: "${query}"`);
      
      const response = await axios.get(`${this.baseUrl}/anime`, {
        params: {
          q: query,
          limit: limit,
          sfw: false, // Include adult content
          order_by: 'popularity',
          sort: 'asc'
        },
        timeout: 5000
      });

      const results = response.data.data || [];
      this.setCache(cacheKey, results);
      
      logger.info(`MAL found ${results.length} results for "${query}"`);
      
      return results;

    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn('MAL rate limit hit, waiting 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.searchAnime(query, limit); // Retry
      }
      
      logger.error(`Error searching MAL for "${query}":`, error.message);
      return [];
    }
  }

  /**
   * Get detailed anime information by MAL ID
   * @param {number} malId - MAL anime ID
   * @returns {Object|null} - Anime details
   */
  async getAnimeDetails(malId) {
    try {
      const cacheKey = `anime:${malId}`;
      const cached = this.getCached(cacheKey);
      
      if (cached) {
        logger.info(`MAL cache hit for anime ID: ${malId}`);
        return cached;
      }

      await this.waitForRateLimit();
      
      logger.info(`Fetching MAL details for anime ID: ${malId}`);
      
      const response = await axios.get(`${this.baseUrl}/anime/${malId}`, {
        timeout: 5000
      });

      const anime = response.data.data;
      this.setCache(cacheKey, anime);
      
      return anime;

    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn('MAL rate limit hit, waiting 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.getAnimeDetails(malId); // Retry
      }
      
      logger.error(`Error fetching MAL details for ID ${malId}:`, error.message);
      return null;
    }
  }

  /**
   * Find best match for a series name
   * @param {string} seriesName - Series name to match
   * @returns {Object|null} - Best matching anime or null
   */
  async findBestMatch(seriesName) {
    try {
      const results = await this.searchAnime(seriesName, 5);
      
      if (!results || results.length === 0) {
        return null;
      }

      // Return first result (sorted by popularity)
      const bestMatch = results[0];
      
      logger.info(`Best MAL match for "${seriesName}": "${bestMatch.title}" (ID: ${bestMatch.mal_id})`);
      
      return bestMatch;

    } catch (error) {
      logger.error(`Error finding best match for "${seriesName}":`, error.message);
      return null;
    }
  }

  /**
   * Enrich series data with MAL metadata
   * @param {Object} series - Series object from provider
   * @returns {Object} - Enriched series object
   */
  async enrichSeries(series) {
    try {
      const malData = await this.findBestMatch(series.name);
      
      if (!malData) {
        // No MAL match - apply rating fallback
        logger.info(`No MAL match for "${series.name}", using fallback`);
        return {
          ...series,
          rating: series.rating ? series.rating - 1.0 : null
        };
      }

      // Enrich with MAL data
      return {
        ...series,
        name: series.name, // Keep provider title (Japanese romanized)
        englishTitle: malData.title_english || malData.title, // Ghost field for search
        rating: malData.score || series.rating, // MAL rating preferred
        description: malData.synopsis || series.description,
        genres: malData.genres?.map(g => g.name) || series.genres,
        malId: malData.mal_id,
        year: malData.year || malData.aired?.prop?.from?.year,
        episodes: malData.episodes
      };

    } catch (error) {
      logger.error(`Error enriching series "${series.name}":`, error.message);
      return series; // Return original on error
    }
  }
}

module.exports = new MALClient();
