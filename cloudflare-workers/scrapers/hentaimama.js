/**
 * HentaiMama Scraper Worker
 * 
 * Extracts video streams from HentaiMama pages.
 * Called by the main edge worker when streams are requested.
 */

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

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    
    // Handle stream requests: /stream/series/{episodeId}.json
    const streamMatch = path.match(/\/stream\/([^/]+)\/([^/]+)\.json/);
    if (streamMatch) {
      const [, type, episodeId] = streamMatch;
      return await getStreams(episodeId);
    }
    
    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', provider: 'hentaimama' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('HentaiMama Scraper Worker', { headers: CORS_HEADERS });
  }
};

/**
 * Get video streams for an episode
 */
async function getStreams(episodeId) {
  try {
    const cleanId = episodeId.replace('hmm-', '');
    const pageUrl = `https://hentaimama.io/episodes/${cleanId}`;
    
    console.log(`[HentaiMama] Fetching streams for: ${cleanId}`);
    
    // Step 1: Fetch the episode page
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
    
    // Step 2: Check RAW status from series page
    const seriesSlug = cleanId.replace(/-episode-\d+$/, '');
    let isRaw = false;
    
    try {
      const seriesPageUrl = `https://hentaimama.io/tvshows/${seriesSlug}/`;
      const seriesResponse = await fetch(seriesPageUrl, {
        headers: { 'User-Agent': getRandomUserAgent() }
      });
      
      if (seriesResponse.ok) {
        const seriesHtml = await seriesResponse.text();
        // Check for RAW status for this episode
        const episodeRegex = new RegExp(`episodes/${cleanId}[^"]*"[^>]*>[\\s\\S]*?status-raw`, 'i');
        isRaw = episodeRegex.test(seriesHtml);
      }
    } catch (e) {
      console.log(`[HentaiMama] Could not check RAW status: ${e.message}`);
    }
    
    // Step 3: Look for AJAX parameters in the page
    const actionMatch = html.match(/action:\s*['"]([^'"]+)['"]/);
    const aMatch = html.match(/a:\s*['"]?(\d+)['"]?/);
    
    let streams = [];
    
    if (actionMatch && aMatch) {
      console.log(`[HentaiMama] Found AJAX: action=${actionMatch[1]}, a=${aMatch[1]}`);
      
      // Make AJAX call to get player iframes
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
        const ajaxData = await ajaxResponse.json();
        
        if (Array.isArray(ajaxData)) {
          console.log(`[HentaiMama] Got ${ajaxData.length} player iframes`);
          
          // Process each iframe
          for (const iframeHtml of ajaxData) {
            const srcMatch = iframeHtml.match(/src=["']([^"']+)["']/);
            if (srcMatch) {
              const iframeUrl = srcMatch[1];
              
              try {
                console.log(`[HentaiMama] Fetching iframe: ${iframeUrl}`);
                const iframeResponse = await fetch(iframeUrl, {
                  headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Referer': pageUrl
                  }
                });
                
                if (iframeResponse.ok) {
                  const iframeHtml = await iframeResponse.text();
                  
                  // Try to extract video sources
                  const sources = extractSources(iframeHtml);
                  if (sources.length > 0) {
                    streams = sources;
                    break; // Found sources, stop processing iframes
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
    
    // Fallback: Try to find sources directly in page
    if (streams.length === 0) {
      streams = extractSources(html);
    }
    
    // Format streams for Stremio
    const formattedStreams = streams.map(s => ({
      name: `HentaiMama${isRaw ? ' - RAW' : ''}`,
      title: `${s.quality || 'HD'}${isRaw ? ' (No Subs)' : ''}`,
      url: s.file || s.url,
      behaviorHints: {
        notWebReady: false
      }
    }));
    
    console.log(`[HentaiMama] Found ${formattedStreams.length} streams${isRaw ? ' (RAW)' : ''}`);
    
    return jsonResponse({ streams: formattedStreams });
    
  } catch (error) {
    console.error(`[HentaiMama] Error: ${error.message}`);
    return jsonResponse({ streams: [], error: error.message });
  }
}

/**
 * Extract video sources from HTML/script content
 */
function extractSources(html) {
  const sources = [];
  
  // Pattern 1: sources: [{file: "...", label: "..."}]
  const sourcesMatch = html.match(/sources:\s*(\[[\s\S]*?\])/);
  if (sourcesMatch) {
    try {
      // Parse the sources array (it's usually valid JSON-ish)
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
      // Try regex extraction
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
  
  // Pattern 2: file: "url" (jwplayer style)
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
  
  // Pattern 3: Direct video URLs
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
  
  // Sort by quality (higher first)
  sources.sort((a, b) => {
    const aHeight = parseInt(a.label || a.quality) || 0;
    const bHeight = parseInt(b.label || b.quality) || 0;
    return bHeight - aHeight;
  });
  
  return sources;
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
