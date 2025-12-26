/**
 * Optimized HTTP Client for HentaiStream Addon
 * 
 * Features:
 * - Undici for HTTP/2 multiplexing and connection pooling
 * - p-limit for controlled concurrency
 * - Batch URL fetching via Cloudflare Worker
 * - Automatic keep-alive and connection reuse
 * - DNS pre-resolution
 */

const { Pool, Agent, setGlobalDispatcher } = require('undici');
const pLimit = require('p-limit');
const logger = require('./logger');

// Cloudflare Worker proxy URL
const CF_PROXY_URL = process.env.CF_PROXY_URL || null;

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Global agent with optimized settings
const globalAgent = new Agent({
  keepAliveTimeout: 30000,      // Keep connections alive for 30s
  keepAliveMaxTimeout: 60000,   // Max keep-alive 60s
  pipelining: 6,                // HTTP pipelining depth
  connections: 50,              // Max connections per origin
  connect: {
    timeout: 10000,             // Connection timeout 10s
    rejectUnauthorized: true,
  },
});

// Set as global dispatcher for all undici requests
setGlobalDispatcher(globalAgent);

// Connection pools per domain for maximum reuse
const pools = new Map();

function getPool(origin) {
  if (!pools.has(origin)) {
    pools.set(origin, new Pool(origin, {
      connections: 20,           // Max parallel connections to this origin
      pipelining: 6,             // HTTP pipelining depth
      keepAliveTimeout: 30000,
      keepAliveMaxTimeout: 60000,
    }));
    logger.debug(`[HttpClient] Created connection pool for ${origin}`);
  }
  return pools.get(origin);
}

// Concurrency limiters
const limiters = {
  default: pLimit(15),          // General concurrency limit
  cfProxy: pLimit(25),          // Higher limit for CF Worker (it handles parallelism)
  perHost: new Map(),           // Per-host limiters
};

function getHostLimiter(host) {
  if (!limiters.perHost.has(host)) {
    limiters.perHost.set(host, pLimit(10)); // 10 concurrent per host
  }
  return limiters.perHost.get(host);
}

/**
 * Build browser-like headers
 */
function buildHeaders(customUA = null) {
  return {
    'User-Agent': customUA || getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };
}

/**
 * Fetch a single URL using undici with connection pooling
 * @param {string} url - URL to fetch
 * @param {object} options - Request options
 * @returns {Promise<{data: string, status: number}>}
 */
async function fetch(url, options = {}) {
  const { Pool, request } = require('undici');
  const urlObj = new URL(url);
  const pool = getPool(urlObj.origin);
  const limiter = getHostLimiter(urlObj.host);
  
  return limiter(async () => {
    try {
      const { statusCode, headers, body } = await pool.request({
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: {
          ...buildHeaders(),
          ...options.headers,
        },
        bodyTimeout: options.timeout || 15000,
        headersTimeout: options.timeout || 15000,
      });
      
      const data = await body.text();
      
      return { data, status: statusCode, headers };
    } catch (error) {
      logger.debug(`[HttpClient] Fetch error for ${url}: ${error.message}`);
      throw error;
    }
  });
}

/**
 * Fetch a URL via Cloudflare Worker proxy (for sites with Cloudflare protection)
 * @param {string} url - Target URL
 * @param {object} options - Request options
 * @returns {Promise<{data: string, status: number}>}
 */
async function fetchViaProxy(url, options = {}) {
  if (!CF_PROXY_URL) {
    // Fall back to direct fetch if no proxy configured
    return fetch(url, options);
  }
  
  return limiters.cfProxy(async () => {
    try {
      const proxyUrl = new URL(CF_PROXY_URL);
      proxyUrl.searchParams.set('url', url);
      
      if (options.method === 'POST') {
        proxyUrl.searchParams.set('method', 'POST');
        if (options.body) {
          proxyUrl.searchParams.set('body', options.body);
        }
      }
      
      const response = await fetch(proxyUrl.toString(), {
        timeout: options.timeout || 30000,
      });
      
      // Check for proxied 403
      const proxiedStatus = response.headers?.['x-proxied-status'];
      if (proxiedStatus === '403') {
        throw { status: 403, message: 'Forbidden (via proxy)' };
      }
      
      return response;
    } catch (error) {
      logger.debug(`[HttpClient] Proxy fetch error for ${url}: ${error.message}`);
      throw error;
    }
  });
}

/**
 * Batch fetch multiple URLs via Cloudflare Worker in a single request
 * This is the KEY optimization - 20 URLs in 1 HTTP request!
 * 
 * @param {string[]} urls - Array of URLs to fetch
 * @param {object} options - Request options
 * @returns {Promise<Array<{url: string, status: number, body: string, success: boolean}>>}
 */
async function batchFetch(urls, options = {}) {
  if (!CF_PROXY_URL) {
    // Fall back to parallel individual fetches
    logger.warn('[HttpClient] No CF_PROXY_URL set, falling back to parallel fetch');
    return Promise.all(urls.map(async (url) => {
      try {
        const result = await fetch(url, options);
        return { url, status: result.status, body: result.data, success: result.status < 400 };
      } catch (error) {
        return { url, status: 0, error: error.message, success: false };
      }
    }));
  }
  
  const BATCH_SIZE = 15; // URLs per batch request (CF Worker handles up to 20)
  const results = [];
  
  // Split URLs into batches
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    
    try {
      const proxyUrl = new URL(CF_PROXY_URL);
      // Encode URLs and join with comma
      const encodedUrls = batch.map(u => encodeURIComponent(u)).join(',');
      proxyUrl.searchParams.set('urls', encodedUrls);
      
      if (options.method === 'POST' && options.body) {
        proxyUrl.searchParams.set('method', 'POST');
        proxyUrl.searchParams.set('body', encodeURIComponent(options.body));
      }
      
      logger.info(`[HttpClient] Batch fetching ${batch.length} URLs via CF Worker`);
      
      const response = await fetch(proxyUrl.toString(), {
        timeout: options.timeout || 45000, // Longer timeout for batch
      });
      
      // Parse JSON response from batch endpoint
      const batchResults = JSON.parse(response.data);
      
      if (Array.isArray(batchResults)) {
        results.push(...batchResults);
        logger.info(`[HttpClient] Batch complete: ${batchResults.filter(r => r.success).length}/${batchResults.length} successful`);
      } else {
        // Error response
        logger.error(`[HttpClient] Batch error: ${batchResults.error || 'Unknown error'}`);
        batch.forEach(url => results.push({ url, status: 0, error: batchResults.error, success: false }));
      }
    } catch (error) {
      logger.error(`[HttpClient] Batch request failed: ${error.message}`);
      // Mark all URLs in this batch as failed
      batch.forEach(url => results.push({ url, status: 0, error: error.message, success: false }));
    }
  }
  
  return results;
}

/**
 * Fetch multiple URLs with controlled concurrency (not batched)
 * Use this when you need individual responses immediately
 * 
 * @param {string[]} urls - Array of URLs to fetch
 * @param {object} options - Request options
 * @param {number} options.concurrency - Max concurrent requests (default: 15)
 * @param {boolean} options.useProxy - Whether to use CF proxy (default: false)
 * @returns {Promise<Array<{url: string, data: string, status: number, error?: string}>>}
 */
async function parallelFetch(urls, options = {}) {
  const concurrency = options.concurrency || 15;
  const limit = pLimit(concurrency);
  const fetchFn = options.useProxy ? fetchViaProxy : fetch;
  
  logger.info(`[HttpClient] Parallel fetching ${urls.length} URLs (concurrency: ${concurrency})`);
  
  const promises = urls.map((url, index) =>
    limit(async () => {
      try {
        const result = await fetchFn(url, options);
        return { url, data: result.data, status: result.status, index };
      } catch (error) {
        return { url, data: null, status: 0, error: error.message, index };
      }
    })
  );
  
  const results = await Promise.all(promises);
  
  // Sort by original index to maintain order
  results.sort((a, b) => a.index - b.index);
  
  const successCount = results.filter(r => r.status >= 200 && r.status < 400).length;
  logger.info(`[HttpClient] Parallel fetch complete: ${successCount}/${urls.length} successful`);
  
  return results;
}

/**
 * Pre-warm DNS for known hosts (call on startup)
 */
async function prewarmConnections() {
  const hosts = [
    'https://hentaimama.io',
    'https://hentaisea.com',
    'https://hentai.tv',
  ];
  
  logger.info('[HttpClient] Pre-warming connection pools...');
  
  // Just create pools - they'll establish connections on first use
  hosts.forEach(origin => getPool(origin));
  
  // If CF proxy is configured, warm that too
  if (CF_PROXY_URL) {
    try {
      const proxyUrl = new URL(CF_PROXY_URL);
      getPool(proxyUrl.origin);
      
      // Do a quick health check
      await fetch(`${CF_PROXY_URL}?url=${encodeURIComponent('https://hentaimama.io/robots.txt')}`, {
        timeout: 5000,
      });
      logger.info('[HttpClient] CF Worker proxy is responsive');
    } catch (error) {
      logger.warn(`[HttpClient] CF Worker proxy warmup failed: ${error.message}`);
    }
  }
  
  logger.info('[HttpClient] Connection pools ready');
}

/**
 * Close all connection pools (call on shutdown)
 */
async function closeAll() {
  for (const pool of pools.values()) {
    await pool.close();
  }
  pools.clear();
  await globalAgent.close();
  logger.info('[HttpClient] All connections closed');
}

module.exports = {
  fetch,
  fetchViaProxy,
  batchFetch,
  parallelFetch,
  prewarmConnections,
  closeAll,
  buildHeaders,
  getRandomUserAgent,
  // Export limiters for custom use
  limiters,
  pLimit,
};
