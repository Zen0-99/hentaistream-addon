/**
 * Slug Registry - Stores real episode slugs discovered during catalog/search
 * 
 * This solves the problem where HentaiTV (and other providers) have unpredictable
 * episode slug formats. Instead of guessing with multiple variations, we:
 * 1. Store real slugs when we discover them during catalog fetch
 * 2. Look them up during stream fetch for instant O(1) access
 * 
 * The registry persists to disk so it survives server restarts.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class SlugRegistry {
  constructor() {
    // In-memory cache: Map<key, realSlug>
    // Key format: "{provider}:{seriesSlug}:{episodeNum}"
    this.cache = new Map();
    
    // Disk persistence
    this.cacheDir = process.env.CACHE_DIR || path.join(process.cwd(), '.cache');
    this.diskFile = path.join(this.cacheDir, 'slug-registry.json');
    
    // Load from disk on startup
    this.loadFromDisk();
    
    // Periodic save to disk (every 5 minutes)
    this.saveInterval = setInterval(() => this.saveToDisk(), 5 * 60 * 1000);
    
    // Stats for debugging
    this.stats = {
      hits: 0,
      misses: 0,
      stores: 0
    };
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
   * @param {string} provider - Provider prefix
   * @param {string} seriesSlug - Normalized series slug
   * @param {number|string} episodeNum - Episode number
   * @returns {string|null} Real slug if found, null otherwise
   */
  get(provider, seriesSlug, episodeNum) {
    const key = this.makeKey(provider, seriesSlug, episodeNum);
    const realSlug = this.cache.get(key);
    
    if (realSlug) {
      this.stats.hits++;
      logger.debug(`[SlugRegistry] HIT: ${key} -> ${realSlug}`);
      return realSlug;
    }
    
    this.stats.misses++;
    return null;
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
   */
  loadFromDisk() {
    try {
      if (fs.existsSync(this.diskFile)) {
        const data = JSON.parse(fs.readFileSync(this.diskFile, 'utf8'));
        
        if (data && typeof data === 'object') {
          for (const [key, value] of Object.entries(data)) {
            this.cache.set(key, value);
          }
          logger.info(`[SlugRegistry] Loaded ${this.cache.size} slugs from disk`);
        }
      }
    } catch (error) {
      logger.warn(`[SlugRegistry] Failed to load from disk: ${error.message}`);
    }
  }

  /**
   * Save registry to disk
   */
  saveToDisk() {
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
   * Shutdown - save to disk
   */
  shutdown() {
    clearInterval(this.saveInterval);
    this.saveToDisk();
  }
}

// Export singleton instance
module.exports = new SlugRegistry();
