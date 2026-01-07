/**
 * HentaiMama Scraper - Cloudflare Worker
 * 
 * Ultra-lightweight stream scraper using regex (no cheerio)
 * Memory: ~5MB | CPU: <50ms
 * 
 * Endpoints:
 * - ?action=stream&id=series-slug-episode-1
 */

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const episodeId = url.searchParams.get('id');

    if (!episodeId) {
      return jsonResponse({ error: 'Missing id parameter' }, 400, corsHeaders);
    }

    try {
      // Check Workers KV cache first (instant response)
      const cacheKey = `stream:hmm:${episodeId}`;
      if (env.STREAM_CACHE) {
        const cached = await env.STREAM_CACHE.get(cacheKey);
        if (cached) {
          return new Response(cached, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=180',
              'X-Cache': 'HIT'
            }
          });
        }
      }

      // Fetch episode page
      const episodeUrl = `https://hentaimama.io/episodes/${episodeId}`;
      const response = await fetch(episodeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        cf: {
          cacheTtl: 180,
          cacheEverything: true,
        }
      });

      if (!response.ok) {
        return jsonResponse({ error: `HTTP ${response.status}` }, response.status, corsHeaders);
      }

      const html = await response.text();

      // Extract streams using regex (fast, low memory)
      const streams = extractStreams(html, episodeId);

      const result = { streams };
      const json = JSON.stringify(result);

      // Cache in Workers KV (persist for 3 minutes)
      if (env.STREAM_CACHE) {
        ctx.waitUntil(env.STREAM_CACHE.put(cacheKey, json, { expirationTtl: 180 }));
      }

      return new Response(json, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=180',
          'X-Cache': 'MISS'
        }
      });

    } catch (error) {
      return jsonResponse({ error: error.message, stack: error.stack }, 500, corsHeaders);
    }
  }
};

/**
 * Extract streams from HTML using regex (NO cheerio - saves 30MB RAM)
 */
function extractStreams(html, episodeId) {
  const streams = [];

  // Method 1: Find player iframes - <iframe src="https://hentaimama.io/new2.php?p=..."
  const iframeRegex = /src="(https:\/\/hentaimama\.io\/new2\.php\?p=([^"&]+))"/g;
  const iframeMatches = [...html.matchAll(iframeRegex)];

  for (const match of iframeMatches) {
    const iframeUrl = match[1];
    const pParam = match[2];

    if (pParam) {
      try {
        // Decode base64 param to get video path
        const decoded = atob(pParam);
        
        // Extract quality from path
        let quality = 'SD';
        if (/1080p?/i.test(decoded)) quality = '1080p';
        else if (/720p?/i.test(decoded)) quality = '720p';
        else if (/480p?/i.test(decoded)) quality = '480p';

        // Build stream URL
        const videoPath = decoded.startsWith('/') ? decoded : '/' + decoded;
        
        streams.push({
          provider: 'HentaiMama',
          quality,
          url: `https://hentaimama.io${videoPath}`,
          iframeUrl
        });
      } catch (e) {
        // Skip invalid base64
      }
    }
  }

  // Method 2: Direct video sources - <source src="..." type="video/mp4">
  const sourceRegex = /<source[^>]+src="([^"]+)"[^>]*type="video\/mp4"/g;
  const sourceMatches = [...html.matchAll(sourceRegex)];

  for (const match of sourceMatches) {
    const videoUrl = match[1];
    
    if (videoUrl && videoUrl.startsWith('http')) {
      let quality = 'SD';
      if (/1080p?/i.test(videoUrl)) quality = '1080p';
      else if (/720p?/i.test(videoUrl)) quality = '720p';
      else if (/480p?/i.test(videoUrl)) quality = '480p';

      // Avoid duplicates
      if (!streams.some(s => s.url === videoUrl)) {
        streams.push({
          provider: 'HentaiMama',
          quality,
          url: videoUrl
        });
      }
    }
  }

  // Check for RAW indicator (unsubtitled content)
  const isRaw = /<span[^>]*class="[^"]*status-raw[^"]*"/.test(html);

  // Add RAW flag to all streams
  streams.forEach(s => {
    s.isRaw = isRaw;
  });

  return streams;
}

/**
 * Helper to create JSON response
 */
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    }
  });
}
