/**
 * HentaiTV Scraper Worker
 * 
 * Extracts video streams from HentaiTV pages.
 * Uses nhplayer and r2.1hanime.com video CDN.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Known patterns where "+" needs to be restored in video URLs
const PLUS_PATTERNS = [
  { from: /^1ldk-jk-/i, to: '1ldk-+-jk-' }
];

// Prefixes that should be removed from video slugs
const REMOVABLE_PREFIXES = ['ova-', 'ona-', 'special-'];

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
      return new Response(JSON.stringify({ status: 'ok', provider: 'hentaitv' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('HentaiTV Scraper Worker', { headers: CORS_HEADERS });
  }
};

/**
 * Get video streams for an episode
 */
async function getStreams(episodeId) {
  try {
    let slug = episodeId.replace('htv-', '');
    console.log(`[HentaiTV] Fetching streams for: ${slug}`);
    
    // Parse episode number from the slug
    const episodeMatch = slug.match(/-episode-(\d+)$/) || slug.match(/-(\d+)$/);
    const episodeNum = episodeMatch ? parseInt(episodeMatch[1]) : 1;
    
    // Build the episode URL - HentaiTV uses /hentai/series-episode-X/
    const episodeUrl = `https://hentai.tv/hentai/${slug}/`;
    const streams = [];
    
    // Attempt to fetch the page with interstitial bypass cookie
    const response = await fetch(episodeUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': 'inter=1' // Bypass interstitial page
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
    
    // Check if we got the actual episode page (not interstitial)
    const isInterstitial = html.toLowerCase().includes('lnter') || html.toLowerCase().includes('interstitial');
    
    if (isInterstitial) {
      console.log(`[HentaiTV] Hit interstitial page for ${slug}`);
      
      // Strategy 1: Try to construct the r2.1hanime.com video URL directly
      const videoSlugVariations = generateVideoSlugVariations(slug);
      
      for (const videoSlug of videoSlugVariations) {
        const videoUrl = `https://r2.1hanime.com/${videoSlug}.mp4`;
        console.log(`[HentaiTV] Trying direct URL: ${videoUrl}`);
        
        try {
          // Verify the URL exists with HEAD request
          const headResponse = await fetch(videoUrl, {
            method: 'HEAD',
            headers: { 'Referer': 'https://nhplayer.com/' }
          });
          
          if (headResponse.ok) {
            streams.push({
              url: videoUrl,
              title: 'HentaiTV MP4'
            });
            console.log(`[HentaiTV] Direct URL works!`);
            break;
          }
        } catch (urlError) {
          console.log(`[HentaiTV] Direct URL failed: ${urlError.message}`);
        }
      }
    } else {
      // We got the actual page - look for video sources
      console.log(`[HentaiTV] Got actual episode page`);
      
      // Check for nhplayer iframe
      const nhplayerMatch = html.match(/nhplayer\.com\/v\/([a-zA-Z0-9]+)/);
      if (nhplayerMatch) {
        const nhplayerId = nhplayerMatch[1];
        console.log(`[HentaiTV] Found nhplayer ID: ${nhplayerId}`);
        
        // Fetch nhplayer page to get video URL
        try {
          const nhResponse = await fetch(`https://nhplayer.com/v/${nhplayerId}/`, {
            headers: {
              'User-Agent': USER_AGENT,
              'Referer': 'https://hentai.tv/'
            }
          });
          
          if (nhResponse.ok) {
            const nhHtml = await nhResponse.text();
            
            // Extract base64 encoded video URL from data-id attribute
            const dataIdMatch = nhHtml.match(/data-id=["']([^"']+)/);
            if (dataIdMatch) {
              const dataId = dataIdMatch[1];
              const urlMatch = dataId.match(/u=([^&]+)/);
              if (urlMatch) {
                try {
                  const videoUrl = atob(urlMatch[1]); // Base64 decode
                  if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
                    streams.push({
                      url: videoUrl,
                      title: `HentaiTV ${videoUrl.includes('.m3u8') ? 'HLS' : 'MP4'}`
                    });
                    console.log(`[HentaiTV] Extracted video URL: ${videoUrl}`);
                  }
                } catch (e) {
                  console.log(`[HentaiTV] Base64 decode failed`);
                }
              }
            }
          }
        } catch (nhError) {
          console.log(`[HentaiTV] Could not fetch nhplayer: ${nhError.message}`);
        }
      }
      
      // Check for iframe with source URL
      const iframeSrcMatch = html.match(/iframe[^>]+src=["']([^"']+source=[^"']+)/i);
      if (iframeSrcMatch && streams.length === 0) {
        const src = iframeSrcMatch[1];
        const sourceMatch = src.match(/source=([^&]+)/);
        if (sourceMatch) {
          try {
            const videoUrl = decodeURIComponent(sourceMatch[1]);
            if (videoUrl.includes('.mp4') || videoUrl.includes('.m3u8')) {
              streams.push({
                url: videoUrl,
                title: `HentaiTV ${videoUrl.includes('.m3u8') ? 'HLS' : 'MP4'}`
              });
            }
          } catch (e) {}
        }
      }
      
      // Look for video URL patterns in scripts
      if (streams.length === 0) {
        const videoPatterns = [
          /file["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/gi,
          /source["']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)/gi,
          /["'](https?:\/\/[^"']*\.mp4[^"']*)/gi,
          /["'](https?:\/\/r2\.1hanime\.com[^"']+)/gi
        ];
        
        for (const pattern of videoPatterns) {
          let match;
          while ((match = pattern.exec(html)) !== null) {
            const url = match[1];
            if (!streams.some(s => s.url === url) && !url.includes('thumbnail')) {
              streams.push({
                url: url,
                title: 'HentaiTV MP4'
              });
            }
          }
        }
      }
    }
    
    // If still no streams, try the direct URL approach with slug variations
    if (streams.length === 0) {
      console.log(`[HentaiTV] No streams found, trying direct URL fallback`);
      
      const videoSlugVariations = generateVideoSlugVariations(slug);
      for (const videoSlug of videoSlugVariations) {
        const videoUrl = `https://r2.1hanime.com/${videoSlug}.mp4`;
        
        try {
          const headResponse = await fetch(videoUrl, {
            method: 'HEAD',
            headers: { 'Referer': 'https://nhplayer.com/' }
          });
          
          if (headResponse.ok) {
            streams.push({
              url: videoUrl,
              title: 'HentaiTV MP4'
            });
            break;
          }
        } catch (e) {}
      }
    }
    
    // Format streams for Stremio
    const formattedStreams = streams.map(s => ({
      name: 'HentaiTV',
      title: s.title || 'HD',
      url: s.url,
      behaviorHints: {
        notWebReady: s.url.includes('.m3u8'),
        proxyHeaders: {
          request: {
            'Referer': 'https://nhplayer.com/'
          }
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

/**
 * Generate variations of the slug for direct video URL attempts
 */
function generateVideoSlugVariations(episodeSlug) {
  // Base transformation: remove "-episode-" and keep just the number
  const baseSlug = episodeSlug.replace(/-episode-(\d+)$/, '-$1');
  const variations = [baseSlug];
  
  // Try removing common prefixes (ova-, ona-, etc.)
  for (const prefix of REMOVABLE_PREFIXES) {
    if (baseSlug.toLowerCase().startsWith(prefix)) {
      const withoutPrefix = baseSlug.substring(prefix.length);
      variations.unshift(withoutPrefix); // Add at start (most likely)
    }
  }
  
  // Try known "+" patterns
  for (const pattern of PLUS_PATTERNS) {
    if (pattern.from.test(baseSlug)) {
      const plusSlug = baseSlug.replace(pattern.from, pattern.to);
      variations.unshift(plusSlug);
    }
  }
  
  // Also try the original slug without -episode- transformation
  const altSlug = episodeSlug.replace(/-episode-/, '-');
  if (!variations.includes(altSlug)) {
    variations.push(altSlug);
  }
  
  return variations;
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
