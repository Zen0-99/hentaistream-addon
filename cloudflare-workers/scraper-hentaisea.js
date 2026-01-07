/**
 * HentaiSea Scraper - Cloudflare Worker
 * 
 * Ultra-lightweight stream scraper using regex (no cheerio)
 * Memory: ~5MB | CPU: <50ms
 * 
 * Endpoints:
 * - ?action=stream&id=series-slug-episode-1
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const episodeId = url.searchParams.get('id');

    if (!episodeId) {
      return jsonResponse({ error: 'Missing id parameter' }, 400, corsHeaders);
    }

    try {
      // Check Workers KV cache
      const cacheKey = `stream:hse:${episodeId}`;
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
      const episodeUrl = `https://hentaisea.com/episodes/${episodeId}/`;
      const response = await fetch(episodeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Referer': 'https://hentaisea.com/'
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

      // Extract post ID and player number for AJAX call
      const { postId, nume } = extractPlayerData(html);

      if (!postId) {
        return jsonResponse({ error: 'Could not find player data' }, 404, corsHeaders);
      }

      // Make AJAX call to get jwplayer URL
      const ajaxUrl = 'https://hentaisea.com/wp-admin/admin-ajax.php';
      const ajaxBody = `action=doo_player_ajax&post=${postId}&nume=${nume}&type=movie`;

      const ajaxResponse = await fetch(ajaxUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': episodeUrl,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: ajaxBody
      });

      const ajaxData = await ajaxResponse.text();

      // Extract jwplayer URL from response
      const jwplayerUrlMatch = ajaxData.match(/https:\/\/hentaisea\.com\/jwplayer\/\?[^"'\s<>]+/);
      
      if (!jwplayerUrlMatch) {
        return jsonResponse({ error: 'Could not find jwplayer URL' }, 404, corsHeaders);
      }

      const jwplayerUrl = jwplayerUrlMatch[0]
        .replace(/\\u0026/g, '&')
        .replace(/&amp;/g, '&');

      const streams = [{
        provider: 'HentaiSea',
        quality: 'HD', // HentaiSea doesn't specify quality
        jwplayerUrl, // Return this for the addon to proxy
        needsProxy: true,
        proxyType: 'jwplayer'
      }];

      const result = { streams };
      const json = JSON.stringify(result);

      // Cache in Workers KV
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
      return jsonResponse({ error: error.message }, 500, corsHeaders);
    }
  }
};

/**
 * Extract player data from HTML
 */
function extractPlayerData(html) {
  // Find play button with data attributes
  const dataPostMatch = html.match(/data-post\s*=\s*["'](\d+)["']/);
  const dataNumeMatch = html.match(/data-nume\s*=\s*["'](\d+)["']/);

  return {
    postId: dataPostMatch ? dataPostMatch[1] : null,
    nume: dataNumeMatch ? dataNumeMatch[1] : '1'
  };
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    }
  });
}
