const logger = require('./logger');

/**
 * Quality priorities for sorting (higher number = higher priority)
 */
const QUALITY_PRIORITY = {
  '2160p': 100,
  '4k': 100,
  '1440p': 90,
  '1080p': 80,
  '720p': 60,
  '480p': 40,
  '360p': 20,
  '240p': 10,
};

/**
 * Extract quality information from various formats
 * @param {Object} stream - Stream object
 * @returns {Object} Object with quality info
 */
function extractQuality(stream) {
  if (!stream) return { resolution: 'unknown', priority: 0 };

  // Check common quality fields
  const qualityStr = (
    stream.quality ||
    stream.resolution ||
    stream.label ||
    stream.height ||
    stream.name ||
    ''
  ).toString().toLowerCase();

  // Extract resolution
  for (const [resolution, priority] of Object.entries(QUALITY_PRIORITY)) {
    if (qualityStr.includes(resolution)) {
      return { resolution, priority };
    }
  }

  // Try to extract from height (e.g., 1080 -> 1080p)
  const heightMatch = qualityStr.match(/(\d{3,4})/);
  if (heightMatch) {
    const resolution = `${heightMatch[1]}p`;
    const priority = QUALITY_PRIORITY[resolution] || 50;
    return { resolution, priority };
  }

  return { resolution: 'unknown', priority: 0 };
}

/**
 * Sort streams by quality (highest first)
 * @param {Array} streams - Array of stream objects
 * @returns {Array} Sorted array of streams
 */
function sortByQuality(streams) {
  if (!streams || !Array.isArray(streams)) {
    return [];
  }

  return streams
    .map(stream => ({
      ...stream,
      _qualityInfo: extractQuality(stream),
    }))
    .sort((a, b) => b._qualityInfo.priority - a._qualityInfo.priority)
    .map(({ _qualityInfo, ...stream }) => stream);  // Remove temp field
}

/**
 * Filter streams by minimum quality
 * @param {Array} streams - Array of stream objects
 * @param {string} minQuality - Minimum quality (e.g., '720p')
 * @returns {Array} Filtered streams
 */
function filterByMinQuality(streams, minQuality = '480p') {
  if (!streams || !Array.isArray(streams)) {
    return [];
  }

  const minPriority = QUALITY_PRIORITY[minQuality] || 0;

  return streams.filter(stream => {
    const quality = extractQuality(stream);
    return quality.priority >= minPriority;
  });
}

/**
 * Get best quality stream from array
 * @param {Array} streams - Array of stream objects
 * @returns {Object|null} Best quality stream or null
 */
function getBestQuality(streams) {
  if (!streams || streams.length === 0) {
    return null;
  }

  const sorted = sortByQuality(streams);
  return sorted[0];
}

/**
 * Group streams by quality
 * @param {Array} streams - Array of stream objects
 * @returns {Object} Object with quality keys and stream arrays
 */
function groupByQuality(streams) {
  if (!streams || !Array.isArray(streams)) {
    return {};
  }

  const grouped = {};

  streams.forEach(stream => {
    const { resolution } = extractQuality(stream);
    if (!grouped[resolution]) {
      grouped[resolution] = [];
    }
    grouped[resolution].push(stream);
  });

  return grouped;
}

/**
 * Format stream name with quality and server info
 * @param {Object} stream - Stream object
 * @returns {string} Formatted stream name
 */
function formatStreamName(stream) {
  const { resolution } = extractQuality(stream);
  const server = stream.serverId || stream.server || stream.source || '';
  
  let name = resolution !== 'unknown' ? resolution : 'Stream';
  
  if (server) {
    name += ` - ${server}`;
  }
  
  if (stream.kind && stream.kind !== 'main') {
    name += ` (${stream.kind})`;
  }
  
  return name;
}

/**
 * Detect stream type from URL or extension
 * @param {string} url - Stream URL
 * @param {string} extension - File extension
 * @returns {Object} Object with type and format info
 */
function detectStreamType(url, extension = null) {
  const ext = extension || url.split('.').pop().split('?')[0].toLowerCase();
  
  const types = {
    m3u8: { format: 'hls', notWebReady: true, description: 'HLS Stream' },
    mpd: { format: 'dash', notWebReady: true, description: 'DASH Stream' },
    mp4: { format: 'mp4', notWebReady: false, description: 'MP4 Video' },
    mkv: { format: 'mkv', notWebReady: true, description: 'MKV Video' },
    avi: { format: 'avi', notWebReady: true, description: 'AVI Video' },
    webm: { format: 'webm', notWebReady: false, description: 'WebM Video' },
  };
  
  return types[ext] || { format: 'unknown', notWebReady: false, description: 'Video Stream' };
}

/**
 * Transform raw stream to Stremio format
 * @param {Object} rawStream - Raw stream object from API
 * @param {string} title - Stream title prefix
 * @returns {Object} Stremio-formatted stream object
 */
function toStremioStream(rawStream, title = 'Stream') {
  if (!rawStream || !rawStream.url) {
    logger.warn('Invalid stream object - missing URL');
    return null;
  }

  const streamType = detectStreamType(rawStream.url, rawStream.extension);
  const streamName = formatStreamName(rawStream);

  return {
    url: rawStream.url,
    name: streamName,
    title: `${title} - ${streamName}`,
    behaviorHints: {
      notWebReady: streamType.notWebReady,
    },
  };
}

/**
 * Create "no streams found" placeholder
 * @param {string} reason - Reason why no streams available
 * @returns {Object} Placeholder stream object
 */
function createNoStreamsPlaceholder(reason = 'No streams available') {
  return {
    name: '⚠️ No Streams Found',
    title: reason,
    url: '',  // Empty URL
    behaviorHints: {
      notWebReady: true,
    },
  };
}

module.exports = {
  extractQuality,
  sortByQuality,
  filterByMinQuality,
  getBestQuality,
  groupByQuality,
  formatStreamName,
  detectStreamType,
  toStremioStream,
  createNoStreamsPlaceholder,
  QUALITY_PRIORITY,
};
