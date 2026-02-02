/**
 * HentaiStream Edge Addon - Cloudflare Worker
 * 
 * PROXY-BASED architecture - fetches pre-built data from GitHub.
 * All the complex manifest generation, catalog building, etc. is done by Render
 * and saved to GitHub. This worker just serves that data at the edge.
 * 
 * Data Sources (all from GitHub):
 * - /data/manifest.json - Complete Stremio manifest with catalogs
 * - /data/catalog.json - Full series database
 * - /data/filter-options.json - Genre/studio/year options
 * - /data/logo.png - Addon logo/background
 * 
 * Live scraping for streams still goes to provider workers.
 */

// GitHub raw URLs for all data
const GITHUB_BASE = 'https://raw.githubusercontent.com/Zen0-99/hentaistream-addon/master';
const GITHUB_URLS = {
  manifest: `${GITHUB_BASE}/data/manifest.json`,
  catalog: `${GITHUB_BASE}/data/catalog.json`,
  filterOptions: `${GITHUB_BASE}/data/filter-options.json`,
  logo: `${GITHUB_BASE}/data/logo.png`,
  configure: `${GITHUB_BASE}/public/configure.html`
};

// In-memory cache for this worker instance
let cache = {
  manifest: null,
  manifestTime: 0,
  catalog: null,
  catalogTime: 0,
  filterOptions: null,
  filterOptionsTime: 0
};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// CORS headers for Stremio
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    
    try {
      // Parse config from path (e.g., /bg=ntr,yaoi&bs=queen-bee/manifest.json)
      const { config, cleanPath } = parseConfigFromPath(path);
      
      // Route requests
      if (cleanPath === '/' || cleanPath === '') {
        return Response.redirect(`${url.origin}/configure`, 302);
      }
      
      if (cleanPath === '/manifest.json') {
        return await handleManifest(config, url.origin);
      }
      
      if (cleanPath === '/configure') {
        return await handleConfigure();
      }
      
      if (cleanPath === '/logo.png') {
        return await handleLogo();
      }
      
      if (cleanPath === '/api/options') {
        return await handleApiOptions();
      }
      
      if (cleanPath.startsWith('/catalog/')) {
        return await handleCatalog(cleanPath, config);
      }
      
      if (cleanPath.startsWith('/meta/')) {
        return await handleMeta(cleanPath);
      }
      
      if (cleanPath.startsWith('/stream/')) {
        return await handleStream(cleanPath, env);
      }
      
      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Parse user config from URL path
 */
function parseConfigFromPath(path) {
  const configMatch = path.match(/^\/([^/]+)\/(manifest\.json|configure|catalog\/|meta\/|stream\/)/);
  if (configMatch && configMatch[1] && !['manifest.json', 'configure', 'catalog', 'meta', 'stream', 'logo.png', 'api'].includes(configMatch[1])) {
    const configStr = decodeURIComponent(configMatch[1]);
    const config = {
      blacklistGenres: [],
      blacklistStudios: [],
      showCounts: true
    };
    
    configStr.split('&').forEach(part => {
      const [key, value] = part.split('=');
      if (key === 'bg' && value) config.blacklistGenres = value.split(',').map(s => s.trim().toLowerCase());
      if (key === 'bs' && value) config.blacklistStudios = value.split(',').map(s => s.trim().toLowerCase());
      if (key === 'showCounts') config.showCounts = value !== '0';
    });
    
    const cleanPath = path.replace(`/${configMatch[1]}`, '');
    return { config, cleanPath };
  }
  
  return { config: { blacklistGenres: [], blacklistStudios: [], showCounts: true }, cleanPath: path };
}

/**
 * Fetch and cache JSON from GitHub
 */
async function fetchGitHub(key, url) {
  const now = Date.now();
  if (cache[key] && (now - cache[`${key}Time`]) < CACHE_TTL) {
    return cache[key];
  }
  
  // Add cache-busting parameter to bypass Cloudflare edge cache
  const bustUrl = `${url}?_t=${Math.floor(now / 300000)}`; // Changes every 5 minutes
  
  const response = await fetch(bustUrl, {
    headers: { 
      'User-Agent': 'HentaiStream-Edge-Worker',
      'Cache-Control': 'no-cache'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ${key}: ${response.status}`);
  }
  
  // Get text and strip any BOM (byte order mark) before parsing
  let text = await response.text();
  text = text.replace(/^\uFEFF/, ''); // Remove BOM if present
  
  const data = JSON.parse(text);
  cache[key] = data;
  cache[`${key}Time`] = now;
  return data;
}

/**
 * Handle manifest.json - fetch from GitHub and update URLs
 */
async function handleManifest(config, origin) {
  const manifest = await fetchGitHub('manifest', GITHUB_URLS.manifest);
  
  // Clone and update URLs to point to this edge worker
  const edgeManifest = JSON.parse(JSON.stringify(manifest));
  edgeManifest.logo = `${origin}/logo.png`;
  edgeManifest.background = `${origin}/logo.png`;
  
  // Remove counts from options if showCounts is false
  if (!config.showCounts && edgeManifest.catalogs) {
    edgeManifest.catalogs = edgeManifest.catalogs.map(cat => {
      if (cat.extra) {
        cat.extra = cat.extra.map(extra => {
          if (extra.options) {
            extra.options = extra.options.map(opt => opt.replace(/\s*\(\d+\)$/, ''));
          }
          return extra;
        });
      }
      return cat;
    });
  }
  
  return new Response(JSON.stringify(edgeManifest), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

/**
 * Handle /configure - serve the configure page
 */
async function handleConfigure() {
  // Fetch configure.html from GitHub
  const response = await fetch(GITHUB_URLS.configure, {
    headers: { 'User-Agent': 'HentaiStream-Edge-Worker' },
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  
  if (!response.ok) {
    return new Response('Configure page not found', { status: 404, headers: CORS_HEADERS });
  }
  
  const html = await response.text();
  
  return new Response(html, {
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/**
 * Handle /logo.png - proxy from GitHub
 */
async function handleLogo() {
  const response = await fetch(GITHUB_URLS.logo, {
    headers: { 'User-Agent': 'HentaiStream-Edge-Worker' },
    cf: { cacheTtl: 86400, cacheEverything: true } // Cache logo for 24h
  });
  
  if (!response.ok) {
    return new Response('Logo not found', { status: 404, headers: CORS_HEADERS });
  }
  
  return new Response(response.body, {
    headers: { ...CORS_HEADERS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
  });
}

/**
 * Handle /api/options - return filter options for configure page
 */
async function handleApiOptions() {
  const filterOptions = await fetchGitHub('filterOptions', GITHUB_URLS.filterOptions);
  
  return new Response(JSON.stringify({
    genres: filterOptions?.genres?.withCounts || [],
    studios: filterOptions?.studios?.withCounts || []
  }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

/**
 * Handle catalog requests
 */
async function handleCatalog(path, config) {
  // Parse: /catalog/{type}/{id}/{extra}.json
  const match = path.match(/\/catalog\/([^/]+)\/([^/]+)(?:\/(.+))?\.json/);
  if (!match) {
    return new Response(JSON.stringify({ metas: [] }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  
  const [, type, catalogId, extraStr] = match;
  const extra = parseExtra(extraStr);
  
  // Load catalog from GitHub
  const catalogData = await fetchGitHub('catalog', GITHUB_URLS.catalog);
  
  // Get series array - catalog.json has structure: { catalog: [...series...] }
  let series = Array.isArray(catalogData) ? catalogData : 
               (catalogData.catalog || catalogData.series || []);
  
  // Apply blacklist filters
  if (config.blacklistGenres.length > 0) {
    series = series.filter(s => {
      const genres = (s.genres || []).map(g => g.toLowerCase());
      return !config.blacklistGenres.some(bg => genres.includes(bg));
    });
  }
  
  if (config.blacklistStudios.length > 0) {
    series = series.filter(s => {
      const studio = (s.studio || '').toLowerCase();
      return !config.blacklistStudios.some(bs => studio.includes(bs));
    });
  }
  
  // Filter and sort based on catalog type
  let filtered = filterByCatalog(series, catalogId, extra);
  
  // Pagination
  const skip = parseInt(extra.skip) || 0;
  const limit = 100;
  const page = filtered.slice(skip, skip + limit);
  
  // Format for Stremio
  const metas = page.map(s => formatMeta(s));
  
  return new Response(JSON.stringify({ metas }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

/**
 * Filter series based on catalog type
 */
function filterByCatalog(series, catalogId, extra) {
  let filtered = [...series];
  const genre = extra.genre;
  
  switch (catalogId) {
    case 'hentai-top-rated':
      // Filter by genre if specified
      if (genre) {
        const genreLower = genre.toLowerCase().replace(/\s*\(\d+\)$/, '');
        filtered = filtered.filter(s => 
          (s.genres || []).some(g => g.toLowerCase() === genreLower)
        );
      }
      // Sort by rating
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
      
    case 'hentai-monthly':
      // Filter by time period
      if (genre) {
        const periodKey = genre.toLowerCase().replace(/\s*\(\d+\)$/, '');
        
        // "None" means return all with valid dates (no time filter)
        if (periodKey !== 'none') {
          const now = Date.now();
          const periods = {
            'this week': 7 * 24 * 60 * 60 * 1000,
            'this month': 30 * 24 * 60 * 60 * 1000,
            '3 months': 90 * 24 * 60 * 60 * 1000,
            'this year': 365 * 24 * 60 * 60 * 1000
          };
          const periodMs = periods[periodKey] || periods['this month'];
          
          filtered = filtered.filter(s => {
            const releaseDate = s.releaseDate ? new Date(s.releaseDate).getTime() : 0;
            return (now - releaseDate) <= periodMs;
          });
        }
      }
      // Sort by release date (newest first)
      filtered.sort((a, b) => {
        const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return dateB - dateA;
      });
      break;
      
    case 'hentai-studios':
      // Filter by studio
      if (genre) {
        const studioLower = genre.toLowerCase().replace(/\s*\(\d+\)$/, '');
        filtered = filtered.filter(s => 
          (s.studio || '').toLowerCase() === studioLower
        );
      }
      // Sort by rating within studio
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
      
    case 'hentai-years':
      // Filter by year
      if (genre) {
        const year = genre.replace(/\s*\(\d+\)$/, '');
        filtered = filtered.filter(s => {
          const releaseYear = s.releaseDate ? new Date(s.releaseDate).getFullYear().toString() : '';
          return releaseYear === year;
        });
      }
      // Sort by release date within year
      filtered.sort((a, b) => {
        const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return dateB - dateA;
      });
      break;
      
    case 'hentai-all':
      // Filter by genre if specified
      if (genre) {
        const genreLower = genre.toLowerCase().replace(/\s*\(\d+\)$/, '');
        filtered = filtered.filter(s => 
          (s.genres || []).some(g => g.toLowerCase() === genreLower)
        );
      }
      // Sort by name
      filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
      
    case 'hentai-search':
      // Search by query
      if (extra.search) {
        const query = extra.search.toLowerCase();
        filtered = filtered.filter(s => 
          (s.name || '').toLowerCase().includes(query) ||
          (s.description || '').toLowerCase().includes(query)
        );
      }
      break;
      
    default:
      // Default: sort by rating
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }
  
  return filtered;
}

/**
 * Handle meta requests
 */
async function handleMeta(path) {
  // Parse: /meta/{type}/{id}.json
  const match = path.match(/\/meta\/([^/]+)\/([^/]+)\.json/);
  if (!match) {
    return new Response(JSON.stringify({ meta: null }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  
  const [, type, id] = match;
  
  // Load catalog
  const catalogData = await fetchGitHub('catalog', GITHUB_URLS.catalog);
  const series = Array.isArray(catalogData) ? catalogData : 
                 (catalogData.catalog || catalogData.series || []);
  
  // Find the series
  const item = series.find(s => s.id === id);
  if (!item) {
    return new Response(JSON.stringify({ meta: null }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  
  // Format full meta with episodes
  const meta = formatFullMeta(item);
  
  return new Response(JSON.stringify({ meta }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

/**
 * Handle stream requests - proxy to provider workers
 */
async function handleStream(path, env) {
  // Parse: /stream/{type}/{id}.json
  const match = path.match(/\/stream\/([^/]+)\/([^/]+)\.json/);
  if (!match) {
    return new Response(JSON.stringify({ streams: [] }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  
  const [, type, id] = match;
  
  // Determine provider from ID prefix
  const provider = id.startsWith('hmm-') ? 'hentaimama' :
                   id.startsWith('hse-') ? 'hentaisea' :
                   id.startsWith('htv-') ? 'hentaitv' : null;
  
  if (!provider) {
    return new Response(JSON.stringify({ streams: [] }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  
  // Get worker URL from env
  const workerUrl = env[`${provider.toUpperCase()}_WORKER`] || 
                    env.HENTAIMAMA_WORKER; // fallback
  
  if (!workerUrl) {
    return new Response(JSON.stringify({ streams: [], error: 'Provider worker not configured' }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  
  try {
    // Proxy to provider worker
    const response = await fetch(`${workerUrl}/stream/${type}/${id}.json`, {
      headers: { 'User-Agent': 'HentaiStream-Edge-Worker' }
    });
    
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error(`Stream fetch error for ${provider}:`, error);
    return new Response(JSON.stringify({ streams: [], error: error.message }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Parse extra parameters from URL
 */
function parseExtra(extraStr) {
  const extra = {};
  if (!extraStr) return extra;
  
  extraStr.split('&').forEach(part => {
    const [key, ...valueParts] = part.split('=');
    const value = valueParts.join('=');
    if (key && value !== undefined) {
      extra[key] = decodeURIComponent(value);
    }
  });
  
  return extra;
}

/**
 * Format series for catalog listing (minimal meta)
 */
function formatMeta(series) {
  return {
    id: series.id,
    type: 'series', // Always series for Stremio display
    name: series.name,
    poster: series.poster,
    posterShape: 'poster',
    genres: series.genres || [],
    description: series.description,
    runtime: series.rating ? `★ ${series.rating.toFixed(1)}` : undefined
  };
}

/**
 * Format series for full meta (with episodes)
 */
function formatFullMeta(series) {
  const meta = {
    id: series.id,
    type: 'series',
    name: series.name,
    poster: series.poster,
    posterShape: 'poster',
    background: series.poster, // Use poster as background
    genres: series.genres || [],
    description: series.description,
    runtime: series.rating ? `★ ${series.rating.toFixed(1)}` : undefined,
    releaseInfo: series.releaseDate ? new Date(series.releaseDate).getFullYear().toString() : undefined,
    director: series.studio ? [series.studio] : undefined
  };
  
  // Add episodes/videos
  if (series.episodes && series.episodes.length > 0) {
    meta.videos = series.episodes.map((ep, idx) => ({
      id: ep.id || `${series.id}:${idx + 1}`,
      title: ep.title || `Episode ${idx + 1}`,
      season: 1,
      episode: idx + 1,
      released: ep.releaseDate || series.releaseDate,
      thumbnail: ep.thumbnail || series.poster
    }));
  }
  
  return meta;
}
