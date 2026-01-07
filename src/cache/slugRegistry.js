/**
 * Slug Registry - Stores real episode slugs discovered during catalog/search
 * 
 * This solves the problem where HentaiTV (and other providers) have unpredictable
 * episode slug formats. Instead of guessing with multiple variations, we:
 * 1. CHECK DATABASE FIRST - Pre-bundled slugs are instant (no disk I/O)
 * 2. Fall back to runtime discovery for new content not in database
 * 3. Store discovered slugs in memory + disk for persistence
 * 
 * With the pre-bundled database, most lookups hit the database and skip disk entirely.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Lazy load databaseLoader to avoid circular dependency
let databaseLoader = null;
function getDatabase() {
  if (!databaseLoader) {
    databaseLoader = require('../utils/databaseLoader');
  }
  return databaseLoader;
}

class SlugRegistry {
  constructor() {
    // In-memory cache: Map<key, realSlug>
    // Key format: "{provider}:{seriesSlug}:{episodeNum}"
    this.cache = new Map();
    
    // Disk persistence
    this.cacheDir = process.env.CACHE_DIR || path.join(process.cwd(), '.cache');
    this.diskFile = path.join(this.cacheDir, 'slug-registry.json');
    
    // Database mode: when true, skip disk operations (database has all slugs)
    this.databaseMode = false;
    
    // Load from disk on startup (only if not in database mode)
    this.loadFromDisk();
    
    // Periodic save to disk (every 5 minutes) - only if not in database mode
    this.saveInterval = setInterval(() => {
      if (!this.databaseMode) {
        this.saveToDisk();
      }
    }, 5 * 60 * 1000);
    
    // Stats for debugging
    this.stats = {
      hits: 0,
      misses: 0,
      stores: 0
    };
  }
  
  /**
   * Enable database mode - disables disk operations since database has all slugs
   */
  enableDatabaseMode() {
    this.databaseMode = true;
    logger.info('[SlugRegistry] Database mode enabled - disk operations disabled');
    
    // Clean up disk file if it exists
    try {
      if (fs.existsSync(this.diskFile)) {
        fs.unlinkSync(this.diskFile);
        logger.debug('[SlugRegistry] Removed disk cache file (database mode)');
      }
    } catch (err) {
      logger.debug(`[SlugRegistry] Could not remove disk file: ${err.message}`);
    }
  }

  /**
   * Generate cache key
   * @param {string} provider - Provider prefix (e.g., 'htv', 'hse', 'hmm')
   * @param {string} seriesSlug - Normalized series slug
   * @param {number|string} episodeNum - Episode number
   * @returns {string} Cache key
   */
  makeKey(provider, seriesSlug, episodeNum) {
    // Normalize the series slug for consistent lookups
    const normalizedSeries = seriesSlug
      .toLowerCase()
      .replace(/^(htv-|hse-|hmm-)/, '') // Remove provider prefixes
      .replace(/-the-animation$/, '')    // Normalize animation suffix
      .replace(/-episode-\d+$/, '')      // Remove episode suffix
      .trim();
    
    return `${provider}:${normalizedSeries}:${episodeNum}`;
  }

  /**
   * Store a real episode slug
   * @param {string} provider - Provider prefix (e.g., 'htv')
   * @param {string} seriesSlug - Normalized series slug
   * @param {number|string} episodeNum - Episode number
   * @param {string} realSlug - The actual slug that works on the provider
   */
  set(provider, seriesSlug, episodeNum, realSlug) {
    if (!provider || !seriesSlug || !episodeNum || !realSlug) {
      return;
    }
    
    const key = this.makeKey(provider, seriesSlug, episodeNum);
    
    // Only store if different from what we'd guess
    const guessedSlug = `${seriesSlug}-episode-${episodeNum}`;
    if (realSlug !== guessedSlug) {
      this.cache.set(key, realSlug);
      this.stats.stores++;
      logger.debug(`[SlugRegistry] Stored: ${key} -> ${realSlug}`);
    }
  }

  /**
   * Store multiple episode slugs for a series at once
   * @param {string} provider - Provider prefix
   * @param {string} seriesSlug - Normalized series slug
   * @param {Object} episodeSlugs - Map of episodeNum -> realSlug
   */
  setMultiple(provider, seriesSlug, episodeSlugs) {
    if (!episodeSlugs || typeof episodeSlugs !== 'object') {
      return;
    }
    
    for (const [episodeNum, realSlug] of Object.entries(episodeSlugs)) {
      this.set(provider, seriesSlug, episodeNum, realSlug);
    }
  }

  /**
   * Get a real episode slug
   * Priority: 1) Memory cache 2) Pre-bundled database 3) null (miss)
   * @param {string} provider - Provider prefix
   * @param {string} seriesSlug - Normalized series slug
   * @param {number|string} episodeNum - Episode number
   * @returns {string|null} Real slug if found, null otherwise
   */
  get(provider, seriesSlug, episodeNum) {
    const key = this.makeKey(provider, seriesSlug, episodeNum);
    
    // 1. Check runtime memory cache first (fastest)
    const memorySlug = this.cache.get(key);
    if (memorySlug) {
      this.stats.hits++;
      logger.debug(`[SlugRegistry] MEMORY HIT: ${key} -> ${memorySlug}`);
      return memorySlug;
    }
    
    // 2. Check pre-bundled database (no disk I/O, very fast)
    const dbSlug = this._getFromDatabase(provider, seriesSlug, episodeNum);
    if (dbSlug) {
      this.stats.hits++;
      // Also store in memory for faster future lookups
      this.cache.set(key, dbSlug);
      logger.debug(`[SlugRegistry] DB HIT: ${key} -> ${dbSlug}`);
      return dbSlug;
    }
    
    this.stats.misses++;
    return null;
  }
  
  /**
   * Get slug from pre-bundled database
   * @private
   */
  _getFromDatabase(provider, seriesSlug, episodeNum) {
    try {
      const db = getDatabase();
      if (!db.isReady()) return null;
      
      // Build the series ID for database lookup
      const seriesId = `${provider}-${seriesSlug}`;
      const item = db.getById(seriesId);
      
      if (item && item.knownSlugs && item.knownSlugs[episodeNum]) {
        return item.knownSlugs[episodeNum];
      }
      
      return null;
    } catch (error) {
      logger.debug(`[SlugRegistry] DB lookup error: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if we have a slug for this episode
   * @param {string} provider - Provider prefix
   * @param {string} seriesSlug - Normalized series slug
   * @param {number|string} episodeNum - Episode number
   * @returns {boolean}
   */
  has(provider, seriesSlug, episodeNum) {
    const key = this.makeKey(provider, seriesSlug, episodeNum);
    return this.cache.has(key);
  }

  /**
   * Get all known slugs for a series
   * @param {string} provider - Provider prefix
   * @param {string} seriesSlug - Normalized series slug
   * @returns {Object} Map of episodeNum -> realSlug
   */
  getSeriesSlugs(provider, seriesSlug) {
    const prefix = this.makeKey(provider, seriesSlug, '').slice(0, -1); // Remove trailing episode num
    const result = {};
    
    for (const [key, value] of this.cache.entries()) {
      if (key.startsWith(prefix)) {
        const episodeNum = key.split(':').pop();
        result[episodeNum] = value;
      }
    }
    
    return result;
  }

  /**
   * Load registry from disk
   * Note: With pre-bundled database, disk cache is mainly for NEW content
   * discovered after the database was built. Most lookups hit the database.
   */
  loadFromDisk() {
    // Skip disk loading if in database mode
    if (this.databaseMode) {
      logger.info('[SlugRegistry] Skipping disk load (database mode)');
      return;
    }
    
    try {
      // Check if database is ready - if so, disk loading is less critical
      const db = getDatabase();
      const dbReady = db.isReady();
      
      if (fs.existsSync(this.diskFile)) {
        const data = JSON.parse(fs.readFileSync(this.diskFile, 'utf8'));
        
        if (data && typeof data === 'object') {
          for (const [key, value] of Object.entries(data)) {
            this.cache.set(key, value);
          }
          logger.info(`[SlugRegistry] Loaded ${this.cache.size} runtime slugs from disk${dbReady ? ' (database has pre-bundled slugs)' : ''}`);
        }
      } else if (dbReady) {
        logger.info(`[SlugRegistry] No disk cache, but database has pre-bundled slugs ready`);
      }
    } catch (error) {
      logger.warn(`[SlugRegistry] Failed to load from disk: ${error.message}`);
    }
  }

  /**
   * Save registry to disk
   */
  saveToDisk() {
    // Skip disk saving if in database mode
    if (this.databaseMode) {
      logger.debug('[SlugRegistry] Skipping disk save (database mode)');
      return;
    }
    
    try {
      // Ensure cache directory exists
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      
      // Convert Map to object for JSON serialization
      const data = Object.fromEntries(this.cache);
      
      fs.writeFileSync(this.diskFile, JSON.stringify(data, null, 2));
      logger.debug(`[SlugRegistry] Saved ${this.cache.size} slugs to disk`);
    } catch (error) {
      logger.warn(`[SlugRegistry] Failed to save to disk: ${error.message}`);
    }
  }

  /**
   * Get registry stats
   * @returns {Object} Stats object
   */
  getStats() {
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  /**
   * Clear the registry (for testing)
   */
  clear() {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, stores: 0 };
  }
  
  /**
   * Clear just the memory cache (keep stats for debugging)
   * Used during memory pressure situations
   */
  clearMemoryCache() {
    const sizeBefore = this.cache.size;
    this.cache.clear();
    logger.info(`[SlugRegistry] Cleared ${sizeBefore} entries from memory cache`);
  }

  /**
   * Shutdown - save to disk (only if not in database mode)
   */
  shutdown() {
    clearInterval(this.saveInterval);
    // Only save to disk if not in database mode
    if (!this.databaseMode) {
      this.saveToDisk();
    }
  }
}

// Export singleton instance
module.exports = new SlugRegistry();
