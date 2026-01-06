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
const databaseLoader = require('./utils/databaseLoader');

// Track manifest prewarm status to avoid duplicate prewarming
let manifestPrewarmTriggered = false;

/**
 * Initialize the database on startup
 * Loads pre-bundled catalog data for fast lookups
 */
async function initializeDatabase() {
  logger.info('📦 Initializing pre-bundled database...');
  try {
    const db = await databaseLoader.loadDatabase();
    if (databaseLoader.isReady()) {
      const stats = databaseLoader.getStats();
      logger.info(`✅ Database ready: ${stats.totalSeries} series, built ${stats.buildDate || 'unknown'}`);
      
      // Enable database mode on cache systems - no disk caching needed!
      // Database already has all metadata, so disk cache is unnecessary
      cache.enableDatabaseMode();
      slugRegistry.enableDatabaseMode();
      logger.info('🚀 Database mode enabled - disk caching disabled (database is the cache)');
    } else {
      logger.warn('⚠️ No pre-bundled database available. Will scrape on demand.');
    }
  } catch (error) {
    logger.warn(`Database init warning: ${error.message}`);
  }
}

/**
 * Pre-warm catalogs when manifest is served (addon installed)
 * 
 * SIMPLIFIED: With pre-bundled database, Top Rated and most content is instant.
 * Only pre-warm "New Releases" to catch content added AFTER the database was built.
 * 
 * Database provides: All historical catalog data (instant load)
 * Pre-warm provides: Fresh content not in database yet
 */
async function prewarmCatalogsOnManifest() {
  if (manifestPrewarmTriggered) {
    logger.debug('Catalog prewarm already triggered, skipping');
    return;
  }
  manifestPrewarmTriggered = true;
  
  // Check if database is ready - if so, only warm new releases
  const dbReady = databaseLoader.isReady();
  const dbStats = databaseLoader.getStats();
  
  if (dbReady) {
    logger.info(`📦 Database ready with ${dbStats.totalSeries} series (built: ${dbStats.buildDate || 'unknown'})`);
    logger.info('🔥 Pre-warming only New Releases (content since database build)...');
  } else {
    logger.info('⚠️ No database - pre-warming all catalogs from scrapers...');
  }
  
  try {
    // Import scrapers
    const hentaimamaScraper = require('./scrapers/hentaimama');
    const hentaiseaScraper = require('./scrapers/hentaisea');
    const hentaitvScraper = require('./scrapers/hentaitv');
    
    const DELAY_MS = 100;
    
    // WITH DATABASE: Only warm page 1 of new releases (catch fresh content)
    // WITHOUT DATABASE: Warm 3 pages of everything (full warmup)
    const PAGES_TO_PREWARM = dbReady ? 1 : 3;
    
    // Skip Top Rated warmup if database is ready (data is pre-bundled)
    if (!dbReady) {
      logger.debug('Pre-warming Top Rated catalog (no database)...');
      for (let page = 1; page <= PAGES_TO_PREWARM; page++) {
        const promises = [
          cache.prewarm(
            cache.key('catalog', `hmm-popular-page-${page}`),
            cache.getTTL('catalog'),
            () => hentaimamaScraper.getCatalog(page, null, 'popular')
          ),
          cache.prewarm(
            cache.key('catalog', `hse-popular-page-${page}`),
            cache.getTTL('catalog'),
            () => hentaiseaScraper.getTrending(page)
          ),
          cache.prewarm(
            cache.key('catalog', `htv-popular-page-${page}`),
            cache.getTTL('catalog'),
            () => hentaitvScraper.getCatalog(page, null, 'popular')
          )
        ];
        
        await Promise.allSettled(promises);
        logger.debug(`Top Rated page ${page} warmed`);
        
        if (page < PAGES_TO_PREWARM) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }
    }
    
    // Always warm New Releases (catches content since last database build)
    logger.debug(`Pre-warming New Releases (${PAGES_TO_PREWARM} page(s))...`);
    for (let page = 1; page <= PAGES_TO_PREWARM; page++) {
      const promises = [
        cache.prewarm(
          cache.key('catalog', `hmm-recent-page-${page}`),
          cache.getTTL('catalog'),
          () => hentaimamaScraper.getCatalog(page, null, 'recent')
        ),
        cache.prewarm(
          cache.key('catalog', `hse-recent-page-${page}`),
          cache.getTTL('catalog'),
          () => hentaiseaScraper.getCatalog(page, null, 'recent')
        ),
        cache.prewarm(
          cache.key('catalog', `htv-recent-page-${page}`),
          cache.getTTL('catalog'),
          () => hentaitvScraper.getCatalog(page, null, 'recent')
        )
      ];
      
      await Promise.allSettled(promises);
      logger.debug(`New Releases page ${page} warmed`);
      
      if (page < PAGES_TO_PREWARM) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
    
    logger.info('Catalog pre-warming complete');
    logger.debug(`Cache stats: ${JSON.stringify(cache.getStats())}`);
  } catch (error) {
    logger.warn(`Catalog pre-warm error: ${error.message}`);
  }
}

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

// Log all requests (debug level to reduce noise)
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
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
    logger.info('⏭Self-ping disabled (not in production mode)');
    return;
  }

  const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes (before 15-min timeout)
  
  // Get the app's own URL from Render environment variable
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  
  if (!selfUrl) {
    logger.warn('RENDER_EXTERNAL_URL not found - self-ping disabled');
    return;
  }

  const pingUrl = `${selfUrl}/health`;
  
  logger.info(`🔄 Self-ping enabled: ${pingUrl} every ${PING_INTERVAL / 60000} minutes`);

  setInterval(async () => {
    try {
      const https = require('https');
      const http = require('http');
      const client = pingUrl.startsWith('https') ? https : http;
      
      client.get(pingUrl, (res) => {
        logger.debug(`Self-ping: ${res.statusCode}`);
      }).on('error', (err) => {
        logger.error('Self-ping failed:', err.message);
      });
    } catch (error) {
      logger.error('Self-ping error:', error.message);
    }
  }, PING_INTERVAL);

  // Do an initial ping after 1 minute
  setTimeout(() => {
    logger.debug('Initial self-ping');
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

// ============ INCREMENTAL DATABASE UPDATE SYSTEM ============
// Runs daily at midnight to add new content and update filter counts

// Track last update time and status
let lastIncrementalUpdate = null;
let incrementalUpdateInProgress = false;
let nextScheduledUpdate = null;

/**
 * Run incremental database update
 * Adds new content from providers and updates filter counts
 */
async function runIncrementalDatabaseUpdate() {
  if (incrementalUpdateInProgress) {
    logger.warn('[IncrementalUpdate] Update already in progress, skipping');
    return { success: false, error: 'Update already in progress' };
  }
  
  incrementalUpdateInProgress = true;
  const startTime = Date.now();
  
  try {
    logger.info('[IncrementalUpdate] Starting incremental database update...');
    
    // Import the update script's main function
    const { runIncrementalUpdate } = require('../scripts/update-database');
    
    // Run the update (this modifies data/catalog.json and filter-options.json)
    await runIncrementalUpdate();
    
    // Reload the database into memory
    logger.info('[IncrementalUpdate] Reloading database into memory...');
    await databaseLoader.loadDatabase(true); // Force reload
    
    const duration = Date.now() - startTime;
    const stats = databaseLoader.getStats();
    
    lastIncrementalUpdate = {
      timestamp: new Date().toISOString(),
      duration,
      success: true,
      totalSeries: stats?.totalSeries || 0
    };
    
    logger.info(`[IncrementalUpdate] Update completed in ${duration}ms. Database now has ${stats?.totalSeries || 0} series`);
    
    // Clear manifest/catalog caches to reflect new counts
    await cache.flushAll();
    logger.info('[IncrementalUpdate] Caches cleared to reflect updated counts');
    
    return { success: true, duration, totalSeries: stats?.totalSeries || 0 };
  } catch (error) {
    logger.error(`[IncrementalUpdate] Update failed: ${error.message}`);
    lastIncrementalUpdate = {
      timestamp: new Date().toISOString(),
      success: false,
      error: error.message
    };
    return { success: false, error: error.message };
  } finally {
    incrementalUpdateInProgress = false;
  }
}

/**
 * Calculate milliseconds until next midnight
 */
function msUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

/**
 * Setup daily midnight update scheduler
 */
function setupDailyUpdate() {
  // Only enable in production
  if (config.server.env !== 'production') {
    logger.info('[IncrementalUpdate] Daily update disabled (not in production mode)');
    return;
  }
  
  const scheduleNextUpdate = () => {
    const msToMidnight = msUntilMidnight();
    nextScheduledUpdate = new Date(Date.now() + msToMidnight);
    
    logger.info(`[IncrementalUpdate] Next update scheduled for ${nextScheduledUpdate.toISOString()} (in ${Math.round(msToMidnight / 60000)} minutes)`);
    
    setTimeout(async () => {
      try {
        logger.info('[IncrementalUpdate] Running scheduled midnight update...');
        await runIncrementalDatabaseUpdate();
      } catch (error) {
        logger.error(`[IncrementalUpdate] Scheduled update failed: ${error.message}`);
      } finally {
        // Always schedule next day's update, even if this one failed
        scheduleNextUpdate();
      }
    }, msToMidnight);
  };
  
  scheduleNextUpdate();
  logger.info('[IncrementalUpdate] Daily midnight update scheduler enabled');
}

// Admin endpoint to manually trigger incremental update
app.post('/admin/update', async (req, res) => {
  try {
    logger.info('[Admin] Manual incremental update triggered via API');
    const result = await runIncrementalDatabaseUpdate();
    res.json(result);
  } catch (error) {
    logger.error(`[Admin] Update failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Allow GET for easy browser access
app.get('/admin/update', async (req, res) => {
  try {
    logger.info('[Admin] Manual incremental update triggered via API (GET)');
    const result = await runIncrementalDatabaseUpdate();
    res.json(result);
  } catch (error) {
    logger.error(`[Admin] Update failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Status endpoint to check update status
app.get('/admin/update/status', (req, res) => {
  res.json({
    lastUpdate: lastIncrementalUpdate,
    updateInProgress: incrementalUpdateInProgress,
    nextScheduledUpdate: nextScheduledUpdate?.toISOString() || null,
    database: databaseLoader.isReady() ? databaseLoader.getStats() : null
  });
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
      logger.debug(`Video proxy: Fetching fresh auth from jwplayer...`);
      
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
          logger.debug(`Video proxy: Got fresh URL`);
        }
      } catch (err) {
        logger.error(`Video proxy: Failed to get jwplayer auth: ${err.message}`);
        return res.status(500).send('Failed to get video authentication');
      }
    } 
    // If we have an episode ID, fetch the episode page and get jwplayer URL
    else if (episodeId) {
      logger.debug(`Video proxy: Fetching episode ${episodeId}...`);
      
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
              logger.debug(`Video proxy: Got fresh URL from episode`);
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
    logger.debug(`Video proxy: Streaming video...`);
    
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
    
    // Remove counts from filter options if showCounts is disabled
    if (userConfig.showCounts === false) {
      manifest.catalogs = manifest.catalogs.map(cat => {
        if (!cat.extra) return cat;
        return {
          ...cat,
          extra: cat.extra.map(ext => {
            if (ext.name === 'genre' && ext.options) {
              // Remove count suffix like " (125)" from each option
              const cleanOptions = ext.options.map(opt => 
                opt.replace(/\s*\(\d+\)$/, '').trim()
              );
              return { ...ext, options: cleanOptions };
            }
            return ext;
          })
        };
      });
    }
    
    logger.debug(`Serving manifest (${JSON.stringify(manifest).length} bytes)`);
    
    // Trigger catalog pre-warming in background when manifest is served (addon install)
    prewarmCatalogsOnManifest();
    
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
    
    // Remove counts from filter options if showCounts is disabled
    if (userConfig.showCounts === false) {
      manifest.catalogs = manifest.catalogs.map(cat => {
        if (!cat.extra) return cat;
        return {
          ...cat,
          extra: cat.extra.map(ext => {
            if (ext.name === 'genre' && ext.options) {
              // Remove count suffix like " (125)" from each option
              const cleanOptions = ext.options.map(opt => 
                opt.replace(/\s*\(\d+\)$/, '').trim()
              );
              return { ...ext, options: cleanOptions };
            }
            return ext;
          })
        };
      });
    }
    
    logger.debug(`Serving configured manifest (${JSON.stringify(manifest).length} bytes)`);
    
    // Trigger catalog pre-warming in background when manifest is served (addon install)
    prewarmCatalogsOnManifest();
    
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
    
    logger.debug(`Catalog with extra: type=${type}, id=${id}`);
    
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
    logger.debug(`Path-based catalog: ${req.params.type}/${req.params.id}`);
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
    logger.debug(`Path-based catalog with extra: ${req.params.type}/${req.params.id}`);
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
    
    logger.debug(`Parsed extra: ${JSON.stringify(extra)}`);
    
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
  logger.info(`${config.addon.name} v${config.addon.version}`);
  logger.info(`========================================`);
  logger.info(`Server running on port ${config.server.port}`);
  logger.info(`Environment: ${config.server.env}`);
  logger.info(`Manifest URL: http://localhost:${config.server.port}/manifest.json`);
  logger.info(`Install URL: stremio://localhost:${config.server.port}/manifest.json`);
  logger.info(`========================================`);
  
  // Initialize pre-bundled database (if available)
  await initializeDatabase();
  
  // Pre-warm connection pools (HTTP/2 keep-alive)
  try {
    await httpClient.prewarmConnections();
  } catch (error) {
    logger.warn(`Connection pool warmup failed: ${error.message}`);
  }
  
  // Pre-warm catalog cache in background (don't block startup)
  // SIMPLIFIED: With database, only need to warm "New Releases" for fresh content
  setTimeout(async () => {
    const dbReady = databaseLoader.isReady();
    
    if (dbReady) {
      logger.info('📦 Database loaded - skipping startup cache warmup (data pre-bundled)');
      logger.info('   New content will be fetched on first "New Releases" request');
      return;
    }
    
    // Only run full warmup if no database
    logger.info('⚠️ No database - warming catalog cache from scrapers...');
    
    try {
      const hentaimamaScraper = require('./scrapers/hentaimama');
      const hentaiseaScraper = require('./scrapers/hentaisea');
      const hentaitvScraper = require('./scrapers/hentaitv');
      
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
      
      logger.info(`Cache warmup complete: ${succeeded}/${warmupPromises.length} providers ready`);
    } catch (error) {
      logger.warn(`Cache warmup error: ${error.message}`);
    }
  }, 5000);
  
  // Start self-ping mechanism (Render keep-alive)
  setupSelfPing();
  
  // Start daily incremental update scheduler
  setupDailyUpdate();
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
