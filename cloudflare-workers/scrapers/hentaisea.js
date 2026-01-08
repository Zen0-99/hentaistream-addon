/**
 * HentaiSea Scraper Worker
 * 
 * Extracts video streams from HentaiSea pages.
 * Called by the main edge worker when streams are requested.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
      return new Response(JSON.stringify({ status: 'ok', provider: 'hentaisea' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('HentaiSea Scraper Worker', { headers: CORS_HEADERS });
  }
};

/**
 * Get video streams for an episode
 */
async function getStreams(episodeId) {
  try {
    const episodeSlug = episodeId.replace('hse-', '');
    const pageUrl = `https://hentaisea.com/episodes/${episodeSlug}/`;
    
    console.log(`[HentaiSea] Fetching streams for: ${episodeSlug}`);
    
    // Step 1: Fetch the episode page
    const pageResponse = await fetch(pageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
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
    const streams = [];
    
    // Method 1: Try dooplay_player AJAX
    const postIdMatch = html.match(/data-post=['"](\d+)['"]/);
    const numeMatch = html.match(/data-nume=['"](\d+)['"]/);
    
    if (postIdMatch && numeMatch) {
      console.log(`[HentaiSea] Trying AJAX: post=${postIdMatch[1]}, nume=${numeMatch[1]}`);
      
      const formData = new URLSearchParams({
        action: 'doo_player_ajax',
        post: postIdMatch[1],
        nume: numeMatch[1],
        type: 'tv'
      });
      
      try {
        const ajaxResponse = await fetch('https://hentaisea.com/wp-admin/admin-ajax.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
            'Referer': pageUrl,
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: formData.toString()
        });
        
        if (ajaxResponse.ok) {
          const responseText = await ajaxResponse.text();
          let responseData;
          
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText;
          }
          
          // JSON response with embed_url
          if (typeof responseData === 'object' && responseData.embed_url) {
            console.log(`[HentaiSea] Got embed URL: ${responseData.embed_url}`);
            const streamFromEmbed = await extractStreamFromEmbed(responseData.embed_url);
            if (streamFromEmbed) {
              streams.push(streamFromEmbed);
            }
          }
          // HTML iframe response
          else if (typeof responseData === 'string') {
            // Extract jwplayer iframe URL
            const iframeSrcMatch = responseData.match(/src=['"]([^'"]+jwplayer[^'"]+)['"]/);
            if (iframeSrcMatch) {
              let jwplayerUrl = iframeSrcMatch[1];
              if (jwplayerUrl.startsWith('//')) {
                jwplayerUrl = 'https:' + jwplayerUrl;
              }
              
              console.log(`[HentaiSea] Found jwplayer URL: ${jwplayerUrl.substring(0, 60)}...`);
              
              // Fetch the jwplayer page to get actual video URL with auth
              const jwStream = await extractStreamFromJwplayer(jwplayerUrl, pageUrl);
              if (jwStream) {
                streams.push(jwStream);
              }
            }
            
            // Try direct source extraction
            if (streams.length === 0) {
              const sourceMatch = responseData.match(/source=([^&'"]+)/);
              if (sourceMatch) {
                const videoUrl = decodeURIComponent(sourceMatch[1]);
                if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
                  streams.push({
                    url: videoUrl,
                    title: `HentaiSea ${videoUrl.includes('.m3u8') ? 'HLS' : 'MP4'}`
                  });
                }
              }
            }
          }
        }
      } catch (ajaxErr) {
        console.log(`[HentaiSea] AJAX failed: ${ajaxErr.message}`);
      }
    }
    
    // Method 2: Look for direct video sources in page
    if (streams.length === 0) {
      const videoMatches = html.match(/https?:\/\/[^"'\s]+\.(mp4|m3u8)[^"'\s]*/gi);
      if (videoMatches) {
        for (const url of videoMatches) {
          if (!url.includes('thumbnail') && !url.includes('poster')) {
            streams.push({
              url: url,
              title: `HentaiSea ${url.includes('.m3u8') ? 'HLS' : 'MP4'}`
            });
          }
        }
      }
    }
    
    // Method 3: Look for file patterns in scripts
    if (streams.length === 0) {
      const fileMatches = html.match(/file["']?\s*[:=]\s*["']([^"']+\.(mp4|m3u8)[^"']*)/gi);
      if (fileMatches) {
        for (const m of fileMatches) {
          const urlMatch = m.match(/["']([^"']+)/);
          if (urlMatch && !streams.some(s => s.url === urlMatch[1])) {
            streams.push({
              url: urlMatch[1],
              title: 'HentaiSea MP4'
            });
          }
        }
      }
    }
    
    // Format streams for Stremio
    const formattedStreams = streams.map(s => ({
      name: 'HentaiSea',
      title: s.title || 'HD',
      url: s.url,
      behaviorHints: {
        notWebReady: s.url.includes('.m3u8')
      }
    }));
    
    console.log(`[HentaiSea] Found ${formattedStreams.length} streams`);
    
    return jsonResponse({ streams: formattedStreams });
    
  } catch (error) {
    console.error(`[HentaiSea] Error: ${error.message}`);
    return jsonResponse({ streams: [], error: error.message });
  }
}

/**
 * Extract stream from embed URL
 */
async function extractStreamFromEmbed(embedUrl) {
  try {
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://hentaisea.com/'
      }
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Look for file/source patterns
    const fileMatch = html.match(/file["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/i);
    if (fileMatch) {
      return { url: fileMatch[1], title: 'HentaiSea MP4' };
    }
    
    return null;
  } catch (e) {
    console.log(`[HentaiSea] Embed extraction failed: ${e.message}`);
    return null;
  }
}

/**
 * Extract stream from jwplayer URL (fetches fresh auth tokens)
 */
async function extractStreamFromJwplayer(jwplayerUrl, referer) {
  try {
    const response = await fetch(jwplayerUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': referer
      }
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Look for source URL with auth parameters
    const sourceMatch = html.match(/source=([^&'"]+)/);
    if (sourceMatch) {
      const videoUrl = decodeURIComponent(sourceMatch[1]);
      if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
        return { url: videoUrl, title: 'HentaiSea MP4' };
      }
    }
    
    // Try file pattern
    const fileMatch = html.match(/file["']?\s*[:=]\s*["']([^"']+\.(mp4|m3u8)[^"']*)/i);
    if (fileMatch) {
      return { url: fileMatch[1], title: 'HentaiSea MP4' };
    }
    
    return null;
  } catch (e) {
    console.log(`[HentaiSea] JWPlayer extraction failed: ${e.message}`);
    return null;
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
