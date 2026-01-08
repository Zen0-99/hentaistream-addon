/**
 * HentaiStream Edge Proxy - Cloudflare Worker
 * 
 * SIMPLE REVERSE PROXY that forwards all requests to Render.
 * Cloudflare caches responses at the edge = massive bandwidth savings.
 * 
 * Benefits:
 * - ALL existing Render logic works perfectly (no reimplementation)
 * - Cloudflare caches = Render bandwidth reduced by 90%+
 * - Cloudflare has UNLIMITED bandwidth on free tier
 * - Users get faster responses from edge cache
 */

const RENDER_ORIGIN = 'https://hentaistream-addon.onrender.com';

// Cache TTLs (in seconds)
const CACHE_TTLS = {
  manifest: 300,      // 5 minutes - manifest changes rarely
  catalog: 300,       // 5 minutes - catalog data
  meta: 3600,         // 1 hour - series metadata rarely changes
  stream: 60,         // 1 minute - streams can change
  static: 86400,      // 24 hours - logo, configure page
  api: 300,           // 5 minutes - api endpoints
  default: 300        // 5 minutes default
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
    
    // Determine cache TTL based on path
    const cacheTtl = getCacheTtl(path);
    
    // Build the Render URL (preserve path and query string)
    const renderUrl = `${RENDER_ORIGIN}${path}${url.search}`;
    
    // Try to get from Cloudflare cache first
    const cacheKey = new Request(renderUrl, request);
    const cache = caches.default;
    
    let response = await cache.match(cacheKey);
    
    if (!response) {
      // Cache miss - fetch from Render
      console.log(`[CACHE MISS] ${path}`);
      
      try {
        const renderResponse = await fetch(renderUrl, {
          method: request.method,
          headers: {
            'User-Agent': 'HentaiStream-Edge-Proxy',
            'Accept': request.headers.get('Accept') || '*/*'
          }
        });
        
        // Clone response for caching
        response = new Response(renderResponse.body, {
          status: renderResponse.status,
          statusText: renderResponse.statusText,
          headers: new Headers(renderResponse.headers)
        });
        
        // Add CORS headers
        response.headers.set('Access-Control-Allow-Origin', '*');
        
        // Add cache headers
        response.headers.set('Cache-Control', `public, max-age=${cacheTtl}`);
        response.headers.set('X-Cache-Status', 'MISS');
        response.headers.set('X-Origin', 'Render');
        
        // Store in cache (don't await - let it happen in background)
        if (renderResponse.ok && cacheTtl > 0) {
          const responseToCache = response.clone();
          ctx.waitUntil(cache.put(cacheKey, responseToCache));
        }
        
      } catch (error) {
        console.error('Render fetch error:', error);
        return new Response(JSON.stringify({ error: 'Origin server unavailable' }), {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } else {
      // Cache hit
      console.log(`[CACHE HIT] ${path}`);
      
      // Clone and add cache hit header
      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers)
      });
      response.headers.set('X-Cache-Status', 'HIT');
    }
    
    return response;
  }
};

/**
 * Determine cache TTL based on request path
 */
function getCacheTtl(path) {
  if (path === '/manifest.json' || path.endsWith('/manifest.json')) {
    return CACHE_TTLS.manifest;
  }
  
  if (path.startsWith('/catalog/')) {
    return CACHE_TTLS.catalog;
  }
  
  if (path.startsWith('/meta/')) {
    return CACHE_TTLS.meta;
  }
  
  if (path.startsWith('/stream/')) {
    return CACHE_TTLS.stream;
  }
  
  if (path === '/logo.png' || path === '/configure' || path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js')) {
    return CACHE_TTLS.static;
  }
  
  if (path.startsWith('/api/')) {
    return CACHE_TTLS.api;
  }
  
  return CACHE_TTLS.default;
}
