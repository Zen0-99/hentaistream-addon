/**
 * HentaiStream Edge Addon - Cloudflare Worker (Standalone)
 * 
 * COMPLETE Cloudflare-only solution - NO RENDER NEEDED!
 * 
 * This single worker handles:
 * - Manifest, catalog, meta (from GitHub data)
 * - Live stream scraping (inline scraper logic)
 * - Configure page (from GitHub)
 * 
 * Database updates done via GitHub Actions (scripts/build-database.js)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const GITHUB_BASE = 'https://raw.githubusercontent.com/Zen0-99/hentaistream-addon/master';
const GITHUB_URLS = {
  manifest: `${GITHUB_BASE}/data/manifest.json`,
  catalog: `${GITHUB_BASE}/data/catalog.json`,
  filterOptions: `${GITHUB_BASE}/data/filter-options.json`,
  logo: `${GITHUB_BASE}/data/logo.png`,
  configure: `${GITHUB_BASE}/public/configure.html`
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

// Genre synonyms - map variations to canonical name for filtering
// This allows manifest to show "3D (1737)" while database has "3D Hentai", "3D Works", etc.
const GENRE_SYNONYMS = {
  // 3D variants -> '3d'
  '3d hentai': '3d',
  '3d works': '3d',
  '3dcg': '3d',
  '3d anime main shop': '3d',
  'affect3d': '3d',
  '3dmovie': '3d',
  'artcg3d': '3d',
  "kn's 3d room": '3d',
  'dodoro3d': '3d',
  'loiter manpuku3d': '3d',
  'stargate3d': '3d',
  'umemaro 3d': '3d',
  'tech3d': '3d',
  'tensun3d': '3d',
  'tech 3d': '3d',
  'tkhm3d': '3d',
  'doujin3aries': '3d',
  'guilty3d': '3d',
  'heralces 3dx': '3d',
  'mako-3d': '3d',
  // Other synonyms
  'blow job': 'blowjob',
  'boob job': 'paizuri',
  'tits fuck': 'paizuri',
  'cream pie': 'creampie',
  'foot job': 'footjob',
  'hand job': 'handjob',
  'rim job': 'rimjob',
  'school girl': 'schoolgirl',
  'school girls': 'schoolgirl',
  'female students': 'schoolgirl',
  'virgins': 'virgin',
  'nurses': 'nurse',
  'tentacle': 'tentacles',
  'tentac': 'tentacles',
  'oral': 'oral sex',
  'big tits': 'big boobs',
  'large breasts': 'big boobs',
  'big bust': 'big boobs',
  'oppai': 'big boobs',
  'group': 'group sex',
  'young': 'loli',
  'shoutacon': 'shota',
  'forced': 'rape'
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

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    
    try {
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
      
      // Debug endpoint to test genre matching
      if (cleanPath === '/api/debug/genre') {
        const genre = url.searchParams.get('genre') || '3D';
        const catalogData = await fetchGitHub('catalog', GITHUB_URLS.catalog);
        const series = Array.isArray(catalogData) ? catalogData : 
                      (catalogData.catalog || catalogData.series || []);
        
        const matches = series.filter(s => seriesMatchesGenre(s, genre));
        const sampleGenres = matches.slice(0, 5).flatMap(s => s.genres || []).slice(0, 20);
        
        return jsonResponse({
          totalInCatalog: series.length,
          genreFilter: genre,
          normalizedFilter: normalizeGenre(genre),
          matchingItems: matches.length,
          sampleGenres: sampleGenres
        });
      }
      
      // Debug endpoint to test full catalog filtering
      if (cleanPath === '/api/debug/catalog') {
        const genre = url.searchParams.get('genre') || '3D';
        const catalogId = url.searchParams.get('catalog') || 'hentai-top-rated';
        
        const catalogData = await fetchGitHub('catalog', GITHUB_URLS.catalog);
        let series = Array.isArray(catalogData) ? catalogData : 
                    (catalogData.catalog || catalogData.series || []);
        
        const extra = { genre: genre };
        const filtered = filterByCatalog(series, catalogId, extra);
        
        return jsonResponse({
          totalInCatalog: series.length,
          catalogId: catalogId,
          genreFilter: genre,
          filteredCount: filtered.length,
          firstFewNames: filtered.slice(0, 5).map(s => s.name),
          lastFewNames: filtered.slice(-5).map(s => s.name)
        });
      }
      
      if (cleanPath.startsWith('/catalog/')) {
        return await handleCatalog(cleanPath, config);
      }
      
      if (cleanPath.startsWith('/meta/')) {
        return await handleMeta(cleanPath);
      }
      
      if (cleanPath.startsWith('/stream/')) {
        return await handleStream(cleanPath);
      }
      
      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
      
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  }
};

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

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

async function fetchGitHub(key, url) {
  const now = Date.now();
  if (cache[key] && (now - cache[`${key}Time`]) < CACHE_TTL) {
    return cache[key];
  }
  
  const bustUrl = `${url}?_t=${Math.floor(now / 300000)}`;
  
  const response = await fetch(bustUrl, {
    headers: { 
      'User-Agent': 'HentaiStream-Edge-Worker',
      'Cache-Control': 'no-cache'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ${key}: ${response.status}`);
  }
  
  let text = await response.text();
  text = text.replace(/^\uFEFF/, '');
  
  const data = JSON.parse(text);
  cache[key] = data;
  cache[`${key}Time`] = now;
  return data;
}

async function handleManifest(config, origin) {
  const manifest = await fetchGitHub('manifest', GITHUB_URLS.manifest);
  
  const edgeManifest = JSON.parse(JSON.stringify(manifest));
  edgeManifest.logo = `${origin}/logo.png`;
  edgeManifest.background = `${origin}/logo.png`;
  
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
  
  return jsonResponse(edgeManifest);
}

async function handleConfigure() {
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

async function handleLogo() {
  const response = await fetch(GITHUB_URLS.logo, {
    headers: { 'User-Agent': 'HentaiStream-Edge-Worker' },
    cf: { cacheTtl: 86400, cacheEverything: true }
  });
  
  if (!response.ok) {
    return new Response('Logo not found', { status: 404, headers: CORS_HEADERS });
  }
  
  return new Response(response.body, {
    headers: { ...CORS_HEADERS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
  });
}

async function handleApiOptions() {
  const filterOptions = await fetchGitHub('filterOptions', GITHUB_URLS.filterOptions);
  
  return jsonResponse({
    genres: filterOptions?.genres?.withCounts || [],
    studios: filterOptions?.studios?.withCounts || []
  });
}

async function handleCatalog(path, config) {
  const match = path.match(/\/catalog\/([^/]+)\/([^/]+)(?:\/(.+))?\.json/);
  if (!match) {
    return jsonResponse({ metas: [] });
  }
  
  const [, type, catalogId, extraStr] = match;
  const extra = parseExtra(extraStr);
  
  const catalogData = await fetchGitHub('catalog', GITHUB_URLS.catalog);
  
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
  
  let filtered = filterByCatalog(series, catalogId, extra);
  
  const skip = parseInt(extra.skip) || 0;
  const limit = 100;
  const page = filtered.slice(skip, skip + limit);
  
  const metas = page.map(s => formatMeta(s));
  
  return jsonResponse({ metas });
}

/**
 * Normalize a genre name using synonym mapping
 * "3D Hentai" -> "3d", "Big Tits" -> "big boobs", etc.
 */
function normalizeGenre(genre) {
  const lower = genre.toLowerCase().trim();
  return GENRE_SYNONYMS[lower] || lower;
}

/**
 * Check if a series matches a genre filter (with synonym support)
 * e.g., filter "3D" should match series with "3D Hentai", "3D Works", etc.
 */
function seriesMatchesGenre(series, filterGenre) {
  const normalizedFilter = normalizeGenre(filterGenre);
  return (series.genres || []).some(g => normalizeGenre(g) === normalizedFilter);
}

function filterByCatalog(series, catalogId, extra) {
  let filtered = [...series];
  const genre = extra.genre;
  
  switch (catalogId) {
    case 'hentai-top-rated':
      if (genre) {
        const genreLower = genre.toLowerCase().replace(/\s*\(\d+\)$/, '');
        // Use normalized genre matching (e.g., "3D" matches "3D Hentai", "3D Works", etc.)
        filtered = filtered.filter(s => seriesMatchesGenre(s, genreLower));
      }
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
      
    case 'hentai-monthly':
      if (genre) {
        const now = Date.now();
        const periods = {
          'this week': 7 * 24 * 60 * 60 * 1000,
          'this month': 30 * 24 * 60 * 60 * 1000,
          '3 months': 90 * 24 * 60 * 60 * 1000,
          'this year': 365 * 24 * 60 * 60 * 1000
        };
        const periodKey = genre.toLowerCase().replace(/\s*\(\d+\)$/, '');
        const periodMs = periods[periodKey] || periods['this month'];
        
        filtered = filtered.filter(s => {
          // Use lastUpdated (when episode was added), fall back to releaseInfo year
          const dateStr = s.lastUpdated || s.releaseDate;
          if (!dateStr) return false;
          const itemDate = new Date(dateStr).getTime();
          if (isNaN(itemDate)) return false;
          return (now - itemDate) <= periodMs;
        });
      }
      filtered.sort((a, b) => {
        const dateA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
        const dateB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
        return dateB - dateA;
      });
      break;
      
    case 'hentai-studios':
      if (genre) {
        const studioLower = genre.toLowerCase().replace(/\s*\(\d+\)$/, '');
        filtered = filtered.filter(s => 
          (s.studio || '').toLowerCase() === studioLower
        );
      }
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
      
    case 'hentai-years':
      if (genre) {
        const year = genre.replace(/\s*\(\d+\)$/, '');
        filtered = filtered.filter(s => {
          // Use year field directly, or extract from releaseInfo/lastUpdated
          const itemYear = s.year || s.releaseInfo || 
            (s.lastUpdated ? new Date(s.lastUpdated).getFullYear().toString() : '');
          return itemYear.toString() === year;
        });
      }
      filtered.sort((a, b) => {
        const dateA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
        const dateB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
        return dateB - dateA;
      });
      break;
      
    case 'hentai-all':
      if (genre) {
        const genreLower = genre.toLowerCase().replace(/\s*\(\d+\)$/, '');
        // Use normalized genre matching (e.g., "3D" matches "3D Hentai", "3D Works", etc.)
        filtered = filtered.filter(s => seriesMatchesGenre(s, genreLower));
      }
      filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
      
    case 'hentai-search':
      if (extra.search) {
        const query = extra.search.toLowerCase();
        filtered = filtered.filter(s => 
          (s.name || '').toLowerCase().includes(query) ||
          (s.description || '').toLowerCase().includes(query)
        );
      }
      break;
      
    default:
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }
  
  return filtered;
}

async function handleMeta(path) {
  const match = path.match(/\/meta\/([^/]+)\/([^/]+)\.json/);
  if (!match) {
    return jsonResponse({ meta: null });
  }
  
  const [, type, id] = match;
  
  const catalogData = await fetchGitHub('catalog', GITHUB_URLS.catalog);
  const series = Array.isArray(catalogData) ? catalogData : 
                 (catalogData.catalog || catalogData.series || []);
  
  const item = series.find(s => s.id === id);
  if (!item) {
    return jsonResponse({ meta: null });
  }
  
  const meta = formatFullMeta(item);
  
  return jsonResponse({ meta });
}

// ============================================================================
// STREAM HANDLER - INLINE SCRAPERS
// ============================================================================

async function handleStream(path) {
  const match = path.match(/\/stream\/([^/]+)\/([^/]+)\.json/);
  if (!match) {
    return jsonResponse({ streams: [] });
  }
  
  const [, type, id] = match;
  
  // Determine provider from ID prefix
  if (id.startsWith('hmm-')) {
    return await getHentaiMamaStreams(id);
  } else if (id.startsWith('hse-')) {
    return await getHentaiSeaStreams(id);
  } else if (id.startsWith('htv-')) {
    return await getHentaiTVStreams(id);
  }
  
  return jsonResponse({ streams: [] });
}

// ============================================================================
// HENTAIMAMA SCRAPER
// ============================================================================

async function getHentaiMamaStreams(episodeId) {
  try {
    const cleanId = episodeId.replace('hmm-', '');
    const pageUrl = `https://hentaimama.io/episodes/${cleanId}`;
    
    console.log(`[HentaiMama] Fetching streams for: ${cleanId}`);
    
    const pageResponse = await fetch(pageUrl, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    if (!pageResponse.ok) {
      if (pageResponse.status === 404) {
        return jsonResponse({ streams: [] });
      }
      throw new Error(`Page fetch failed: ${pageResponse.status}`);
    }
    
    const html = await pageResponse.text();
    
    // Check RAW status
    const seriesSlug = cleanId.replace(/-episode-\d+$/, '');
    let isRaw = false;
    
    try {
      const seriesPageUrl = `https://hentaimama.io/tvshows/${seriesSlug}/`;
      const seriesResponse = await fetch(seriesPageUrl, {
        headers: { 'User-Agent': getRandomUserAgent() }
      });
      
      if (seriesResponse.ok) {
        const seriesHtml = await seriesResponse.text();
        const episodeRegex = new RegExp(`episodes/${cleanId}[^"]*"[^>]*>[\\s\\S]*?status-raw`, 'i');
        isRaw = episodeRegex.test(seriesHtml);
      }
    } catch (e) {
      console.log(`[HentaiMama] Could not check RAW status: ${e.message}`);
    }
    
    // Look for AJAX parameters
    const actionMatch = html.match(/action:\s*['"]([^'"]+)['"]/);
    const aMatch = html.match(/a:\s*['"]?(\d+)['"]?/);
    
    let streams = [];
    
    if (actionMatch && aMatch) {
      console.log(`[HentaiMama] Found AJAX: action=${actionMatch[1]}, a=${aMatch[1]}`);
      
      const formData = new URLSearchParams({
        action: actionMatch[1],
        a: aMatch[1]
      });
      
      const ajaxResponse = await fetch('https://hentaimama.io/wp-admin/admin-ajax.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': getRandomUserAgent(),
          'Referer': pageUrl
        },
        body: formData.toString()
      });
      
      if (ajaxResponse.ok) {
        let ajaxData;
        try {
          ajaxData = await ajaxResponse.json();
        } catch {
          ajaxData = null;
        }
        
        if (Array.isArray(ajaxData)) {
          console.log(`[HentaiMama] Got ${ajaxData.length} player iframes`);
          
          for (const iframeHtml of ajaxData) {
            const srcMatch = iframeHtml.match(/src=["']([^"']+)["']/);
            if (srcMatch) {
              try {
                console.log(`[HentaiMama] Fetching iframe: ${srcMatch[1]}`);
                const iframeResponse = await fetch(srcMatch[1], {
                  headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Referer': pageUrl
                  }
                });
                
                if (iframeResponse.ok) {
                  const iframeContent = await iframeResponse.text();
                  const sources = extractVideoSources(iframeContent);
                  if (sources.length > 0) {
                    streams = sources;
                    break;
                  }
                }
              } catch (e) {
                console.log(`[HentaiMama] Iframe fetch error: ${e.message}`);
              }
            }
          }
        }
      }
    }
    
    if (streams.length === 0) {
      streams = extractVideoSources(html);
    }
    
    const formattedStreams = streams.map(s => ({
      name: `HentaiMama${isRaw ? ' - RAW' : ''}`,
      title: `${s.quality || 'HD'}${isRaw ? ' (No Subs)' : ''}`,
      url: s.file || s.url,
      behaviorHints: { notWebReady: false }
    }));
    
    console.log(`[HentaiMama] Found ${formattedStreams.length} streams${isRaw ? ' (RAW)' : ''}`);
    
    return jsonResponse({ streams: formattedStreams });
    
  } catch (error) {
    console.error(`[HentaiMama] Error: ${error.message}`);
    return jsonResponse({ streams: [], error: error.message });
  }
}

// ============================================================================
// HENTAISEA SCRAPER
// ============================================================================

async function getHentaiSeaStreams(episodeId) {
  try {
    const episodeSlug = episodeId.replace('hse-', '');
    const pageUrl = `https://hentaisea.com/episodes/${episodeSlug}/`;
    
    console.log(`[HentaiSea] Fetching streams for: ${episodeSlug}`);
    
    const pageResponse = await fetch(pageUrl, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    if (!pageResponse.ok) {
      if (pageResponse.status === 404) {
        return jsonResponse({ streams: [] });
      }
      throw new Error(`Page fetch failed: ${pageResponse.status}`);
    }
    
    const html = await pageResponse.text();
    const streams = [];
    
    // Try dooplay_player AJAX
    const postIdMatch = html.match(/data-post=['"](\d+)['"]/);
    const numeMatch = html.match(/data-nume=['"](\d+)['"]/);
    
    if (postIdMatch && numeMatch) {
      console.log(`[HentaiSea] Trying AJAX: post=${postIdMatch[1]}, nume=${numeMatch[1]}`);
      
      try {
        const formData = new URLSearchParams({
          action: 'doo_player_ajax',
          post: postIdMatch[1],
          nume: numeMatch[1],
          type: 'tv'
        });
        
        const ajaxResponse = await fetch('https://hentaisea.com/wp-admin/admin-ajax.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': getRandomUserAgent(),
            'Referer': pageUrl,
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: formData.toString()
        });
        
        if (ajaxResponse.ok) {
          const responseText = await ajaxResponse.text();
          
          // Try to get jwplayer URL
          const iframeSrcMatch = responseText.match(/src=['"]([^'"]+jwplayer[^'"]+)['"]/);
          if (iframeSrcMatch) {
            let jwplayerUrl = iframeSrcMatch[1];
            if (jwplayerUrl.startsWith('//')) {
              jwplayerUrl = 'https:' + jwplayerUrl;
            }
            
            console.log(`[HentaiSea] Found jwplayer URL`);
            
            // Fetch jwplayer page
            const jwResponse = await fetch(jwplayerUrl, {
              headers: {
                'User-Agent': getRandomUserAgent(),
                'Referer': pageUrl
              }
            });
            
            if (jwResponse.ok) {
              const jwHtml = await jwResponse.text();
              const sourceMatch = jwHtml.match(/source=([^&'"]+)/);
              if (sourceMatch) {
                const videoUrl = decodeURIComponent(sourceMatch[1]);
                if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
                  streams.push({
                    url: videoUrl,
                    title: 'HentaiSea MP4'
                  });
                }
              }
              
              // Fallback: look for file pattern
              if (streams.length === 0) {
                const fileMatch = jwHtml.match(/file["']?\s*[:=]\s*["']([^"']+\.(mp4|m3u8)[^"']*)/i);
                if (fileMatch) {
                  streams.push({
                    url: fileMatch[1],
                    title: 'HentaiSea MP4'
                  });
                }
              }
            }
          }
          
          // Fallback: direct source extraction
          if (streams.length === 0) {
            const sourceMatch = responseText.match(/source=([^&'"]+)/);
            if (sourceMatch) {
              const videoUrl = decodeURIComponent(sourceMatch[1]);
              if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
                streams.push({
                  url: videoUrl,
                  title: 'HentaiSea MP4'
                });
              }
            }
          }
        }
      } catch (ajaxErr) {
        console.log(`[HentaiSea] AJAX failed: ${ajaxErr.message}`);
      }
    }
    
    // Fallback: direct video sources
    if (streams.length === 0) {
      const sources = extractVideoSources(html);
      streams.push(...sources.map(s => ({ url: s.file, title: 'HentaiSea MP4' })));
    }
    
    const formattedStreams = streams.map(s => ({
      name: 'HentaiSea',
      title: s.title || 'HD',
      url: s.url,
      behaviorHints: { notWebReady: s.url?.includes('.m3u8') || false }
    }));
    
    console.log(`[HentaiSea] Found ${formattedStreams.length} streams`);
    
    return jsonResponse({ streams: formattedStreams });
    
  } catch (error) {
    console.error(`[HentaiSea] Error: ${error.message}`);
    return jsonResponse({ streams: [], error: error.message });
  }
}

// ============================================================================
// HENTAITV SCRAPER
// ============================================================================

const HTV_PLUS_PATTERNS = [
  { from: /^1ldk-jk-/i, to: '1ldk-+-jk-' }
];
const HTV_REMOVABLE_PREFIXES = ['ova-', 'ona-', 'special-'];

async function getHentaiTVStreams(episodeId) {
  try {
    let slug = episodeId.replace('htv-', '');
    console.log(`[HentaiTV] Fetching streams for: ${slug}`);
    
    const episodeUrl = `https://hentai.tv/hentai/${slug}/`;
    const streams = [];
    
    const response = await fetch(episodeUrl, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': 'inter=1'
      },
      redirect: 'follow'
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return jsonResponse({ streams: [] });
      }
      throw new Error(`Page fetch failed: ${response.status}`);
    }
    
    const html = await response.text();
    const isInterstitial = html.toLowerCase().includes('lnter') || html.toLowerCase().includes('interstitial');
    
    if (isInterstitial) {
      console.log(`[HentaiTV] Hit interstitial page for ${slug}`);
      
      // Try direct video URL
      const videoSlugVariations = generateHtvVideoSlugVariations(slug);
      
      for (const videoSlug of videoSlugVariations) {
        const videoUrl = `https://r2.1hanime.com/${videoSlug}.mp4`;
        
        try {
          const headResponse = await fetch(videoUrl, {
            method: 'HEAD',
            headers: { 'Referer': 'https://nhplayer.com/' }
          });
          
          if (headResponse.ok) {
            streams.push({ url: videoUrl, title: 'HentaiTV MP4' });
            console.log(`[HentaiTV] Direct URL works!`);
            break;
          }
        } catch (e) {}
      }
    } else {
      console.log(`[HentaiTV] Got actual episode page`);
      
      // Check for nhplayer
      const nhplayerMatch = html.match(/nhplayer\.com\/v\/([a-zA-Z0-9]+)/);
      if (nhplayerMatch) {
        const nhplayerId = nhplayerMatch[1];
        console.log(`[HentaiTV] Found nhplayer ID: ${nhplayerId}`);
        
        try {
          const nhResponse = await fetch(`https://nhplayer.com/v/${nhplayerId}/`, {
            headers: {
              'User-Agent': getRandomUserAgent(),
              'Referer': 'https://hentai.tv/'
            }
          });
          
          if (nhResponse.ok) {
            const nhHtml = await nhResponse.text();
            const dataIdMatch = nhHtml.match(/data-id=["']([^"']+)/);
            if (dataIdMatch) {
              const urlMatch = dataIdMatch[1].match(/u=([^&]+)/);
              if (urlMatch) {
                try {
                  const videoUrl = atob(urlMatch[1]);
                  if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
                    streams.push({ url: videoUrl, title: 'HentaiTV MP4' });
                  }
                } catch (e) {}
              }
            }
          }
        } catch (e) {
          console.log(`[HentaiTV] nhplayer fetch failed: ${e.message}`);
        }
      }
      
      // Look for direct video URLs
      if (streams.length === 0) {
        const sources = extractVideoSources(html);
        streams.push(...sources.map(s => ({ url: s.file, title: 'HentaiTV MP4' })));
      }
    }
    
    // Fallback: try direct URL
    if (streams.length === 0) {
      const videoSlugVariations = generateHtvVideoSlugVariations(slug);
      for (const videoSlug of videoSlugVariations) {
        const videoUrl = `https://r2.1hanime.com/${videoSlug}.mp4`;
        
        try {
          const headResponse = await fetch(videoUrl, {
            method: 'HEAD',
            headers: { 'Referer': 'https://nhplayer.com/' }
          });
          
          if (headResponse.ok) {
            streams.push({ url: videoUrl, title: 'HentaiTV MP4' });
            break;
          }
        } catch (e) {}
      }
    }
    
    const formattedStreams = streams.map(s => ({
      name: 'HentaiTV',
      title: s.title || 'HD',
      url: s.url,
      behaviorHints: {
        notWebReady: s.url?.includes('.m3u8') || false,
        proxyHeaders: {
          request: { 'Referer': 'https://nhplayer.com/' }
        }
      }
    }));
    
    console.log(`[HentaiTV] Found ${formattedStreams.length} streams`);
    
    return jsonResponse({ streams: formattedStreams });
    
  } catch (error) {
    console.error(`[HentaiTV] Error: ${error.message}`);
    return jsonResponse({ streams: [], error: error.message });
  }
}

function generateHtvVideoSlugVariations(episodeSlug) {
  const baseSlug = episodeSlug.replace(/-episode-(\d+)$/, '-$1');
  const variations = [baseSlug];
  
  for (const prefix of HTV_REMOVABLE_PREFIXES) {
    if (baseSlug.toLowerCase().startsWith(prefix)) {
      const withoutPrefix = baseSlug.substring(prefix.length);
      variations.unshift(withoutPrefix);
    }
  }
  
  for (const pattern of HTV_PLUS_PATTERNS) {
    if (pattern.from.test(baseSlug)) {
      const plusSlug = baseSlug.replace(pattern.from, pattern.to);
      variations.unshift(plusSlug);
    }
  }
  
  const altSlug = episodeSlug.replace(/-episode-/, '-');
  if (!variations.includes(altSlug)) {
    variations.push(altSlug);
  }
  
  return variations;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function extractVideoSources(html) {
  const sources = [];
  
  // Pattern 1: sources array
  const sourcesMatch = html.match(/sources:\s*(\[[\s\S]*?\])/);
  if (sourcesMatch) {
    try {
      const sourcesStr = sourcesMatch[1]
        .replace(/'/g, '"')
        .replace(/(\w+):/g, '"$1":')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*\]/g, ']');
      const parsed = JSON.parse(sourcesStr);
      if (Array.isArray(parsed)) {
        sources.push(...parsed.filter(s => s.file));
      }
    } catch (e) {
      const fileMatches = html.match(/"file"\s*:\s*"([^"]+)"/g);
      if (fileMatches) {
        for (const m of fileMatches) {
          const urlMatch = m.match(/"file"\s*:\s*"([^"]+)"/);
          if (urlMatch) {
            sources.push({ file: urlMatch[1], quality: 'HD' });
          }
        }
      }
    }
  }
  
  // Pattern 2: file: "url"
  if (sources.length === 0) {
    const fileMatches = html.match(/file:\s*["']([^"']+\.mp4[^"']*)/gi);
    if (fileMatches) {
      for (const m of fileMatches) {
        const urlMatch = m.match(/file:\s*["']([^"']+)/i);
        if (urlMatch && !sources.some(s => s.file === urlMatch[1])) {
          sources.push({ file: urlMatch[1], quality: 'HD' });
        }
      }
    }
  }
  
  // Pattern 3: Direct URLs
  if (sources.length === 0) {
    const urlMatches = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi);
    if (urlMatches) {
      for (const url of urlMatches) {
        if (!url.includes('thumbnail') && !url.includes('poster') && !sources.some(s => s.file === url)) {
          sources.push({ file: url, quality: 'HD' });
        }
      }
    }
  }
  
  return sources;
}

function parseExtra(extraStr) {
  const extra = {};
  if (!extraStr) return extra;
  
  // Stremio can send extras in multiple formats:
  // 1. genre=3D&skip=100 (URL query string format)
  // 2. genre=3D/skip=100 (path segment format - more common)
  // We need to handle both
  
  // First split by / to handle path segments
  // Then for each segment, split by & to handle query params
  const parts = extraStr.split('/').flatMap(segment => segment.split('&'));
  
  parts.forEach(part => {
    const [key, ...valueParts] = part.split('=');
    const value = valueParts.join('=');
    if (key && value !== undefined) {
      extra[key] = decodeURIComponent(value);
    }
  });
  
  return extra;
}

function formatMeta(series) {
  // Calculate rating from ratingBreakdown if available
  let rating = series.rating;
  if (!rating && series.ratingBreakdown) {
    const breakdown = series.ratingBreakdown;
    // Priority: HentaiMama > HentaiTV > HentaiSea
    rating = breakdown.hmm || breakdown.htv || breakdown.hse || null;
  }
  
  return {
    id: series.id,
    type: 'series',
    name: series.name,
    poster: series.poster,
    posterShape: 'poster',
    genres: series.genres || [],
    description: series.description,
    runtime: rating ? `★ ${Number(rating).toFixed(1)}` : '★ N/A'
  };
}

function formatFullMeta(series) {
  // Calculate rating from ratingBreakdown if available
  let rating = series.rating;
  if (!rating && series.ratingBreakdown) {
    const breakdown = series.ratingBreakdown;
    rating = breakdown.hmm || breakdown.htv || breakdown.hse || null;
  }
  
  const meta = {
    id: series.id,
    type: 'series',
    name: series.name,
    poster: series.poster,
    posterShape: 'poster',
    background: series.background || series.poster,
    genres: series.genres || [],
    description: series.description,
    runtime: rating ? `★ ${Number(rating).toFixed(1)}` : '★ N/A',
    releaseInfo: series.year || series.releaseInfo || undefined,
    director: series.studio ? [series.studio] : undefined
  };
  
  // Build links for Stremio UI (clickable genres and studio)
  const links = [];
  if (series.genres && series.genres.length > 0) {
    for (const genre of series.genres) {
      links.push({
        name: genre,
        category: 'Genres',
        url: `stremio:///search?search=${encodeURIComponent(genre)}`
      });
    }
  }
  if (series.studio) {
    links.push({
      name: series.studio,
      category: 'Studio',
      url: `stremio:///search?search=${encodeURIComponent(series.studio)}`
    });
  }
  if (links.length > 0) {
    meta.links = links;
  }
  
  if (series.episodes && series.episodes.length > 0) {
    meta.videos = series.episodes.map((ep, idx) => ({
      id: ep.id || `${series.id}:${idx + 1}`,
      title: ep.title || `Episode ${idx + 1}`,
      season: 1,
      episode: ep.number || idx + 1,
      // Database stores ep.released (not ep.releaseDate)
      released: ep.released || ep.releaseDate || ep.lastUpdated || series.lastUpdated,
      // Database stores ep.poster (not ep.thumbnail)
      thumbnail: ep.poster || ep.thumbnail || series.poster
    }));
  }
  
  return meta;
}

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
