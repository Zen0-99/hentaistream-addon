/**
 * HentaiTV Scraper - Cloudflare Worker
 * 
 * Ultra-lightweight stream scraper using regex (no cheerio)
 * Memory: ~5MB | CPU: <50ms
 * 
 * Endpoints:
 * - ?action=stream&id=series-slug-episode-1
 * - ?action=search&q=series-name&episode=1
 */

// Build headers that mimic a real browser (required to bypass Cloudflare)
function buildBrowserHeaders(referer = null) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
  if (referer) {
    headers['Referer'] = referer;
    headers['Sec-Fetch-Site'] = 'same-origin';
  }
  return headers;
}

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
    const action = url.searchParams.get('action');
    const episodeId = url.searchParams.get('id');
    const searchQuery = url.searchParams.get('q');
    const episodeNum = url.searchParams.get('episode');

    try {
      // Search mode: find episode via WordPress API
      if (action === 'search' && searchQuery) {
        return await handleSearch(searchQuery, episodeNum, env, ctx, corsHeaders);
      }

      // Stream mode: direct episode fetch
      if (!episodeId) {
        return jsonResponse({ error: 'Missing id parameter' }, 400, corsHeaders);
      }

      // Check Workers KV cache
      const cacheKey = `stream:htv:${episodeId}`;
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

      // Extract series slug from episode ID
      const seriesSlug = episodeId.replace(/-episode-\d+$/, '');
      const epNum = episodeId.match(/episode-(\d+)$/)?.[1] || '1';

      // Try WordPress API to find actual episode slug
      const apiUrl = `https://hentai.tv/wp-json/wp/v2/episodes?search=${encodeURIComponent(seriesSlug)}&per_page=10`;
      const apiResponse = await fetch(apiUrl, {
        headers: buildBrowserHeaders()
      });

      let actualSlug = episodeId;

      if (apiResponse.ok) {
        const episodes = await apiResponse.json();
        
        // Find matching episode
        for (const ep of episodes) {
          const title = ep.title?.rendered || '';
          const epMatch = title.match(/Episode\s+(\d+)/i);
          
          if (epMatch && epMatch[1] === epNum) {
            // Extract slug from link
            const linkMatch = ep.link?.match(/\/hentai\/([^\/]+)/);
            if (linkMatch) {
              actualSlug = linkMatch[1];
              break;
            }
          }
        }
      }

      // Fetch episode page with full browser headers
      const episodeUrl = `https://hentai.tv/hentai/${actualSlug}/`;
      const response = await fetch(episodeUrl, {
        headers: buildBrowserHeaders(),
        redirect: 'manual' // Detect interstitial redirects
      });

      // Check for interstitial page
      if (response.status === 302 || response.status === 301) {
        // Try direct R2 URL pattern
        const directUrl = `https://r2.1hanime.com/${seriesSlug}-${epNum}.mp4`;
        
        const streams = [{
          provider: 'HentaiTV',
          quality: 'HD',
          url: directUrl,
          note: 'Direct R2 link (may not work)'
        }];

        const result = { streams };
        const json = JSON.stringify(result);

        return new Response(json, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=180'
          }
        });
      }

      if (!response.ok) {
        return jsonResponse({ error: `HTTP ${response.status}` }, response.status, corsHeaders);
      }

      const html = await response.text();

      // Extract streams from HTML
      const streams = extractStreams(html);

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
 * Handle search via WordPress API
 */
async function handleSearch(query, episodeNum, env, ctx, corsHeaders) {
  const apiUrl = `https://hentai.tv/wp-json/wp/v2/episodes?search=${encodeURIComponent(query)}&per_page=10`;
  
  const response = await fetch(apiUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  if (!response.ok) {
    return jsonResponse({ error: 'WordPress API error' }, response.status, corsHeaders);
  }

  const episodes = await response.json();
  
  // Find episode matching number
  for (const ep of episodes) {
    const title = ep.title?.rendered || '';
    const epMatch = title.match(/Episode\s+(\d+)/i);
    
    if (epMatch && epMatch[1] === episodeNum) {
      const linkMatch = ep.link?.match(/\/hentai\/([^\/]+)/);
      if (linkMatch) {
        return jsonResponse({ 
          found: true, 
          slug: linkMatch[1],
          title: title
        }, 200, corsHeaders);
      }
    }
  }

  return jsonResponse({ found: false }, 404, corsHeaders);
}

/**
 * Extract video streams from HTML
 */
function extractStreams(html) {
  const streams = [];

  // Method 1: Find video tags with source
  const videoRegex = /<video[^>]*>[\s\S]*?<source[^>]+src="([^"]+)"[\s\S]*?<\/video>/g;
  const videoMatches = [...html.matchAll(videoRegex)];

  for (const match of videoMatches) {
    const videoUrl = match[1];
    
    if (videoUrl && videoUrl.startsWith('http')) {
      streams.push({
        provider: 'HentaiTV',
        quality: 'HD',
        url: videoUrl
      });
    }
  }

  // Method 2: Direct source tags
  const sourceRegex = /<source[^>]+src="([^"]+)"[^>]*>/g;
  const sourceMatches = [...html.matchAll(sourceRegex)];

  for (const match of sourceMatches) {
    const videoUrl = match[1];
    
    if (videoUrl && videoUrl.startsWith('http') && !streams.some(s => s.url === videoUrl)) {
      streams.push({
        provider: 'HentaiTV',
        quality: 'HD',
        url: videoUrl
      });
    }
  }

  return streams;
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
