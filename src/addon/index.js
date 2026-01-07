/**
 * Addon Handlers Export
 * 
 * This module exports the handlers directly without using the Stremio addon SDK's
 * addonBuilder, which has an 8KB manifest size limit. Instead, we serve the manifest
 * directly via Express (see server.js), bypassing this limit entirely.
 */

const catalogHandler = require('./handlers/catalog');
const metaHandler = require('./handlers/meta');
// Use Cloudflare Workers-based stream handler (lightweight, scalable)
const streamHandler = require('./handlers/stream-workers');
const { getManifest } = require('./manifest');
const logger = require('../utils/logger');

/**
 * Get the manifest (generated fresh each time for dynamic time period counts)
 * 
 * NOTE: We don't cache the manifest because time period counts need to be
 * recalculated dynamically (e.g., "This Week" count changes as time passes)
 */
async function getManifestFresh() {
  try {
    const manifest = await getManifest();
    logger.info(`Manifest loaded with ${manifest.catalogs.length} catalogs`);
    return manifest;
  } catch (err) {
    logger.error('Failed to load manifest:', err.message);
    // Return base manifest from require
    return require('./manifest');
  }
}

/**
 * Catalog handler wrapper with error handling
 */
async function handleCatalog(args) {
  try {
    return await catalogHandler(args);
  } catch (error) {
    logger.error('Catalog handler error:', error);
    return { metas: [] };
  }
}

/**
 * Meta handler wrapper with error handling
 */
async function handleMeta(args) {
  try {
    return await metaHandler(args);
  } catch (error) {
    logger.error('Meta handler error:', error);
    return { meta: null };
  }
}

/**
 * Stream handler wrapper with error handling
 */
async function handleStream(args) {
  try {
    return await streamHandler(args);
  } catch (error) {
    logger.error('Stream handler error:', error);
    return { streams: [] };
  }
}

logger.info('Addon handlers initialized');

module.exports = {
  catalogHandler: handleCatalog,
  metaHandler: handleMeta,
  streamHandler: handleStream,
  getManifest: getManifestFresh
};
