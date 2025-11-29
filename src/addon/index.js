const { addonBuilder } = require('stremio-addon-sdk');
const baseManifest = require('./manifest');
const { getManifest } = require('./manifest');
const catalogHandler = require('./handlers/catalog');
const metaHandler = require('./handlers/meta');
const streamHandler = require('./handlers/stream');
const logger = require('../utils/logger');

// Create addon builder with base manifest (will be updated dynamically)
const builder = new addonBuilder(baseManifest);

// Store dynamic manifest promise
let manifestPromise = null;

// Get or update manifest with genre catalogs
async function ensureManifestUpdated() {
  if (!manifestPromise) {
    manifestPromise = getManifest().then(manifest => {
      // Update builder's manifest
      builder.manifest = manifest;
      logger.info(`Manifest updated with ${manifest.catalogs.length} catalogs`);
      return manifest;
    }).catch(err => {
      logger.error('Failed to update manifest:', err.message);
      return baseManifest;
    });
  }
  return manifestPromise;
}

// Initialize manifest on startup
ensureManifestUpdated();

// Define catalog handler
builder.defineCatalogHandler(async (args) => {
  try {
    return await catalogHandler(args);
  } catch (error) {
    logger.error('Catalog handler error:', error);
    return { metas: [] };
  }
});

// Define meta handler
builder.defineMetaHandler(async (args) => {
  try {
    return await metaHandler(args);
  } catch (error) {
    logger.error('Meta handler error:', error);
    return { meta: null };
  }
});

// Define stream handler
builder.defineStreamHandler(async (args) => {
  try {
    return await streamHandler(args);
  } catch (error) {
    logger.error('Stream handler error:', error);
    return { streams: [] };
  }
});

logger.info('Addon handlers initialized');

module.exports = builder.getInterface();
