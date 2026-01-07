const { LRUCache } = require('lru-cache');
const logger = require('../utils/logger');

class LRUCacheWrapper {
  constructor(options = {}) {
    this.cache = new LRUCache({
      max: options.max || 100, // Further reduced for 512MB limit - streams are short-lived anyway
      maxSize: options.maxSize || 20 * 1024 * 1024, // 20MB total memory limit (was 40MB)
      sizeCalculation: (value) => {
        try {
          // Estimate memory size of cached value
          return JSON.stringify(value).length;
        } catch {
          return 1024; // 1KB fallback for non-serializable objects
        }
      },
      ttl: options.ttl || 1000 * 60 * 30, // 30 minutes default (was 1 hour) - streams expire faster
      updateAgeOnGet: true,
      updateAgeOnHas: false,
      // Aggressively dispose of old entries
      disposeAfter: (value, key) => {
        logger.debug(`[LRU] Disposed: ${key}`);
      }
    });

    logger.info('LRU cache initialized (20MB limit, 100 max entries)');
  }

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      logger.debug(`LRU Cache HIT: ${key}`);
      return value;
    }
    logger.debug(`LRU Cache MISS: ${key}`);
    return null;
  }

  set(key, value, ttl) {
    try {
      this.cache.set(key, value, { ttl: ttl ? ttl * 1000 : undefined });
      logger.debug(`LRU Cache SET: ${key}`);
      return true;
    } catch (error) {
      logger.error(`LRU cache set error for key ${key}:`, error);
      return false;
    }
  }

  del(key) {
    try {
      this.cache.delete(key);
      logger.debug(`LRU Cache DEL: ${key}`);
      return true;
    } catch (error) {
      logger.error(`LRU cache del error for key ${key}:`, error);
      return false;
    }
  }

  flush() {
    try {
      this.cache.clear();
      logger.info('LRU cache flushed');
      return true;
    } catch (error) {
      logger.error('LRU cache flush error:', error);
      return false;
    }
  }

  size() {
    return this.cache.size;
  }

  has(key) {
    return this.cache.has(key);
  }
}

// Singleton instance
const lruCache = new LRUCacheWrapper();

module.exports = lruCache;
