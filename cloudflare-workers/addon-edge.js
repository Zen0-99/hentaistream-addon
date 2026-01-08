/**
 * HentaiStream Edge Addon - Cloudflare Worker
 * 
 * FULLY SCALABLE Stremio addon running on Cloudflare's edge network.
 * Handles ALL addon requests (manifest, catalog, meta, stream) without any central server.
 * 
 * Architecture:
 * - Database stored in KV (reads are FREE and unlimited)
 * - Each request is isolated (no memory pressure from concurrent users)
 * - Scales to millions of requests without server RAM concerns
 * 
 * KV Namespaces Required:
 * - CATALOG_DB: Main database with series catalog
 *   Keys: 
 *     - "catalog": Full serialized catalog array
 *     - "stats": Database statistics
 *     - "filterOptions": Genre/studio filter options
 *     - "series:{id}": Individual series data (optional, for faster lookups)
 * 
 * Environment Variables:
 * - HENTAIMAMA_WORKER: URL to HentaiMama scraper worker
 * - HENTAISEA_WORKER: URL to HentaiSea scraper worker  
 * - HENTAITV_WORKER: URL to HentaiTV scraper worker
 */

const ADDON_ID = 'community.hentaistream.stremio';
const ADDON_VERSION = '1.1.0';
const ADDON_NAME = 'HentaiStream';

// Cache database in worker memory for duration of request
// (Workers are stateless but this avoids multiple KV reads per request)
let cachedCatalog = null;
let catalogCacheTime = 0;
const CATALOG_CACHE_TTL = 60 * 1000; // 1 minute in-worker cache

/**
 * Main entry point
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route requests
      if (path === '/' || path === '/configure') {
        return handleConfigure(env, corsHeaders);
      }
      
      if (path.endsWith('/manifest.json')) {
        return handleManifest(url, corsHeaders);
      }
      
      if (path.includes('/catalog/')) {
        return await handleCatalog(url, env, corsHeaders);
      }
      
      if (path.includes('/meta/')) {
        return await handleMeta(url, env, corsHeaders);
      }
      
      if (path.includes('/stream/')) {
        return await handleStream(url, env, corsHeaders);
      }

      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: error.message }, 500, corsHeaders);
    }
  }
};

/**
 * Generate manifest
 */
function handleManifest(url, corsHeaders) {
  const config = parseConfigFromPath(url.pathname);
  
  const manifest = {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: ADDON_NAME,
    description: 'Stream hentai from multiple sources',
    types: ['series'],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['hmm-', 'hse-', 'htv-'],
    catalogs: [
      {
        type: 'hentai',
        id: 'hentaistream-new',
        name: '📺 New Releases',
        extra: [{ name: 'skip', isRequired: false }],
        behaviorHints: { notForHome: true }
      },
      {
        type: 'hentai',
        id: 'hentaistream-top',
        name: '⭐ Top Rated',
        extra: [{ name: 'skip', isRequired: false }],
        behaviorHints: { notForHome: true }
      },
      {
        type: 'hentai',
        id: 'hentaistream-popular',
        name: '🔥 Popular',
        extra: [{ name: 'skip', isRequired: false }],
        behaviorHints: { notForHome: true }
      },
      {
        type: 'hentai',
        id: 'hentaistream-search',
        name: '🔍 Search',
        extra: [
          { name: 'search', isRequired: true },
          { name: 'skip', isRequired: false }
        ],
        behaviorHints: { notForHome: true }
      },
      {
        type: 'hentai',
        id: 'hentaistream-genre',
        name: '🏷️ By Genre',
        extra: [
          { name: 'genre', isRequired: true, options: [] }, // Populated dynamically
          { name: 'skip', isRequired: false }
        ],
        behaviorHints: { notForHome: true }
      },
      {
        type: 'hentai',
        id: 'hentaistream-studio',
        name: '🎬 By Studio',
        extra: [
          { name: 'genre', isRequired: true, options: [] }, // Using genre param for studio
          { name: 'skip', isRequired: false }
        ],
        behaviorHints: { notForHome: true }
      }
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      adult: true
    }
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400' // Cache manifest for 24h
    }
  });
}

/**
 * Handle catalog requests
 */
async function handleCatalog(url, env, corsHeaders) {
  const pathMatch = url.pathname.match(/\/catalog\/\w+\/([^\/]+)(?:\/([^.]+))?/);
  if (!pathMatch) {
    return jsonResponse({ metas: [] }, 200, corsHeaders);
  }

  const catalogId = pathMatch[1];
  const extraPath = pathMatch[2] || '';
  
  // Parse extras (skip, search, genre)
  const extras = parseExtras(extraPath);
  const skip = parseInt(extras.skip) || 0;
  const limit = 100;

  // Load catalog from KV
  const catalog = await loadCatalogFromKV(env);
  if (!catalog || catalog.length === 0) {
    return jsonResponse({ metas: [] }, 200, corsHeaders);
  }

  let filtered = [...catalog];
  
  // Apply filters based on catalog type
  switch (catalogId) {
    case 'hentaistream-new':
      // Sort by newest release date
      filtered.sort((a, b) => {
        const dateA = a.latestEpisodeDate || a.releaseDate || '1970-01-01';
        const dateB = b.latestEpisodeDate || b.releaseDate || '1970-01-01';
        return dateB.localeCompare(dateA);
      });
      break;

    case 'hentaistream-top':
      // Sort by rating
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;

    case 'hentaistream-popular':
      // Sort by popularity (view count or rating + episode count)
      filtered.sort((a, b) => {
        const popA = (a.viewCount || 0) + ((a.rating || 0) * 100) + ((a.episodeCount || 0) * 10);
        const popB = (b.viewCount || 0) + ((b.rating || 0) * 100) + ((b.episodeCount || 0) * 10);
        return popB - popA;
      });
      break;

    case 'hentaistream-search':
      if (extras.search) {
        const query = extras.search.toLowerCase();
        filtered = filtered.filter(s => {
          const searchText = [s.name, s.description, ...(s.genres || [])].join(' ').toLowerCase();
          return searchText.includes(query);
        });
      }
      break;

    case 'hentaistream-genre':
      if (extras.genre) {
        const genre = decodeURIComponent(extras.genre).toLowerCase();
        filtered = filtered.filter(s => 
          s.genres && s.genres.some(g => g.toLowerCase() === genre)
        );
      }
      break;

    case 'hentaistream-studio':
      if (extras.genre) { // Using genre param for studio
        const studio = decodeURIComponent(extras.genre).toLowerCase();
        filtered = filtered.filter(s => 
          s.studio && s.studio.toLowerCase().includes(studio)
        );
      }
      break;
  }

  // Paginate
  const page = filtered.slice(skip, skip + limit);
  
  // Format for Stremio
  const metas = page.map(formatMeta);

  return jsonResponse({ metas }, 200, corsHeaders, 300); // 5 min cache
}

/**
 * Handle meta requests
 */
async function handleMeta(url, env, corsHeaders) {
  const pathMatch = url.pathname.match(/\/meta\/\w+\/([^.]+)/);
  if (!pathMatch) {
    return jsonResponse({ meta: null }, 404, corsHeaders);
  }

  const id = pathMatch[1];
  
  // Load from KV
  const catalog = await loadCatalogFromKV(env);
  
  // Find by ID
  let series = catalog.find(s => s.id === id);
  
  // Try by slug if not found
  if (!series) {
    const slug = id.replace(/^(hmm|hse|htv)-/, '');
    series = catalog.find(s => s.id.endsWith(slug));
  }

  if (!series) {
    return jsonResponse({ meta: null }, 404, corsHeaders);
  }

  const meta = formatMeta(series, true); // Include videos for meta
  
  return jsonResponse({ meta }, 200, corsHeaders, 3600); // 1h cache
}

/**
 * Handle stream requests - proxies to scraper workers
 */
async function handleStream(url, env, corsHeaders) {
  const pathMatch = url.pathname.match(/\/stream\/\w+\/([^.]+)/);
  if (!pathMatch) {
    return jsonResponse({ streams: [] }, 200, corsHeaders);
  }

  const videoId = pathMatch[1];
  
  // Parse video ID format: {provider}-{series-slug}-episode-{n}
  const [provider, ...rest] = videoId.split('-');
  const fullSlug = rest.join('-');
  
  // Get scraper worker URLs from env
  const scraperUrls = {
    hmm: env.HENTAIMAMA_WORKER || 'https://hentaimama.kkeypop3750.workers.dev',
    hse: env.HENTAISEA_WORKER || 'https://hentaisea.kkeypop3750.workers.dev',
    htv: env.HENTAITV_WORKER || 'https://hentaitv.kkeypop3750.workers.dev'
  };

  // Collect streams from relevant scrapers
  const streams = [];
  const scraperPromises = [];

  // Always try HentaiMama first (highest quality)
  if (scraperUrls.hmm) {
    scraperPromises.push(
      fetchFromScraper(scraperUrls.hmm, fullSlug, 'HentaiMama')
    );
  }

  // Add other scrapers if not HentaiMama
  if (provider !== 'hmm' && scraperUrls[provider]) {
    scraperPromises.push(
      fetchFromScraper(scraperUrls[provider], fullSlug, getProviderName(provider))
    );
  }

  // Fetch in parallel
  const results = await Promise.allSettled(scraperPromises);
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      streams.push(...result.value);
    }
  }

  return jsonResponse({ streams }, 200, corsHeaders, 180); // 3 min cache
}

/**
 * Fetch streams from a scraper worker
 */
async function fetchFromScraper(scraperUrl, episodeSlug, providerName) {
  try {
    const response = await fetch(`${scraperUrl}?action=stream&id=${encodeURIComponent(episodeSlug)}`, {
      cf: { cacheTtl: 180 }
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return (data.streams || []).map(stream => ({
      ...stream,
      name: stream.name || `${providerName} Stream`,
      title: stream.title || `${providerName}`
    }));
  } catch (error) {
    console.error(`Scraper error for ${providerName}:`, error);
    return [];
  }
}

/**
 * Configuration page
 */
function handleConfigure(env, corsHeaders) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>HentaiStream - Configure</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; background: #1a1a1a; color: #fff; }
    h1 { color: #ff6b9d; }
    .install-btn { display: block; background: #ff6b9d; color: #fff; padding: 15px 30px; text-decoration: none; border-radius: 8px; text-align: center; font-size: 18px; margin: 20px 0; }
    .install-btn:hover { background: #ff4785; }
    p { color: #aaa; line-height: 1.6; }
    code { background: #333; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🔞 HentaiStream</h1>
  <p>Stream hentai from multiple sources directly in Stremio.</p>
  <a href="stremio://${new URL(env.WORKER_URL || 'https://hentaistream-addon.workers.dev').host}/manifest.json" class="install-btn">
    Install in Stremio
  </a>
  <p><strong>Features:</strong></p>
  <ul>
    <li>4000+ series from 3 providers</li>
    <li>Instant catalog loading</li>
    <li>Search by title, genre, or studio</li>
    <li>RAW episode detection</li>
  </ul>
  <p><small>v${ADDON_VERSION} • Edge-powered • Infinitely scalable</small></p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load catalog from KV (with in-memory cache for request duration)
 */
async function loadCatalogFromKV(env) {
  // Check if env.CATALOG_DB exists
  if (!env.CATALOG_DB) {
    console.error('CATALOG_DB KV namespace not bound');
    return [];
  }

  // Use short-lived in-memory cache
  const now = Date.now();
  if (cachedCatalog && (now - catalogCacheTime) < CATALOG_CACHE_TTL) {
    return cachedCatalog;
  }

  try {
    // Try to get pre-parsed JSON first
    const catalogJson = await env.CATALOG_DB.get('catalog', { type: 'json' });
    
    if (catalogJson && Array.isArray(catalogJson)) {
      cachedCatalog = catalogJson;
      catalogCacheTime = now;
      return catalogJson;
    }

    // Fallback: try compressed version
    const compressed = await env.CATALOG_DB.get('catalog_compressed', { type: 'arrayBuffer' });
    if (compressed) {
      const text = new TextDecoder().decode(compressed);
      const parsed = JSON.parse(text);
      cachedCatalog = parsed.catalog || parsed;
      catalogCacheTime = now;
      return cachedCatalog;
    }

    console.warn('No catalog found in KV');
    return [];

  } catch (error) {
    console.error('KV load error:', error);
    return [];
  }
}

/**
 * Format series for Stremio meta
 */
function formatMeta(series, includeVideos = false) {
  const meta = {
    id: series.id,
    type: 'series', // Must be 'series' for Stremio to display properly
    name: series.name || series.title,
    poster: series.poster,
    background: series.background || series.poster,
    description: series.description,
    genres: series.genres || [],
    runtime: series.rating ? `★ ${series.rating.toFixed(1)}` : '★ N/A',
    releaseInfo: series.year ? String(series.year) : undefined,
    imdbRating: series.rating || undefined,
  };

  if (series.studio) {
    meta.director = [series.studio];
  }

  // Add videos (episodes) for full meta requests
  if (includeVideos && series.episodes && series.episodes.length > 0) {
    meta.videos = series.episodes.map((ep, idx) => ({
      id: ep.id || `${series.id}-episode-${idx + 1}`,
      title: ep.title || `Episode ${idx + 1}`,
      season: 1,
      episode: idx + 1,
      released: ep.date || ep.releaseDate,
      thumbnail: ep.thumbnail || series.poster
    }));
  }

  return meta;
}

/**
 * Parse extras from URL path
 */
function parseExtras(extraPath) {
  const extras = {};
  if (!extraPath) return extras;

  // Format: key=value&key2=value2 or key=value/key2=value2
  const parts = extraPath.split(/[&\/]/);
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key && value) {
      extras[key] = decodeURIComponent(value);
    }
  }
  return extras;
}

/**
 * Parse config from URL path
 */
function parseConfigFromPath(pathname) {
  // Config format: /{config}/manifest.json
  const match = pathname.match(/^\/([^\/]+)\/manifest\.json$/);
  if (!match || match[1] === '') return {};
  
  const configStr = match[1];
  const config = {};
  
  for (const param of configStr.split('&')) {
    const [key, value] = param.split('=');
    if (key && value) {
      config[key] = value.split(',');
    }
  }
  
  return config;
}

/**
 * Get provider display name
 */
function getProviderName(provider) {
  const names = {
    hmm: 'HentaiMama',
    hse: 'HentaiSea',
    htv: 'HentaiTV'
  };
  return names[provider] || provider;
}

/**
 * JSON response helper
 */
function jsonResponse(data, status = 200, corsHeaders = {}, cacheTtl = 0) {
  const headers = {
    ...corsHeaders,
    'Content-Type': 'application/json'
  };
  
  if (cacheTtl > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheTtl}`;
  }
  
  return new Response(JSON.stringify(data), { status, headers });
}
