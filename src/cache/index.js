const lruCache = require('./lru');
const config = require('../config/env');
const logger = require('../utils/logger');

/**
 * Simplified cache manager using only LRU in-memory cache
 * for self-contained addon architecture
 */
class CacheManager {
  constructor() {
    this.lru = lruCache;
    logger.info('Cache manager initialized with LRU cache');
  }

  /**
   * Get value from cache
   */
  async get(key) {
    return this.lru.get(key);
  }

  /**
   * Set value in cache with TTL
   */
  async set(key, value, ttl) {
    this.lru.set(key, value, ttl);
    return true;
  }

  /**
   * Delete key from cache
   */
  async del(key) {
    this.lru.del(key);
    return true;
  }

  /**
   * Flush all cache
   */
  async flush() {
    this.lru.flush();
    logger.info('Cache flushed');
    return true;
  }

  /**
   * Generate cache key with namespace
   */
  key(type, id) {
    return `hentaistream:${type}:${id}`;
  }

  /**
   * Get TTL for specific cache type
   */
  getTTL(type) {
    return config.cache.ttl[type] || 3600;
  }

  /**
   * Cache wrapper for async functions
   */
  async wrap(key, ttl, fetchFunction) {
    // Try to get from cache first
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    try {
      const data = await fetchFunction();
      if (data) {
        await this.set(key, data, ttl);
      }
      return data;
    } catch (error) {
      logger.error(`Cache wrap error for key ${key}:`, error);
      throw error;
    }
  }
}

// Singleton instance
const cacheManager = new CacheManager();

module.exports = cacheManager;
