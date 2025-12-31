const lruCache = require('./lru');
const config = require('../config/env');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Two-Tier Cache Manager with Stale-While-Revalidate
 * 
 * Features:
 * - Fast LRU in-memory cache (primary)
 * - Persistent disk cache (secondary) for surviving restarts
 * - Stale-While-Revalidate: return stale data immediately, refresh in background
 * - Automatic disk cleanup on startup
 */
class CacheManager {
  constructor() {
    this.lru = lruCache;
    this.cacheDir = path.join(process.cwd(), '.cache');
    this.diskEnabled = true;
    this.staleWhileRevalidate = true;
    
    // Track pending background refreshes to prevent duplicate fetches
    this.pendingRefreshes = new Map();
    
    // TTL multipliers for disk cache (reduced since database has base data)
    // With pre-bundled database, disk cache is mainly for:
    // - New releases not in database
    // - Fresh metadata lookups
    // - Episode streams
    this.diskTTLMultiplier = 6; // Disk cache lives 6x longer than memory (was 24x)
    
    // Database mode: when true, skip disk cache entirely (database has all data)
    this.databaseMode = false;
    
    // Initialize disk cache directory
    this._initDiskCache();
    
    logger.info('Two-tier cache manager initialized (memory + disk + SWR)');
  }
  
  /**
   * Enable database mode - disables disk caching since database has all data
   * Call this when the pre-bundled database is ready
   */
  enableDatabaseMode() {
    this.databaseMode = true;
    this.diskEnabled = false;
    logger.info('[Cache] Database mode enabled - disk cache disabled (database has all data)');
    
    // Clean up .cache directory if it exists (was created before database mode enabled)
    this._cleanupCacheDir().catch(err => {
      logger.debug(`[Cache] Could not cleanup cache dir: ${err.message}`);
    });
  }
  
  /**
   * Cleanup the .cache directory when in database mode
   */
  async _cleanupCacheDir() {
    try {
      const fsSync = require('fs');
      if (fsSync.existsSync(this.cacheDir)) {
        const files = await fs.readdir(this.cacheDir);
        // Only delete if empty or only has our files
        for (const file of files) {
          const filePath = path.join(this.cacheDir, file);
          await fs.unlink(filePath);
        }
        await fs.rmdir(this.cacheDir);
        logger.info('[Cache] Cleaned up .cache directory (database mode)');
      }
    } catch (err) {
      // Directory not empty or other error, ignore
      logger.debug(`[Cache] Could not remove .cache dir: ${err.message}`);
    }
  }
  
  /**
   * Check if database mode is enabled
   */
  isDatabaseMode() {
    return this.databaseMode;
  }
  
  /**
   * Initialize disk cache directory and cleanup old entries
   */
  async _initDiskCache() {
    // Skip disk cache initialization if in database mode
    if (this.databaseMode) {
      logger.info('[Cache] Skipping disk cache init (database mode)');
      return;
    }
    
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      
      // Cleanup expired entries on startup
      const files = await fs.readdir(this.cacheDir);
      let cleaned = 0;
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.cacheDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const entry = JSON.parse(content);
          
          // Remove if expired
          if (entry.diskExpires && Date.now() > entry.diskExpires) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch (e) {
          // Corrupted file, remove it
          try {
            await fs.unlink(path.join(this.cacheDir, file));
            cleaned++;
          } catch (unlinkErr) {
            // Ignore
          }
        }
      }
      
      if (cleaned > 0) {
        logger.info(`[Cache] Cleaned ${cleaned} expired disk cache entries`);
      }
    } catch (error) {
      logger.warn(`[Cache] Disk cache init error: ${error.message}`);
      this.diskEnabled = false;
    }
  }
  
  /**
   * Hash a cache key for disk storage
   */
  _hashKey(key) {
    return crypto.createHash('md5').update(key).digest('hex');
  }
  
  /**
   * Get disk cache file path for a key
   */
  _getDiskPath(key) {
    return path.join(this.cacheDir, `${this._hashKey(key)}.json`);
  }
  
  /**
   * Get value from disk cache
   */
  async _getDisk(key) {
    if (!this.diskEnabled) return null;
    
    try {
      const filePath = this._getDiskPath(key);
      const content = await fs.readFile(filePath, 'utf-8');
      const entry = JSON.parse(content);
      
      return {
        value: entry.value,
        expires: entry.expires,
        diskExpires: entry.diskExpires,
        isStale: Date.now() > entry.expires
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Set value in disk cache
   */
  async _setDisk(key, value, memoryTTL) {
    if (!this.diskEnabled) return;
    
    try {
      const diskTTL = memoryTTL * this.diskTTLMultiplier;
      const entry = {
        key,
        value,
        expires: Date.now() + (memoryTTL * 1000),
        diskExpires: Date.now() + (diskTTL * 1000),
        createdAt: new Date().toISOString()
      };
      
      const filePath = this._getDiskPath(key);
      await fs.writeFile(filePath, JSON.stringify(entry), 'utf-8');
    } catch (error) {
      logger.debug(`[Cache] Disk write error for ${key}: ${error.message}`);
    }
  }
  
  /**
   * Delete from disk cache
   */
  async _delDisk(key) {
    if (!this.diskEnabled) return;
    
    try {
      const filePath = this._getDiskPath(key);
      await fs.unlink(filePath);
    } catch (error) {
      // File doesn't exist, ignore
    }
  }

  /**
   * Get value from cache (memory first, then disk)
   */
  async get(key) {
    // 1. Check memory cache
    const memoryValue = this.lru.get(key);
    if (memoryValue !== null) {
      return memoryValue;
    }
    
    // 2. Check disk cache
    const diskEntry = await this._getDisk(key);
    if (diskEntry) {
      // Restore to memory cache
      this.lru.set(key, diskEntry.value, config.cache.ttl.catalog);
      return diskEntry.value;
    }
    
    return null;
  }

  /**
   * Set value in cache (both memory and disk)
   */
  async set(key, value, ttl) {
    this.lru.set(key, value, ttl);
    await this._setDisk(key, value, ttl);
    return true;
  }

  /**
   * Delete key from cache (both memory and disk)
   */
  async del(key) {
    this.lru.del(key);
    await this._delDisk(key);
    return true;
  }

  /**
   * Flush all cache (memory only, preserves disk for disaster recovery)
   */
  async flush() {
    this.lru.flush();
    logger.info('Memory cache flushed (disk cache preserved)');
    return true;
  }
  
  /**
   * Flush all cache including disk
   */
  async flushAll() {
    this.lru.flush();
    
    if (this.diskEnabled) {
      try {
        const files = await fs.readdir(this.cacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            await fs.unlink(path.join(this.cacheDir, file));
          }
        }
        logger.info('All cache flushed (memory + disk)');
      } catch (error) {
        logger.warn(`[Cache] Disk flush error: ${error.message}`);
      }
    }
    
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
   * Cache wrapper with stale-while-revalidate support
   * 
   * Returns cached data immediately (even if stale), and refreshes in background
   */
  async wrap(key, ttl, fetchFunction) {
    // 1. Check memory cache (always fresh)
    const memoryValue = this.lru.get(key);
    if (memoryValue !== null) {
      return memoryValue;
    }
    
    // 2. Check disk cache (may be stale)
    const diskEntry = await this._getDisk(key);
    
    if (diskEntry) {
      if (!diskEntry.isStale) {
        // Fresh from disk - use it and restore to memory
        this.lru.set(key, diskEntry.value, ttl);
        return diskEntry.value;
      }
      
      // Stale but still within disk TTL - use SWR pattern
      if (this.staleWhileRevalidate && Date.now() < diskEntry.diskExpires) {
        // Restore stale value to memory
        this.lru.set(key, diskEntry.value, ttl);
        
        // Trigger background refresh (only if not already pending)
        if (!this.pendingRefreshes.has(key)) {
          this.pendingRefreshes.set(key, true);
          
          logger.debug(`[Cache] SWR: Returning stale data for ${key}, refreshing in background`);
          
          // Don't await - run in background
          fetchFunction()
            .then(freshData => {
              if (freshData) {
                this.set(key, freshData, ttl);
                logger.debug(`[Cache] SWR: Background refresh complete for ${key}`);
              }
            })
            .catch(err => {
              logger.debug(`[Cache] SWR: Background refresh failed for ${key}: ${err.message}`);
            })
            .finally(() => {
              this.pendingRefreshes.delete(key);
            });
        }
        
        return diskEntry.value;
      }
    }

    // 3. No cache or expired - fetch fresh data
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
  
  /**
   * Pre-warm cache with data (useful for startup)
   */
  async prewarm(key, ttl, fetchFunction) {
    try {
      const data = await fetchFunction();
      if (data) {
        await this.set(key, data, ttl);
        return true;
      }
    } catch (error) {
      logger.debug(`[Cache] Prewarm failed for ${key}: ${error.message}`);
    }
    return false;
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    return {
      memorySize: this.lru.size(),
      pendingRefreshes: this.pendingRefreshes.size,
      diskEnabled: this.diskEnabled,
      staleWhileRevalidate: this.staleWhileRevalidate
    };
  }
}

// Singleton instance
const cacheManager = new CacheManager();

module.exports = cacheManager;
