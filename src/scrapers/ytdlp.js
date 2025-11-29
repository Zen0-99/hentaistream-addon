const YTDlpWrap = require('yt-dlp-wrap').default;
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

/**
 * yt-dlp wrapper for extracting streams from video sites
 * Handles sites with DRM, authentication, and complex stream protection
 */
class YtDlpScraper {
  constructor(options = {}) {
    // Use local yt-dlp binary if available
    const localBinary = path.join(__dirname, '..', '..', 'bin', 'yt-dlp.exe');
    const binaryPath = fs.existsSync(localBinary) ? localBinary : 'yt-dlp';
    
    this.ytdlp = new YTDlpWrap(binaryPath);
    this.pluginPath = options.pluginPath;
    
    // Set user agent to avoid detection
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    logger.info('Initialized yt-dlp scraper', { 
      binaryPath,
      pluginPath: this.pluginPath 
    });
  }

  /**
   * Get video information including all available formats
   * @param {string} url - Video URL to extract
   * @returns {Promise<Object>} Video info with formats
   */
  async getVideoInfo(url) {
    try {
      logger.info(`yt-dlp: Extracting video info for ${url}`);
      
      // Set plugin directory to use HAnime extractor
      const pluginDir = path.join(__dirname, '..', '..', 'yt_dlp_plugins');
      
      const args = [
        '--dump-json',
        '--user-agent', this.userAgent,
        '--referer', 'https://hanime.tv/',
        '--no-warnings',
      ];

      // Add plugin path for custom extractors (HAnime, etc.)
      if (fs.existsSync(pluginDir)) {
        args.push('--paths', `plugins:${pluginDir}`);
        logger.info(`yt-dlp: Using plugins from ${pluginDir}`);
      }

      args.push(url);

      const result = await this.ytdlp.execPromise(args);
      const info = JSON.parse(result);
      
      logger.info(`yt-dlp: Found ${info.formats?.length || 0} formats for ${url}`);
      return info;
    } catch (error) {
      logger.error(`yt-dlp: Failed to extract video info for ${url}:`, error);
      throw error;
    }
  }

  /**
   * Extract direct stream URLs from a video page
   * @param {string} url - Video URL
   * @returns {Promise<Array>} Array of stream objects with URL, quality, etc.
   */
  async getStreams(url) {
    try {
      const info = await this.getVideoInfo(url);
      
      if (!info.formats || info.formats.length === 0) {
        logger.warn(`yt-dlp: No formats found for ${url}`);
        return [];
      }

      // Filter for video formats (exclude audio-only)
      const videoFormats = info.formats.filter(f => {
        const hasVideo = f.vcodec && f.vcodec !== 'none';
        const hasUrl = f.url && f.url !== '';
        return hasVideo && hasUrl;
      });

      // Map to our stream format
      const streams = videoFormats.map(format => {
        const height = format.height || 0;
        const width = format.width || 0;
        const quality = height > 0 ? `${height}p` : 'Unknown';
        const protocol = format.protocol || 'https';
        const ext = format.ext || 'mp4';
        
        return {
          url: format.url,
          quality: quality,
          height: height,
          width: width,
          fps: format.fps,
          protocol: protocol,
          extension: ext,
          filesize: format.filesize,
          formatId: format.format_id,
          formatNote: format.format_note || '',
          tbr: format.tbr, // Total bitrate
          vbr: format.vbr, // Video bitrate
          abr: format.abr, // Audio bitrate
        };
      });

      // Sort by quality (highest first)
      streams.sort((a, b) => {
        // Prefer higher resolution
        if (b.height !== a.height) {
          return (b.height || 0) - (a.height || 0);
        }
        // Then prefer higher bitrate
        return (b.tbr || 0) - (a.tbr || 0);
      });

      logger.info(`yt-dlp: Extracted ${streams.length} video streams from ${url}`);
      return streams;
    } catch (error) {
      logger.error(`yt-dlp: Failed to extract streams for ${url}:`, error);
      return [];
    }
  }

  /**
   * Get metadata about the video
   * @param {string} url - Video URL
   * @returns {Promise<Object>} Video metadata
   */
  async getMetadata(url) {
    try {
      const info = await this.getVideoInfo(url);
      
      return {
        title: info.title,
        description: info.description,
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: info.uploader,
        uploadDate: info.upload_date,
        viewCount: info.view_count,
        likeCount: info.like_count,
        tags: info.tags || [],
      };
    } catch (error) {
      logger.error(`yt-dlp: Failed to extract metadata for ${url}:`, error);
      return null;
    }
  }

  /**
   * Check if yt-dlp binary is available
   * @returns {Promise<boolean>}
   */
  async checkAvailable() {
    try {
      const version = await this.ytdlp.getVersion();
      logger.info(`yt-dlp version: ${version}`);
      return true;
    } catch (error) {
      logger.error('yt-dlp not available:', error);
      return false;
    }
  }
}

module.exports = YtDlpScraper;
