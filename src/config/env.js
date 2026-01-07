require('dotenv').config();

module.exports = {
  server: {
    port: parseInt(process.env.PORT) || 7000,
    env: process.env.NODE_ENV || 'development',
    // Base URL for the addon (required for logo and video proxy to work)
    // Render provides RENDER_EXTERNAL_URL automatically
    // Set BASE_URL manually for other platforms
    baseUrl: process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${parseInt(process.env.PORT) || 7000}`,
  },
  
  scraper: {
    userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    timeout: parseInt(process.env.REQUEST_TIMEOUT) || 10000,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
  },
  
  cache: {
    maxItems: parseInt(process.env.CACHE_MAX_ITEMS) || 100, // Reduced for 512MB limit
    ttl: {
      catalog: parseInt(process.env.CACHE_TTL_CATALOG) || 1800, // 30 min (was 1h) - database has data anyway
      meta: parseInt(process.env.CACHE_TTL_META) || 3600, // 1h (was 2h) - database has data anyway
      stream: parseInt(process.env.CACHE_TTL_STREAM) || 180, // 3 min (was 5 min) - streams expire quickly
      search: parseInt(process.env.CACHE_TTL_SEARCH) || 600, // 10 min (was 15 min)
    },
  },
  
  addon: {
    name: process.env.ADDON_NAME || 'HentaiStream',
    id: process.env.ADDON_ID || 'com.hentaistream.addon',
    version: process.env.ADDON_VERSION || '1.0.0',
    description: process.env.ADDON_DESCRIPTION || '18+ ONLY - Your one stop shop for all your favourite Hentai! The content is fetched from 3 Providers: HentaiMama, HentaiTV and HentaiSea. The addon has aggregated ratings from all sources, catalogs (Top Rated, Recent Releases, Animation Studios, Release Year as well as 100+ genre filters.'
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED === 'true',
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  },
};
