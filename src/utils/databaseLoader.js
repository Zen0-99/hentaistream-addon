/**
 * Database Loader
 * 
 * Loads the pre-bundled catalog database at startup.
 * Provides fast lookups for series metadata without scraping.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const logger = require('./logger');

// Paths to database files
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CATALOG_GZ = path.join(DATA_DIR, 'catalog.json.gz');
const CATALOG_JSON = path.join(DATA_DIR, 'catalog.json');

// In-memory database
let database = null;
let loadError = null;
let isLoading = false;

/**
 * Load the database from disk
 * Prefers gzipped version for smaller bundle size
 */
async function loadDatabase() {
  if (database) return database;
  if (isLoading) {
    // Wait for existing load to complete
    while (isLoading) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return database;
  }
  
  isLoading = true;
  
  try {
    let rawData;
    
    // Try gzipped version first
    if (fs.existsSync(CATALOG_GZ)) {
      logger.info(`📦 Loading database from ${CATALOG_GZ}...`);
      const compressed = fs.readFileSync(CATALOG_GZ);
      rawData = zlib.gunzipSync(compressed).toString('utf-8');
    } 
    // Fallback to uncompressed
    else if (fs.existsSync(CATALOG_JSON)) {
      logger.info(`📄 Loading database from ${CATALOG_JSON}...`);
      rawData = fs.readFileSync(CATALOG_JSON, 'utf-8');
    } 
    // No database available
    else {
      logger.warn('⚠️ No pre-bundled database found. Will scrape on demand.');
      database = createEmptyDatabase();
      isLoading = false;
      return database;
    }
    
    database = JSON.parse(rawData);
    
    // Build lookup indices for fast access
    buildIndices(database);
    
    logger.info(`✅ Database loaded: ${database.stats?.totalSeries || 0} series from ${Object.keys(database.providers || {}).length} providers`);
    logger.info(`📅 Build date: ${database.buildDate || 'unknown'}`);
    
  } catch (error) {
    logger.error(`❌ Failed to load database: ${error.message}`);
    loadError = error;
    database = createEmptyDatabase();
  } finally {
    isLoading = false;
  }
  
  return database;
}

/**
 * Create an empty database structure
 */
function createEmptyDatabase() {
  return {
    version: 0,
    buildDate: null,
    providers: {},
    catalog: [],
    slugRegistry: {},
    stats: { totalSeries: 0, byProvider: {} },
    _indices: {
      byId: new Map(),
      bySlug: new Map(),
      byProvider: new Map()
    }
  };
}

/**
 * Build lookup indices for fast access
 */
function buildIndices(db) {
  db._indices = {
    byId: new Map(),
    bySlug: new Map(),
    byProvider: new Map()
  };
  
  for (const item of db.catalog || []) {
    // Index by full ID
    db._indices.byId.set(item.id, item);
    
    // Index by slug (ID without provider prefix)
    const slug = extractSlug(item.id);
    if (!db._indices.bySlug.has(slug)) {
      db._indices.bySlug.set(slug, []);
    }
    db._indices.bySlug.get(slug).push(item);
    
    // Index by provider
    const provider = item.provider || item.id.split('-')[0];
    if (!db._indices.byProvider.has(provider)) {
      db._indices.byProvider.set(provider, []);
    }
    db._indices.byProvider.get(provider).push(item);
  }
  
  logger.debug(`Built indices: ${db._indices.byId.size} IDs, ${db._indices.bySlug.size} slugs`);
}

/**
 * Extract slug from an ID
 */
function extractSlug(id) {
  // Remove provider prefix (e.g., "hmm-", "hse-", "htv-")
  return id.replace(/^(hmm|hse|htv|hentaimama|hentaisea|hentaitv)-/, '');
}

/**
 * Get a series by ID
 */
function getById(id) {
  if (!database) return null;
  return database._indices?.byId?.get(id) || null;
}

/**
 * Get all series matching a slug across providers
 */
function getBySlug(slug) {
  if (!database) return [];
  return database._indices?.bySlug?.get(slug) || [];
}

/**
 * Get all series from a specific provider
 */
function getByProvider(provider) {
  if (!database) return [];
  return database._indices?.byProvider?.get(provider) || [];
}

/**
 * Get merged data for a slug using priority-based rating
 */
function getMergedBySlug(slug) {
  const items = getBySlug(slug);
  if (items.length === 0) return null;
  
  // Sort by provider priority: hmm > htv > hse
  const priorityOrder = ['hmm', 'htv', 'hse'];
  items.sort((a, b) => {
    const aProvider = a.provider || a.id.split('-')[0];
    const bProvider = b.provider || b.id.split('-')[0];
    return priorityOrder.indexOf(aProvider) - priorityOrder.indexOf(bProvider);
  });
  
  // Merge items, preferring higher priority providers
  const merged = { ...items[0] };
  merged.providers = [];
  merged.ratingBreakdown = {};
  
  for (const item of items) {
    const provider = item.provider || item.id.split('-')[0];
    merged.providers.push(provider);
    
    // Build rating breakdown
    if (item.rating !== undefined && item.rating !== null) {
      merged.ratingBreakdown[provider] = {
        raw: item.rating,
        type: item.ratingType || 'direct'
      };
    } else if (item.viewCount !== undefined) {
      merged.ratingBreakdown[provider] = {
        raw: item.viewCount,
        type: 'views'
      };
    }
    
    // Merge missing fields from lower priority providers
    if (!merged.poster && item.poster) merged.poster = item.poster;
    if (!merged.description && item.description) merged.description = item.description;
    if (!merged.year && item.year) merged.year = item.year;
    if (!merged.genres && item.genres) merged.genres = item.genres;
    if (!merged.studio && item.studio) merged.studio = item.studio;
  }
  
  return merged;
}

/**
 * Get all catalog items for a provider
 * Returns ALL items without pagination - pagination should be done by caller
 */
function getCatalog(provider = null) {
  if (!database) return [];
  
  // Filter by provider if specified, otherwise return all
  if (provider) {
    return getByProvider(provider);
  }
  
  // Return full catalog (caller handles pagination)
  return database.catalog || [];
}

/**
 * Check if database is loaded and has data
 */
function isReady() {
  return database !== null && database.stats?.totalSeries > 0;
}

/**
 * Get database stats
 */
function getStats() {
  if (!database) return null;
  return {
    ...database.stats,
    buildDate: database.buildDate,
    version: database.version
  };
}

/**
 * Get slug registry entry
 */
function getSlugRegistry(slug) {
  if (!database) return null;
  return database.slugRegistry?.[slug] || null;
}

/**
 * Get the newest content date in the database
 * Used to determine what content needs to be scraped fresh
 * @returns {Date|null} The newest lastUpdated date, or null if no dates found
 */
function getNewestContentDate() {
  if (!database || !database.catalog || database.catalog.length === 0) return null;
  
  let newestDate = null;
  for (const item of database.catalog) {
    if (item.lastUpdated) {
      const itemDate = new Date(item.lastUpdated);
      if (!isNaN(itemDate.getTime()) && (!newestDate || itemDate > newestDate)) {
        newestDate = itemDate;
      }
    }
  }
  return newestDate;
}

/**
 * Get the database build date
 * @returns {Date|null}
 */
function getBuildDate() {
  if (!database || !database.buildDate) return null;
  return new Date(database.buildDate);
}

module.exports = {
  loadDatabase,
  getById,
  getBySlug,
  getByProvider,
  getMergedBySlug,
  getCatalog,
  isReady,
  getStats,
  getSlugRegistry,
  extractSlug,
  getNewestContentDate,
  getBuildDate
};
