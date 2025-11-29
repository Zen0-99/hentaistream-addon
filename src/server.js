const express = require('express');
const { serveHTTP } = require('stremio-addon-sdk');
const addon = require('./addon');
const config = require('./config/env');
const logger = require('./utils/logger');

// Create Express app
const app = express();

// Middleware
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`, { 
    query: req.query,
    ip: req.ip,
  });
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

// Root endpoint - addon info
app.get('/', (req, res) => {
  res.json({
    name: config.addon.name,
    version: config.addon.version,
    description: config.addon.description,
    manifest_url: `${req.protocol}://${req.get('host')}/manifest.json`,
    endpoints: {
      health: '/health',
      manifest: '/manifest.json',
      catalog: '/catalog/:type/:id.json',
      meta: '/meta/:type/:id.json',
      stream: '/stream/:type/:id.json',
    },
    note: 'This is an adult content addon (18+). Use responsibly.',
  });
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

// Landing page
app.get('/', (req, res) => {
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
    <strong>⚠️ Adult Content Warning:</strong> This addon provides access to adult content (18+). By installing, you confirm you are of legal age.
  </div>
  <p><strong>Version:</strong> ${config.addon.version}</p>
  <p><strong>Status:</strong> Running</p>
  <h2>Install</h2>
  <p>Click the button below to install this addon in Stremio:</p>
  <a href="stremio://${req.get('host')}/manifest.json" class="button">Install in Stremio</a>
  <a href="/manifest.json" class="button">View Manifest</a>
  <a href="/health" class="button">Health Check</a>
</body>
</html>`;
  res.send(landingHTML);
});

// Mount Stremio addon using the SDK's getRouter
const addonInterface = addon;
const getRouter = require('stremio-addon-sdk').getRouter;

// Use the SDK's router which properly handles the addon interface
app.use(getRouter(addonInterface));

// Error handler
app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.server.env === 'development' ? err.message : 'Something went wrong',
  });
});

// Start server
const server = app.listen(config.server.port, () => {
  logger.info(`========================================`);
  logger.info(`🚀 ${config.addon.name} v${config.addon.version}`);
  logger.info(`========================================`);
  logger.info(`Server running on port ${config.server.port}`);
  logger.info(`Environment: ${config.server.env}`);
  logger.info(`Manifest URL: http://localhost:${config.server.port}/manifest.json`);
  logger.info(`Health Check: http://localhost:${config.server.port}/health`);
  logger.info(`Install URL: stremio://localhost:${config.server.port}/manifest.json`);
  logger.info(`========================================`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');
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
