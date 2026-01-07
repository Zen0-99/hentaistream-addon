/**
 * Optimized HTTP Client for HentaiStream Addon
 * 
 * Features:
 * - Undici for HTTP/2 multiplexing and connection pooling
 * - p-limit for controlled concurrency
 * - Batch URL fetching via Cloudflare Worker
 * - Automatic keep-alive and connection reuse
 * - DNS pre-resolution
 * 
 * MEMORY OPTIMIZATION: Reduced connection pools for 512MB limit
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

// Global agent with REDUCED settings for 512MB memory limit
const globalAgent = new Agent({
  keepAliveTimeout: 15000,      // Reduced: Keep connections alive for 15s (was 30s)
  keepAliveMaxTimeout: 30000,   // Reduced: Max keep-alive 30s (was 60s)
  pipelining: 4,                // Reduced: HTTP pipelining depth (was 6)
  connections: 20,              // Reduced: Max connections per origin (was 50)
  connect: {
    timeout: 10000,             // Connection timeout 10s
    rejectUnauthorized: true,
  },
});

// Set as global dispatcher for all undici requests
setGlobalDispatcher(globalAgent);

// Connection pools per domain for maximum reuse - with size limit
const pools = new Map();
const MAX_POOLS = 5; // Limit total pools to prevent memory buildup

function getPool(origin) {
  if (!pools.has(origin)) {
    // Cleanup old pools if we hit the limit
    if (pools.size >= MAX_POOLS) {
      const oldestKey = pools.keys().next().value;
      const oldPool = pools.get(oldestKey);
      oldPool.close().catch(() => {});
      pools.delete(oldestKey);
      logger.debug(`[HttpClient] Closed old pool for ${oldestKey} (limit reached)`);
    }
    
    pools.set(origin, new Pool(origin, {
      connections: 10,           // Reduced: Max parallel connections (was 20)
      pipelining: 4,             // Reduced: HTTP pipelining depth (was 6)
      keepAliveTimeout: 15000,   // Reduced
      keepAliveMaxTimeout: 30000,
    }));
    logger.debug(`[HttpClient] Created connection pool for ${origin} (${pools.size}/${MAX_POOLS})`);
  }
  return pools.get(origin);
}

// Concurrency limiters - reduced for memory
const limiters = {
  default: pLimit(8),           // Reduced: General concurrency (was 15)
  cfProxy: pLimit(15),          // Reduced: CF Worker limit (was 25)
  perHost: new Map(),           // Per-host limiters
};

// Limit per-host limiter count
const MAX_HOST_LIMITERS = 10;

function getHostLimiter(host) {
  if (!limiters.perHost.has(host)) {
    // Cleanup if too many
    if (limiters.perHost.size >= MAX_HOST_LIMITERS) {
      const oldestKey = limiters.perHost.keys().next().value;
      limiters.perHost.delete(oldestKey);
    }
    limiters.perHost.set(host, pLimit(5)); // Reduced: 5 concurrent per host (was 10)
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
    // Fall back to parallel individual fetches using axios with full browser headers
    // This matches what the scrapers use for direct requests
    const axios = require('axios');
    logger.warn('[HttpClient] No CF_PROXY_URL set, falling back to parallel fetch');
    
    // Rate limit to avoid hammering the server
    const CONCURRENT_LIMIT = 10;
    const pLimit = require('p-limit');
    const limiter = pLimit(CONCURRENT_LIMIT);
    
    return Promise.all(urls.map((url) => limiter(async () => {
      try {
        const response = await axios.get(url, {
          timeout: options.timeout || 15000,
          headers: buildHeaders(),
        });
        return { url, status: response.status, body: response.data, success: response.status < 400 };
      } catch (error) {
        const status = error.response?.status || 0;
        return { url, status, error: error.message, success: false };
      }
    })));
  }
  
  // Use axios for CF Worker requests - it auto-decompresses gzip responses
  // (undici's pool.request() does NOT auto-decompress, causing JSON.parse to fail on gzip binary)
  const axios = require('axios');
  
  const BATCH_SIZE = 15; // URLs per batch request (CF Worker handles up to 20)
  const MAX_RETRIES = 2; // Retry failed batches up to 2 times
  const RETRY_DELAY = 1000; // 1 second delay between retries
  const BATCH_DELAY = 300; // 300ms delay between batches to avoid rate limiting
  const results = [];
  const failedUrls = []; // Track URLs that need retry
  
  /**
   * Helper to fetch a batch of URLs
   */
  async function fetchBatch(batch, attempt = 1) {
    const batchResults = [];
    
    try {
      const proxyUrl = new URL(CF_PROXY_URL);
      // Join URLs with comma - searchParams.set() handles encoding automatically
      // Do NOT pre-encode with encodeURIComponent() - that causes double-encoding!
      proxyUrl.searchParams.set('urls', batch.join(','));
      
      if (options.method === 'POST' && options.body) {
        proxyUrl.searchParams.set('method', 'POST');
        proxyUrl.searchParams.set('body', options.body);
      }
      
      logger.info(`[HttpClient] Batch fetching ${batch.length} URLs via CF Worker (attempt ${attempt})`);
      
      // Use axios instead of undici - axios auto-decompresses gzip/deflate/br
      const response = await axios.get(proxyUrl.toString(), {
        timeout: options.timeout || 45000, // Longer timeout for batch
        headers: buildHeaders(),
        decompress: true, // Explicitly enable (default is true, but be explicit)
      });
      
      // axios already parses JSON if Content-Type is application/json
      // but CF Worker may return text/plain, so handle both cases
      const parsed = typeof response.data === 'string' 
        ? JSON.parse(response.data) 
        : response.data;
      
      if (Array.isArray(parsed)) {
        const successCount = parsed.filter(r => r.success).length;
        const failCount = parsed.length - successCount;
        logger.info(`[HttpClient] Batch complete: ${successCount}/${parsed.length} successful`);
        
        // Separate successful and failed results
        for (const result of parsed) {
          if (result.success) {
            batchResults.push(result);
          } else {
            // Track failed URLs for retry
            batchResults.push({ ...result, needsRetry: true });
          }
        }
        
        return batchResults;
      } else {
        // Error response from CF Worker
        logger.error(`[HttpClient] Batch error: ${parsed.error || 'Unknown error'}`);
        return batch.map(url => ({ url, status: 0, error: parsed.error, success: false, needsRetry: true }));
      }
    } catch (error) {
      logger.error(`[HttpClient] Batch request failed: ${error.message}`);
      // Mark all URLs in this batch as failed and needing retry
      return batch.map(url => ({ url, status: 0, error: error.message, success: false, needsRetry: true }));
    }
  }
  
  // Split URLs into batches and process with delays
  const batches = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    batches.push(urls.slice(i, i + BATCH_SIZE));
  }
  
  // Process batches with delay between them to avoid rate limiting
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    // Add delay between batches (not before first batch)
    if (batchIndex > 0) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
    
    const batchResults = await fetchBatch(batch, 1);
    
    // Separate successful results and track failed ones
    for (const result of batchResults) {
      if (result.success) {
        results.push(result);
      } else if (result.needsRetry) {
        failedUrls.push(result.url);
      } else {
        results.push(result);
      }
    }
  }
  
  // Retry failed URLs with smaller batch size and delays
  if (failedUrls.length > 0 && MAX_RETRIES > 0) {
    logger.info(`[HttpClient] Retrying ${failedUrls.length} failed URLs...`);
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    
    // Retry with smaller batch size (5 instead of 15)
    const RETRY_BATCH_SIZE = 5;
    const retryBatches = [];
    for (let i = 0; i < failedUrls.length; i += RETRY_BATCH_SIZE) {
      retryBatches.push(failedUrls.slice(i, i + RETRY_BATCH_SIZE));
    }
    
    for (let batchIndex = 0; batchIndex < retryBatches.length; batchIndex++) {
      const batch = retryBatches[batchIndex];
      
      // Add delay between retry batches
      if (batchIndex > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
      
      const retryResults = await fetchBatch(batch, 2);
      
      for (const result of retryResults) {
        // On final retry, don't mark for retry anymore
        delete result.needsRetry;
        results.push(result);
      }
    }
    
    const retrySuccessCount = results.filter(r => failedUrls.includes(r.url) && r.success).length;
    logger.info(`[HttpClient] Retry complete: recovered ${retrySuccessCount}/${failedUrls.length} URLs`);
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
 * Bulk fetch URLs optimized for database building
 * Uses undici with connection pooling, lower concurrency to avoid overwhelming servers
 * 
 * @param {string[]} urls - Array of URLs to fetch
 * @param {object} options - Request options
 * @param {number} options.concurrency - Max concurrent requests (default: 5)
 * @param {number} options.timeout - Request timeout in ms (default: 15000)
 * @param {number} options.delayBetween - Delay between requests in ms (default: 100)
 * @param {number} options.retries - Number of retries per URL (default: 2)
 * @returns {Promise<Array<{url: string, data: string|null, status: number, success: boolean, error?: string}>>}
 */
async function bulkFetchForDatabase(urls, options = {}) {
  const {
    concurrency = 5,      // Conservative for WordPress sites
    timeout = 15000,      // 15 second timeout (research says 15-30s is good)
    delayBetween = 100,   // 100ms between requests
    retries = 2,          // Retry failed requests twice
  } = options;

  const limit = pLimit(concurrency);
  const results = [];
  let completedCount = 0;
  const totalCount = urls.length;

  logger.info(`[HttpClient] Bulk fetch starting: ${totalCount} URLs (concurrency: ${concurrency}, timeout: ${timeout}ms)`);

  // Create a dedicated pool for this batch operation with optimal settings
  const { request } = require('undici');

  async function fetchWithRetry(url, attempt = 1) {
    try {
      const urlObj = new URL(url);
      const pool = getPool(urlObj.origin);

      const { statusCode, body } = await pool.request({
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: buildHeaders(),
        bodyTimeout: timeout,
        headersTimeout: timeout,
      });

      const data = await body.text();
      return { url, data, status: statusCode, success: statusCode >= 200 && statusCode < 400 };
    } catch (error) {
      if (attempt < retries) {
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        return fetchWithRetry(url, attempt + 1);
      }
      return { url, data: null, status: 0, success: false, error: error.message };
    }
  }

  // Process URLs with controlled concurrency and delays
  const promises = urls.map((url, index) =>
    limit(async () => {
      // Add small delay between requests to avoid bursts
      if (index > 0 && delayBetween > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetween));
      }

      const result = await fetchWithRetry(url);
      completedCount++;

      // Log progress every 50 URLs
      if (completedCount % 50 === 0 || completedCount === totalCount) {
        const successRate = results.filter(r => r.success).length;
        logger.info(`[HttpClient] Bulk fetch progress: ${completedCount}/${totalCount} (${successRate} successful so far)`);
      }

      return result;
    })
  );

  const fetchResults = await Promise.all(promises);
  
  const successCount = fetchResults.filter(r => r.success).length;
  const failCount = fetchResults.filter(r => !r.success).length;
  logger.info(`[HttpClient] Bulk fetch complete: ${successCount} successful, ${failCount} failed out of ${totalCount}`);

  return fetchResults;
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
  bulkFetchForDatabase,
  prewarmConnections,
  closeAll,
  buildHeaders,
  getRandomUserAgent,
  // Export limiters for custom use
  limiters,
  pLimit,
};
