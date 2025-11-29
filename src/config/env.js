require('dotenv').config();

module.exports = {
  server: {
    port: parseInt(process.env.PORT) || 7000,
    env: process.env.NODE_ENV || 'development',
  },
  
  scraper: {
    userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    timeout: parseInt(process.env.REQUEST_TIMEOUT) || 10000,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
  },
  
  cache: {
    maxItems: parseInt(process.env.CACHE_MAX_ITEMS) || 500,
    ttl: {
      catalog: parseInt(process.env.CACHE_TTL_CATALOG) || 3600,
      meta: parseInt(process.env.CACHE_TTL_META) || 7200,
      stream: parseInt(process.env.CACHE_TTL_STREAM) || 300,
      search: parseInt(process.env.CACHE_TTL_SEARCH) || 900,
    },
  },
  
  addon: {
    name: process.env.ADDON_NAME || 'HentaiStream',
    id: process.env.ADDON_ID || 'com.hentaistream.addon',
    version: process.env.ADDON_VERSION || '0.1.0',
    description: process.env.ADDON_DESCRIPTION || 'Adult anime streaming addon. 18+ only.',
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
