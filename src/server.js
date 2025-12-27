const express = require('express');
const path = require('path');
// Note: We no longer use stremio-addon-sdk's serveHTTP/getRouter to bypass the 8KB manifest limit
const config = require('./config/env');
const logger = require('./utils/logger');
const { parseConfig, encodeConfig, DEFAULT_CONFIG } = require('./utils/configParser');
const { GENRE_OPTIONS, STUDIO_OPTIONS } = require('./addon/manifest');

// Import handlers directly (no SDK builder)
const { catalogHandler, metaHandler, streamHandler, getManifest } = require('./addon');

// Import optimized HTTP client and cache for pre-warming
const httpClient = require('./utils/httpClient');
const cache = require('./cache');
const slugRegistry = require('./cache/slugRegistry');

// Create Express app
const app = express();

// Middleware
app.use(express.json());

// CORS headers for Stremio (matches SDK behavior)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static files from public folder (logo, etc.)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Log all requests - detailed logging to catch 404 issues
app.use((req, res, next) => {
  logger.info(`📥 ${req.method} ${req.path} | Query: ${JSON.stringify(req.query)} | Params: ${JSON.stringify(req.params)}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: config.server.env,
    version: config.addon.version,
  };

  res.json(health);
});

// Self-ping mechanism to keep Render instance alive
function setupSelfPing() {
  // Only enable in production (Render)
  if (config.server.env !== 'production') {
    logger.info('⏭️  Self-ping disabled (not in production mode)');
    return;
  }

  const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes (before 15-min timeout)
  
  // Get the app's own URL from Render environment variable
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  
  if (!selfUrl) {
    logger.warn('⚠️  RENDER_EXTERNAL_URL not found - self-ping disabled');
    return;
  }

  const pingUrl = `${selfUrl}/health`;
  
  logger.info(`🔄 Self-ping enabled: ${pingUrl} every ${PING_INTERVAL / 60000} minutes`);

  setInterval(async () => {
    try {
      const https = require('https');
      const http = require('http');
      const client = pingUrl.startsWith('https') ? https : http;
      
      const startTime = Date.now();
      client.get(pingUrl, (res) => {
        const duration = Date.now() - startTime;
        logger.info(`✅ Self-ping successful (${res.statusCode}) - ${duration}ms`);
      }).on('error', (err) => {
        logger.error('❌ Self-ping failed:', err.message);
      });
    } catch (error) {
      logger.error('❌ Self-ping error:', error.message);
    }
  }, PING_INTERVAL);

  // Do an initial ping after 1 minute
  setTimeout(() => {
    logger.info('🔄 Performing initial self-ping...');
  }, 60000);
}

// Admin endpoint to clear all caches (use after deploying fixes)
app.post('/admin/cache/clear', async (req, res) => {
  try {
    await cache.flushAll();
    logger.info('[Admin] All caches cleared via API');
    res.json({ success: true, message: 'All caches cleared (memory + disk)' });
  } catch (error) {
    logger.error(`[Admin] Cache clear failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Also allow GET for easy browser access
app.get('/admin/cache/clear', async (req, res) => {
  try {
    await cache.flushAll();
    logger.info('[Admin] All caches cleared via API');
    res.json({ success: true, message: 'All caches cleared (memory + disk)' });
  } catch (error) {
    logger.error(`[Admin] Cache clear failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint for configuration options (full lists)
app.get('/api/options', (req, res) => {
  res.json({
    genres: GENRE_OPTIONS,
    studios: STUDIO_OPTIONS,
    providers: [
      { id: 'hmm', name: 'HentaiMama' },
      { id: 'hse', name: 'HentaiSea' },
      { id: 'htv', name: 'HentaiTV' }
    ]
  });
});

// Configure page routes
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'configure.html'));
});

app.get('/:config/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'configure.html'));
});

// Root endpoint - redirect to configure page
app.get('/', (req, res) => {
  res.redirect('/configure');
});

// Image proxy endpoint to handle hanime-cdn images (they require Referer header)
app.get('/image-proxy', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl || !imageUrl.startsWith('https://hanime-cdn.com/')) {
      return res.status(400).send('Invalid image URL');
    }

    const axios = require('axios');
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'stream',
      headers: {
        'Referer': 'https://hanime.tv/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    // Forward content type and cache headers
    res.setHeader('Content-Type', imageResponse.headers['content-type']);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    
    imageResponse.data.pipe(res);
  } catch (error) {
    logger.error('Image proxy error:', error);
    res.status(500).send('Error fetching image');
  }
});

// Video proxy endpoint for HentaiSea (IP-restricted videos)
// This fetches a FRESH authenticated URL and proxies the video
app.get('/video-proxy', async (req, res) => {
  try {
    const episodeId = req.query.episodeId;
    const jwplayerUrl = req.query.jwplayer;
    
    if (!episodeId && !jwplayerUrl) {
      return res.status(400).send('Missing episodeId or jwplayer URL');
    }

    const axios = require('axios');
    const cheerio = require('cheerio');
    const range = req.headers.range;
    
    let videoUrl;
    
    // If we have a jwplayer URL, fetch fresh auth token from it
    if (jwplayerUrl) {
      logger.info(`Video proxy: Fetching fresh auth from jwplayer...`);
      
      try {
        const jwResponse = await axios.get(jwplayerUrl, {
          headers: {
            'Referer': 'https://hentaisea.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        // Extract fresh authenticated URL
        const fileMatch = jwResponse.data.match(/"file"\s*:\s*"([^"]+)"/);
        if (fileMatch) {
          videoUrl = fileMatch[1].replace(/\\\//g, '/');
          logger.info(`Video proxy: Got fresh URL: ${videoUrl.substring(0, 80)}...`);
        }
      } catch (err) {
        logger.error(`Video proxy: Failed to get jwplayer auth: ${err.message}`);
        return res.status(500).send('Failed to get video authentication');
      }
    } 
    // If we have an episode ID, fetch the episode page and get jwplayer URL
    else if (episodeId) {
      logger.info(`Video proxy: Fetching episode ${episodeId}...`);
      
      const slug = episodeId.replace(/^hse-/, '');
      const episodeUrl = `https://hentaisea.com/episodes/${slug}/`;
      
      try {
        const epResponse = await axios.get(episodeUrl, {
          headers: {
            'Referer': 'https://hentaisea.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        const $ = cheerio.load(epResponse.data);
        
        // Find the play button to get post ID
        const playBtn = $('a.activador, a[data-num], .dooplay_player_option').first();
        const postId = playBtn.attr('data-post') || $('[data-post]').first().attr('data-post');
        const nume = playBtn.attr('data-nume') || playBtn.attr('data-num') || '1';
        
        if (postId) {
          // Get the player via AJAX
          const ajaxResponse = await axios.post('https://hentaisea.com/wp-admin/admin-ajax.php', 
            `action=doo_player_ajax&post=${postId}&nume=${nume}&type=movie`,
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': episodeUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Requested-With': 'XMLHttpRequest'
              }
            }
          );
          
          const responseData = typeof ajaxResponse.data === 'string' ? ajaxResponse.data : JSON.stringify(ajaxResponse.data);
          
          // Look for jwplayer URL
          const jwMatch = responseData.match(/https:\/\/hentaisea\.com\/jwplayer\/\?[^"'\s<>]+/);
          if (jwMatch) {
            const jwUrl = jwMatch[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
            
            // Fetch jwplayer page for fresh auth
            const jwResponse = await axios.get(jwUrl, {
              headers: {
                'Referer': 'https://hentaisea.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            
            const fileMatch = jwResponse.data.match(/"file"\s*:\s*"([^"]+)"/);
            if (fileMatch) {
              videoUrl = fileMatch[1].replace(/\\\//g, '/');
              logger.info(`Video proxy: Got fresh URL from episode: ${videoUrl.substring(0, 80)}...`);
            }
          }
        }
      } catch (err) {
        logger.error(`Video proxy: Failed to fetch episode: ${err.message}`);
        return res.status(500).send('Failed to fetch episode');
      }
    }
    
    if (!videoUrl) {
      return res.status(404).send('Could not find video URL');
    }
    
    // Now proxy the actual video
    logger.info(`Video proxy: Streaming from ${videoUrl.substring(0, 80)}...`);
    
    const videoResponse = await axios({
      method: 'get',
      url: videoUrl,
      responseType: 'stream',
      headers: {
        'Referer': 'https://hentaisea.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(range ? { 'Range': range } : {})
      },
    });

    // Forward relevant headers
    const headers = {
      'Content-Type': videoResponse.headers['content-type'] || 'video/mp4',
      'Accept-Ranges': 'bytes',
    };
    
    if (videoResponse.headers['content-length']) {
      headers['Content-Length'] = videoResponse.headers['content-length'];
    }
    if (videoResponse.headers['content-range']) {
      headers['Content-Range'] = videoResponse.headers['content-range'];
    }
    
    // Set status based on whether it's a range request
    const status = videoResponse.status === 206 ? 206 : 200;
    
    res.writeHead(status, headers);
    videoResponse.data.pipe(res);
    
  } catch (error) {
    logger.error('Video proxy error:', error.message);
    res.status(500).send('Error fetching video');
  }
});

// Landing page (fallback - but prefer configure)
app.get('/landing', (req, res) => {
  const landingHTML = `<!DOCTYPE html>
<html>
<head>
  <title>${config.addon.name}</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #e74c3c; }
    .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .button { display: inline-block; background: #e74c3c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
    .button:hover { background: #c0392b; }
  </style>
</head>
<body>
  <h1>🔞 ${config.addon.name}</h1>
  <div class="warning">
    <strong>Adult Content Warning:</strong> This addon provides access to adult content (18+). By installing, you confirm you are of legal age.
  </div>
  <p><strong>Version:</strong> ${config.addon.version}</p>
  <p><strong>Status:</strong> Running</p>
  <h2>Install</h2>
  <p>Click the button below to install this addon in Stremio:</p>
  <a href="stremio://${req.get('host')}/manifest.json" class="button">Install in Stremio</a>
  <a href="/configure" class="button">Configure</a>
  <a href="/manifest.json" class="button">View Manifest</a>
  <a href="/health" class="button">Health Check</a>
</body>
</html>`;
  res.send(landingHTML);
});

// ============ STREMIO ADDON ROUTES ============
// These routes handle the Stremio addon protocol directly without the SDK
// This bypasses the 8KB manifest size limit that the SDK enforces

// Manifest with query config (NO SIZE LIMIT!)
// Note: For config to persist, use path-based config: /:config/manifest.json
app.get('/manifest.json', async (req, res) => {
  try {
    const userConfig = parseConfig(req.query);
    const manifest = await getManifest();
    const configStr = encodeConfig(userConfig);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    // Add config hash to manifest ID to make it unique per configuration
    if (configStr) {
      const hash = configStr.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0).toString(36).substring(0, 8);
      manifest.id = `${manifest.id}.${hash}`;
      
      // CRITICAL: For query-string config, we need to embed config in resource URLs
      // Otherwise Stremio won't send the config with each request
      manifest.resources = [
        {
          name: 'catalog',
          types: ['hentai'],
          idPrefixes: ['hentai-'],
          // URL template with config embedded
          ...(configStr ? { extra: [{ name: 'configStr', isRequired: false }] } : {})
        },
        {
          name: 'meta',
          types: ['hentai', 'series'],
          idPrefixes: ['hmm-', 'hse-', 'htv-', 'hs-']
        },
        {
          name: 'stream',
          types: ['hentai', 'series'],
          idPrefixes: ['hmm-', 'hse-', 'htv-', 'hs-']
        }
      ];
      
      // Add config to each catalog's extra params so it's included in requests
      manifest.catalogs = manifest.catalogs.map(cat => ({
        ...cat,
        extraSupported: ['search', 'skip', 'genre', 'bg', 'bs', 'providers']
      }));
    }
    
    logger.info(`Serving manifest (${JSON.stringify(manifest).length} bytes)`);
    res.json(manifest);
  } catch (error) {
    logger.error('Manifest error:', error);
    res.status(500).json({ error: 'Failed to generate manifest' });
  }
});

// Path-based config manifest (e.g., /bg=3d/manifest.json)
app.get('/:config/manifest.json', async (req, res) => {
  try {
    // Decode config from path parameter
    const configStr = req.params.config;
    const userConfig = parseConfig(
      Object.fromEntries(new URLSearchParams(configStr).entries())
    );
    
    const manifest = await getManifest();
    
    // Add config hash to manifest ID
    if (configStr) {
      const hash = configStr.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0).toString(36).substring(0, 8);
      manifest.id = `${manifest.id}.${hash}`;
    }
    
    // IMPORTANT: Filter out blacklisted genres/studios from dropdown options
    if (userConfig.blacklistGenres && userConfig.blacklistGenres.length > 0) {
      manifest.catalogs = manifest.catalogs.map(cat => {
        if (!cat.extra) return cat;
        return {
          ...cat,
          extra: cat.extra.map(ext => {
            if (ext.name === 'genre' && ext.options && cat.id !== 'hentai-studios' && cat.id !== 'hentai-years') {
              // Filter out blacklisted genres from options
              const filteredOptions = ext.options.filter(opt => 
                !userConfig.blacklistGenres.some(bg => 
                  opt.toLowerCase().includes(bg.toLowerCase()) || bg.toLowerCase().includes(opt.toLowerCase())
                )
              );
              return { ...ext, options: filteredOptions };
            }
            return ext;
          })
        };
      });
    }
    
    // Filter out blacklisted studios from Studios catalog dropdown
    if (userConfig.blacklistStudios && userConfig.blacklistStudios.length > 0) {
      manifest.catalogs = manifest.catalogs.map(cat => {
        if (cat.id !== 'hentai-studios' || !cat.extra) return cat;
        return {
          ...cat,
          extra: cat.extra.map(ext => {
            if (ext.name === 'genre' && ext.options) {
              const filteredOptions = ext.options.filter(opt => 
                !userConfig.blacklistStudios.some(bs => 
                  opt.toLowerCase().includes(bs.toLowerCase()) || bs.toLowerCase().includes(opt.toLowerCase())
                )
              );
              return { ...ext, options: filteredOptions };
            }
            return ext;
          })
        };
      });
    }
    
    logger.info(`Serving configured manifest (${JSON.stringify(manifest).length} bytes)`);
    res.json(manifest);
  } catch (error) {
    logger.error('Configured manifest error:', error);
    res.status(500).json({ error: 'Failed to generate manifest' });
  }
});

// Catalog with query config
app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    const userConfig = parseConfig(req.query);
    const { type, id } = req.params;
    const extra = { ...req.query };
    
    // Clean up search query - remove .json extension if accidentally included
    if (extra.search && extra.search.endsWith('.json')) {
      extra.search = extra.search.slice(0, -5);
    }
    
    const result = await catalogHandler({ type, id, extra, config: userConfig });
    res.json(result);
  } catch (error) {
    logger.error('Catalog error:', error);
    res.json({ metas: [] });
  }
});

// Catalog with extra args in path (Stremio format: /catalog/:type/:id/:extraArgs.json)
// extraArgs is URL-encoded key=value pairs like "genre=Bunny%20Girl" or "skip=20"
app.get('/catalog/:type/:id/:extraArgs.json', async (req, res) => {
  try {
    const userConfig = parseConfig(req.query);
    const { type, id, extraArgs } = req.params;
    
    // Parse extraArgs from path (format: "genre=X&skip=Y" or just "genre=X")
    const extra = {};
    if (extraArgs) {
      const decoded = decodeURIComponent(extraArgs);
      const params = new URLSearchParams(decoded);
      for (const [key, value] of params.entries()) {
        extra[key] = value;
      }
    }
    
    // Merge with query params
    Object.assign(extra, req.query);
    
    logger.info(`Catalog with extra: type=${type}, id=${id}, extraArgs=${extraArgs}, extra=${JSON.stringify(extra)}`);
    
    const result = await catalogHandler({ type, id, extra, config: userConfig });
    res.json(result);
  } catch (error) {
    logger.error('Catalog error:', error);
    res.json({ metas: [] });
  }
});

// Path-based config catalog
app.get('/:config/catalog/:type/:id.json', async (req, res) => {
  try {
    const configStr = req.params.config;
    logger.info(`Path-based catalog request: config=${configStr}, type=${req.params.type}, id=${req.params.id}, query=${JSON.stringify(req.query)}`);
    const userConfig = parseConfig(
      Object.fromEntries(new URLSearchParams(configStr).entries())
    );
    const { type, id } = req.params;
    const extra = { ...req.query };
    
    if (extra.search && extra.search.endsWith('.json')) {
      extra.search = extra.search.slice(0, -5);
    }
    
    const result = await catalogHandler({ type, id, extra, config: userConfig });
    res.json(result);
  } catch (error) {
    logger.error('Catalog error:', error);
    res.json({ metas: [] });
  }
});

// Path-based config catalog with extra args in path (Stremio format)
app.get('/:config/catalog/:type/:id/:extraArgs.json', async (req, res) => {
  try {
    const configStr = req.params.config;
    logger.info(`Path-based catalog with extra: config=${configStr}, type=${req.params.type}, id=${req.params.id}, extraArgs=${req.params.extraArgs}`);
    const userConfig = parseConfig(
      Object.fromEntries(new URLSearchParams(configStr).entries())
    );
    const { type, id, extraArgs } = req.params;
    
    // Parse extraArgs from path
    const extra = {};
    if (extraArgs) {
      const decoded = decodeURIComponent(extraArgs);
      const params = new URLSearchParams(decoded);
      for (const [key, value] of params.entries()) {
        extra[key] = value;
      }
    }
    
    // Merge with query params
    Object.assign(extra, req.query);
    
    logger.info(`Parsed extra: ${JSON.stringify(extra)}`);
    
    const result = await catalogHandler({ type, id, extra, config: userConfig });
    res.json(result);
  } catch (error) {
    logger.error('Catalog error:', error);
    res.json({ metas: [] });
  }
});

// Meta with query config
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const userConfig = parseConfig(req.query);
    const { type, id } = req.params;
    
    const result = await metaHandler({ type, id, config: userConfig });
    res.json(result);
  } catch (error) {
    logger.error('Meta error:', error);
    res.json({ meta: null });
  }
});

// Path-based config meta
app.get('/:config/meta/:type/:id.json', async (req, res) => {
  try {
    const configStr = req.params.config;
    const userConfig = parseConfig(
      Object.fromEntries(new URLSearchParams(configStr).entries())
    );
    const { type, id } = req.params;
    
    const result = await metaHandler({ type, id, config: userConfig });
    res.json(result);
  } catch (error) {
    logger.error('Meta error:', error);
    res.json({ meta: null });
  }
});

// Stream with query config
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const userConfig = parseConfig(req.query);
    const { type, id } = req.params;
    
    const result = await streamHandler({ type, id, config: userConfig });
    res.json(result);
  } catch (error) {
    logger.error('Stream error:', error);
    res.json({ streams: [] });
  }
});

// Path-based config stream
app.get('/:config/stream/:type/:id.json', async (req, res) => {
  try {
    const configStr = req.params.config;
    const userConfig = parseConfig(
      Object.fromEntries(new URLSearchParams(configStr).entries())
    );
    const { type, id } = req.params;
    
    const result = await streamHandler({ type, id, config: userConfig });
    res.json(result);
  } catch (error) {
    logger.error('Stream error:', error);
    res.json({ streams: [] });
  }
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.server.env === 'development' ? err.message : 'Something went wrong',
  });
});

// Start server
const server = app.listen(config.server.port, async () => {
  logger.info(`========================================`);
  logger.info(`🚀 ${config.addon.name} v${config.addon.version}`);
  logger.info(`========================================`);
  logger.info(`Server running on port ${config.server.port}`);
  logger.info(`Environment: ${config.server.env}`);
  logger.info(`Manifest URL: http://localhost:${config.server.port}/manifest.json`);
  logger.info(`Health Check: http://localhost:${config.server.port}/health`);
  logger.info(`Install URL: stremio://localhost:${config.server.port}/manifest.json`);
  logger.info(`========================================`);
  
  // Pre-warm connection pools (HTTP/2 keep-alive)
  try {
    await httpClient.prewarmConnections();
  } catch (error) {
    logger.warn(`Connection pool warmup failed: ${error.message}`);
  }
  
  // Pre-warm catalog cache in background (don't block startup)
  setTimeout(async () => {
    logger.info('🔥 Pre-warming catalog cache in background...');
    
    try {
      // Import scrapers
      const hentaimamaScraper = require('./scrapers/hentaimama');
      const hentaiseaScraper = require('./scrapers/hentaisea');
      const hentaitvScraper = require('./scrapers/hentaitv');
      
      // Pre-warm first page of each provider (in parallel)
      const warmupPromises = [
        cache.prewarm(
          cache.key('catalog', 'hmm-page-1'),
          cache.getTTL('catalog'),
          () => hentaimamaScraper.getCatalog(1, null, 'popular')
        ),
        cache.prewarm(
          cache.key('catalog', 'hse-page-1'),
          cache.getTTL('catalog'),
          () => hentaiseaScraper.getTrending(1)
        ),
        cache.prewarm(
          cache.key('catalog', 'htv-page-1'),
          cache.getTTL('catalog'),
          () => hentaitvScraper.getCatalog(1, null, 'popular')
        ),
      ];
      
      const results = await Promise.allSettled(warmupPromises);
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value).length;
      
      logger.info(`✅ Cache warmup complete: ${succeeded}/${warmupPromises.length} providers ready`);
      logger.info(`📊 Cache stats: ${JSON.stringify(cache.getStats())}`);
    } catch (error) {
      logger.warn(`Cache warmup error: ${error.message}`);
    }
  }, 5000); // Start warmup 5 seconds after server starts
  
  // Start self-ping mechanism (Render keep-alive)
  setupSelfPing();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  
  // Save slug registry to disk
  try {
    slugRegistry.shutdown();
    logger.info('Slug registry saved to disk');
  } catch (error) {
    logger.warn(`Slug registry shutdown error: ${error.message}`);
  }
  
  // Close HTTP client connection pools
  try {
    await httpClient.closeAll();
  } catch (error) {
    logger.warn(`HTTP client shutdown error: ${error.message}`);
  }
  
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');
  
  // Save slug registry to disk
  try {
    slugRegistry.shutdown();
    logger.info('Slug registry saved to disk');
  } catch (error) {
    logger.warn(`Slug registry shutdown error: ${error.message}`);
  }
  
  // Close HTTP client connection pools
  try {
    await httpClient.closeAll();
  } catch (error) {
    logger.warn(`HTTP client shutdown error: ${error.message}`);
  }
  
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
