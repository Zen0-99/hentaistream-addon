const axios = require('axios');
const config = require('../config/env');
const logger = require('../utils/logger');

/**
 * Base scraper class that all content scrapers should extend
 * Provides HTTP client and common functionality for web scraping
 */
class BaseScraper {
  constructor(name) {
    this.name = name;
    
    // Create axios instance with scraper config
    this.client = axios.create({
      timeout: config.scraper.timeout,
      maxRetries: config.scraper.maxRetries,
      headers: {
        'User-Agent': config.scraper.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`[${this.name}] HTTP Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error(`[${this.name}] Request error:`, error);
        return Promise.reject(error);
      }
    );

    // Response interceptor with retry logic
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`[${this.name}] HTTP Response: ${response.status} ${response.config.url}`);
        return response;
      },
      async (error) => {
        const config = error.config;
        
        if (!config || !config.retry) {
          config.retry = 0;
        }
        
        config.retry += 1;
        
        if (config.retry <= config.maxRetries && error.code === 'ECONNABORTED') {
          logger.warn(`[${this.name}] Retrying request (${config.retry}/${config.maxRetries})`);
          return this.client(config);
        }
        
        if (error.response) {
          logger.error(`[${this.name}] HTTP error ${error.response.status}:`, error.response.statusText);
        } else if (error.request) {
          logger.error(`[${this.name}] No response received:`, error.message);
        } else {
          logger.error(`[${this.name}] Request setup error:`, error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Search for content by query
   * @param {string} query - Search query
   * @param {number} limit - Number of results to return
   * @returns {Promise<Array>} Array of search results
   */
  async search(query, limit = 20) {
    throw new Error(`search() must be implemented by ${this.name} scraper`);
  }

  /**
   * Get detailed metadata for a specific item
   * @param {string} id - Content ID
   * @returns {Promise<Object>} Metadata object
   */
  async getMeta(id) {
    throw new Error(`getMeta() must be implemented by ${this.name} scraper`);
  }

  /**
   * Get stream URLs for a specific episode/video
   * @param {string} id - Video ID
   * @returns {Promise<Array>} Array of stream objects
   */
  async getStreams(id) {
    throw new Error(`getStreams() must be implemented by ${this.name} scraper`);
  }

  /**
   * Get catalog/browse results
   * @param {number} skip - Number of items to skip (pagination)
   * @param {number} limit - Number of items to return
   * @param {string} genre - Optional genre filter
   * @returns {Promise<Array>} Array of catalog items
   */
  async getCatalog(skip = 0, limit = 20, genre = null) {
    throw new Error(`getCatalog() must be implemented by ${this.name} scraper`);
  }

  /**
   * Get available genres/tags
   * @returns {Promise<Array>} Array of genre/tag names
   */
  async getGenres() {
    // Optional method, scrapers can override
    return [];
  }

  /**
   * Handle scraping errors gracefully
   * @param {Error} error - The error object
   * @param {string} operation - The operation that failed
   * @returns {null|Array} Returns null or empty array depending on operation
   */
  handleError(error, operation) {
    if (error.response) {
      logger.error(`[${this.name}] ${operation} failed with status ${error.response.status}`);
    } else if (error.request) {
      logger.error(`[${this.name}] ${operation} failed - no response received`);
    } else {
      logger.error(`[${this.name}] ${operation} failed:`, error.message);
    }
    
    // Return empty results instead of throwing
    const opStr = typeof operation === 'string' ? operation : 'unknown';
    return opStr.includes('Stream') || opStr.includes('Catalog') ? [] : null;
  }

  /**
   * Sanitize and validate content ID
   * @param {string} id - Content ID to validate
   * @returns {string} Sanitized ID
   */
  sanitizeId(id) {
    if (!id || typeof id !== 'string') {
      throw new Error('Invalid content ID');
    }
    // Remove scraper prefix if present
    return id.replace(/^[a-z]+-/, '');
  }

  /**
   * Extract scraper name from full ID
   * @param {string} fullId - Full ID with scraper prefix
   * @returns {string} Scraper name
   */
  static getScraperFromId(fullId) {
    const match = fullId.match(/^([a-z]+)-/);
    return match ? match[1] : null;
  }
}

module.exports = BaseScraper;
