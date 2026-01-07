/**
 * HentaiMama Scraper - Cloudflare Worker
 * 
 * Ultra-lightweight stream scraper using regex (no cheerio)
 * Memory: ~5MB | CPU: <50ms
 * 
 * Endpoints:
 * - ?action=stream&id=series-slug-episode-1
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

      // Fetch episode page with full browser headers
      const episodeUrl = `https://hentaimama.io/episodes/${episodeId}`;
      const response = await fetch(episodeUrl, {
        headers: buildBrowserHeaders(),
        redirect: 'follow',  // Explicitly follow redirects
        cf: {
          cacheTtl: 180,
          cacheEverything: true,
        }
      });

      if (!response.ok) {
        return jsonResponse({ error: `HTTP ${response.status}` }, response.status, corsHeaders);
      }

      const html = await response.text();

      // Extract streams using WordPress AJAX (matches original scraper)
      const streams = await extractStreams(html, episodeId, episodeUrl);

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
 * Extract all script tag contents from HTML (like cheerio does)
 */
function extractScriptContents(html) {
  const scripts = [];
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1] && match[1].trim()) {
      scripts.push(match[1]);
    }
  }
  return scripts.join('\n');
}

/**
 * Extract streams using WordPress AJAX (matches original scraper logic)
 */
async function extractStreams(html, episodeId, episodeUrl) {
  const streams = [];

  // Step 1: Extract all script content (like original scraper does with cheerio)
  const scriptContent = extractScriptContents(html);
  
  // Step 2: Extract AJAX parameters from script content
  const actionMatch = scriptContent.match(/action:\s*['"]([^'"]+)['"]/);
  const aMatch = scriptContent.match(/a:\s*['"]?(\d+)['"]?/);

  if (!actionMatch || !aMatch) {
    return streams; // No AJAX data found
  }

  const action = actionMatch[1];
  const aParam = aMatch[1];

  try {
    // Step 2: Make WordPress AJAX call with browser headers
    const ajaxUrl = 'https://hentaimama.io/wp-admin/admin-ajax.php';
    const formData = new URLSearchParams({
      action: action,
      a: aParam
    });

    const ajaxHeaders = buildBrowserHeaders(episodeUrl);
    ajaxHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    ajaxHeaders['X-Requested-With'] = 'XMLHttpRequest';

    const ajaxResponse = await fetch(ajaxUrl, {
      method: 'POST',
      headers: ajaxHeaders,
      body: formData.toString(),
      cf: {
        cacheTtl: 180,
        cacheEverything: true,
      }
    });

    if (!ajaxResponse.ok) {
      return streams;
    }

    let iframeHtmlArray;
    try {
      iframeHtmlArray = await ajaxResponse.json();
    } catch (e) {
      return streams;
    }
    
    if (!Array.isArray(iframeHtmlArray) || iframeHtmlArray.length === 0) {
      return streams;
    }

    // Step 3: Extract iframe URLs and fetch each one
    for (const iframeHtml of iframeHtmlArray) {
      const srcMatch = iframeHtml.match(/src=["']([^"']+)["']/);
      if (!srcMatch) continue;

      const iframeUrl = srcMatch[1];
      
      try {
        const iframeResponse = await fetch(iframeUrl, {
          headers: buildBrowserHeaders(episodeUrl),
          cf: {
            cacheTtl: 180,
            cacheEverything: true,
          }
        });

        if (!iframeResponse.ok) continue;

        const iframeHtmlContent = await iframeResponse.text();

        // Step 4: Extract video sources from iframe using multiple patterns
        
        // Pattern 1: file: "url" (without quotes around key - JS object syntax)
        const fileMatches = iframeHtmlContent.match(/file:\s*"([^"]+)"/g);
        if (fileMatches) {
          for (const fileMatch of fileMatches) {
            const urlMatch = fileMatch.match(/file:\s*"([^"]+)"/);
            if (urlMatch) {
              const videoUrl = urlMatch[1];
              
              // Skip non-video URLs
              if (!videoUrl || videoUrl.includes('.vtt') || videoUrl.includes('.srt')) continue;
              
              // Detect quality from URL
              let quality = 'HD';
              if (/1080p?/i.test(videoUrl)) quality = '1080p';
              else if (/720p?/i.test(videoUrl)) quality = '720p';
              else if (/480p?/i.test(videoUrl)) quality = '480p';

              if (!streams.some(s => s.url === videoUrl)) {
                streams.push({
                  provider: 'HentaiMama',
                  quality,
                  url: videoUrl
                });
              }
            }
          }
        }
        
        // Pattern 2: "file":"url" (JSON syntax) - fallback
        if (streams.length === 0) {
          const jsonFileMatches = iframeHtmlContent.match(/"file"\s*:\s*"([^"]+)"/g);
          if (jsonFileMatches) {
            for (const fm of jsonFileMatches) {
              const um = fm.match(/"file"\s*:\s*"([^"]+)"/);
              if (um && !um[1].includes('.vtt') && !um[1].includes('.srt')) {
                let quality = 'HD';
                if (/1080p?/i.test(um[1])) quality = '1080p';
                else if (/720p?/i.test(um[1])) quality = '720p';
                else if (/480p?/i.test(um[1])) quality = '480p';
                
                if (!streams.some(s => s.url === um[1])) {
                  streams.push({ provider: 'HentaiMama', quality, url: um[1] });
                }
              }
            }
          }
        }
      } catch (e) {
        // Skip failed iframe fetches
        continue;
      }
    }
  } catch (e) {
    // AJAX call failed
    return streams;
  }

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
