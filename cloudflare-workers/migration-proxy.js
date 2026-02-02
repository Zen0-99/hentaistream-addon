/**
 * HentaiStream Migration Proxy Worker
 * 
 * Deploy this to your OLD Cloudflare account/worker.
 * It forwards all requests to the new worker transparently.
 * Users won't notice any difference.
 * 
 * After a few months, you can optionally:
 * 1. Add a message to streams encouraging reinstall
 * 2. Eventually shut down the old worker
 */

// Your NEW worker URL
const NEW_WORKER_URL = 'https://hentaistream-addon.keypop3750.workers.dev';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Build the new URL pointing to the new worker
    const newUrl = new URL(url.pathname + url.search, NEW_WORKER_URL);
    
    // Clone the request with the new URL
    const newRequest = new Request(newUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow'
    });
    
    try {
      // Forward to new worker
      const response = await fetch(newRequest);
      
      // Clone response and add CORS headers (in case they're missing)
      const newResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
      
      // Ensure CORS headers are present
      if (!newResponse.headers.has('Access-Control-Allow-Origin')) {
        const headers = new Headers(newResponse.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(newResponse.body, {
          status: newResponse.status,
          statusText: newResponse.statusText,
          headers
        });
      }
      
      return newResponse;
      
    } catch (error) {
      // If new worker is down, return error
      return new Response(JSON.stringify({ 
        error: 'Service temporarily unavailable',
        message: error.message 
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};
