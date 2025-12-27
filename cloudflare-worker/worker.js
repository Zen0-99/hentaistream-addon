// Build headers that mimic a real browser
function buildBrowserHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
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
}

// Fetch a single URL
async function fetchSingleUrl(targetUrl, method = 'GET', body = null) {
  try {
    const headers = new Headers(buildBrowserHeaders());
    
    if (method === 'POST') {
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    }
    
    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: 'follow',
    });
    
    const responseBody = await response.text();
    
    return {
      url: targetUrl,
      status: response.status,
      contentType: response.headers.get('Content-Type') || 'text/html',
      body: responseBody,
      success: response.status >= 200 && response.status < 400
    };
  } catch (error) {
    return {
      url: targetUrl,
      status: 0,
      error: error.message,
      success: false
    };
  }
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    const batchUrls = url.searchParams.get('urls'); // NEW: Batch mode
    const methodOverride = url.searchParams.get('method');
    const bodyParam = url.searchParams.get('body');

    // ===== BATCH MODE =====
    // Accept comma-separated URLs, fetch all in parallel, return JSON array
    if (batchUrls) {
      try {
        // Split and decode URLs (limit to 20 to prevent abuse)
        const urlList = batchUrls.split(',')
          .map(u => decodeURIComponent(u.trim()))
          .filter(u => u.startsWith('http'))
          .slice(0, 20);
        
        if (urlList.length === 0) {
          return new Response(JSON.stringify({ error: 'No valid URLs provided' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
        
        // Fetch all URLs in parallel
        const results = await Promise.all(
          urlList.map(targetUrl => fetchSingleUrl(targetUrl, methodOverride || 'GET', bodyParam ? decodeURIComponent(bodyParam) : null))
        );
        
        return new Response(JSON.stringify(results), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Batch-Count': results.length.toString(),
            'X-Batch-Success': results.filter(r => r.success).length.toString(),
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // ===== SINGLE URL MODE =====
    if (!targetUrl) {
      return new Response(JSON.stringify({ 
        error: 'Missing url or urls parameter',
        usage: {
          single: '?url=<encoded_url>',
          batch: '?urls=<url1>,<url2>,... (max 20)',
          post: '?url=<url>&method=POST&body=<encoded_body>'
        }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    try {
      const decodedUrl = decodeURIComponent(targetUrl);
      const actualMethod = methodOverride || request.method;
      
      let body = null;
      if (actualMethod === 'POST') {
        if (bodyParam) {
          body = decodeURIComponent(bodyParam);
        } else if (request.method === 'POST') {
          body = await request.text();
        }
      }

      const result = await fetchSingleUrl(decodedUrl, actualMethod, body);

      // For single URL mode, return the body directly (backwards compatible)
      return new Response(result.body || JSON.stringify({ error: result.error }), {
        status: result.status || 500,
        headers: {
          'Content-Type': result.contentType || 'text/html',
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-Status': (result.status || 0).toString(),
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
