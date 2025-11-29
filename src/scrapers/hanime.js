const BaseScraper = require('./base');
const logger = require('../utils/logger');
const cheerio = require('cheerio');

class HAnimeScraper extends BaseScraper {
  constructor() {
    super('hanime');
    this.baseUrl = 'https://hanime.tv';
    this.searchUrl = 'https://search.htv-services.com';
    this.apiUrl = 'https://hanime.tv/rapi/v7/videos_manifests';
  }

  /**
   * Generate random signature for HAnime API
   */
  generateSignature() {
    return Array.from({ length: 32 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  /**
   * Get recent/catalog content from HAnime
   */
  async getCatalog(skip = 0, limit = 100) {
    try {
      logger.info(`Fetching HAnime catalog (skip: ${skip}, limit: ${limit})`);
      
      const page = Math.floor(skip / limit);
      
      const response = await this.client.post(this.searchUrl, {
        blacklist: [],
        brands: [],
        order_by: 'created_at_unix',
        page: page,
        tags: [],
        search_text: '',
        tags_mode: 'AND',
      });

      const { hits, nbHits } = response.data;
      const allResults = JSON.parse(hits);
      
      // Slice to get exact limit
      const results = allResults.slice(0, limit);

      return results.map(item => this.mapSearchResultToMeta(item));
    } catch (error) {
      return this.handleError('getCatalog', error);
    }
  }

  /**
   * Search HAnime content
   */
  async search(query, page = 1, limit = 100) {
    try {
      logger.info(`Searching HAnime for: ${query} (page: ${page})`);
      
      const response = await this.client.post(this.searchUrl, {
        blacklist: [],
        brands: [],
        order_by: 'created_at_unix',
        page: page - 1,
        tags: [],
        search_text: query,
        tags_mode: 'AND',
      });

      const { hits, nbHits, nbPages } = response.data;
      const allResults = JSON.parse(hits);
      
      const results = allResults.slice(0, limit);

      return {
        results: results.map(item => this.mapSearchResultToMeta(item)),
        total: nbHits,
        pages: nbPages,
        page: page,
        hasNextPage: page < nbPages,
      };
    } catch (error) {
      return this.handleError('search', error);
    }
  }

  /**
   * Get detailed metadata for a series
   */
  async getMeta(slug) {
    try {
      logger.info(`Fetching metadata for HAnime slug: ${slug}`);
      
      // Use API v8 endpoint instead of parsing HTML
      const apiUrl = `${this.baseUrl}/api/v8/video?id=${slug}`;
      const response = await this.client.get(apiUrl);
      const data = response.data;
      
      const hentaiVideo = data.hentai_video;
      const franchise = data.hentai_franchise;
      const franchiseVideos = data.hentai_franchise_hentai_videos || [];

      // Map episodes
      const episodes = franchiseVideos.map((ep, index) => ({
        id: ep.id,
        name: ep.name,
        slug: ep.slug,
        number: index + 1,
        thumbnailUrl: ep.poster_url,
        coverUrl: ep.cover_url,
        views: ep.views,
        likes: ep.likes,
        rating: ep.rating,
        durationMs: ep.duration_in_ms,
        createdAt: ep.created_at,
        releasedAt: ep.released_at,
      }));

      return {
        id: slug,
        franchiseId: franchise.id,
        franchiseSlug: franchise.slug,
        title: franchise.title || franchise.name,
        description: hentaiVideo.description,
        posterUrl: hentaiVideo.poster_url,
        coverUrl: hentaiVideo.cover_url,
        views: hentaiVideo.views,
        interests: hentaiVideo.interests,
        likes: hentaiVideo.likes,
        dislikes: hentaiVideo.dislikes,
        rating: hentaiVideo.rating,
        downloads: hentaiVideo.downloads,
        rankMonthly: hentaiVideo.monthly_rank,
        brand: data.brand ? {
          name: data.brand.title,
          id: data.brand.id,
        } : null,
        durationMs: hentaiVideo.duration_in_ms,
        isCensored: hentaiVideo.is_censored,
        tags: data.hentai_tags || [],
        createdAt: hentaiVideo.created_at,
        releasedAt: hentaiVideo.released_at,
        episodes: episodes,
        totalEpisodes: episodes.length,
      };
    } catch (error) {
      return this.handleError('getMeta', error);
    }
  }

  /**
   * Get stream sources for an episode
   */
  async getStreams(slug) {
    try {
      logger.info(`Fetching streams for HAnime slug: ${slug}`);
      
      // Use API v8 which includes videos_manifest
      const apiUrl = `${this.baseUrl}/api/v8/video?id=${slug}`;
      const response = await this.client.get(apiUrl);
      const data = response.data;

      const videosManifest = data.videos_manifest;
      
      if (!videosManifest || !videosManifest.servers) {
        logger.warn(`No videos_manifest found for ${slug}`);
        return [];
      }

      // Extract all streams from all servers
      const allStreams = videosManifest.servers
        .map(server => server.streams || [])
        .flat();

      // Filter and map streams
      const streams = allStreams
        .filter(video => 
          video.url && 
          video.url !== '' && 
          video.kind !== 'premium_alert'
        )
        .map(video => ({
          id: video.id,
          serverId: video.server_id,
          kind: video.kind,
          extension: video.extension,
          mimeType: video.mime_type,
          width: video.width,
          height: video.height,
          quality: `${video.height}p`,
          durationMs: video.duration_in_ms,
          filesizeMbs: video.filesize_mbs,
          filename: video.filename,
          url: video.url,
        }));

      logger.info(`Found ${streams.length} streams for ${slug}`);
      return streams;
    } catch (error) {
      return this.handleError('getStreams', error);
    }
  }

  /**
   * Get available genres/tags
   */
  async getGenres() {
    try {
      logger.info('Fetching HAnime genres/tags');
      
      // Get catalog to extract tags
      const catalog = await this.getCatalog(0, 50);
      const tagsSet = new Set();
      
      catalog.forEach(item => {
        if (item.tags && Array.isArray(item.tags)) {
          item.tags.forEach(tag => {
            if (tag && tag.text) {
              tagsSet.add(tag.text);
            }
          });
        }
      });

      return Array.from(tagsSet).sort();
    } catch (error) {
      return this.handleError('getGenres', error);
    }
  }

  /**
   * Map raw search result to metadata object
   */
  /**
   * Extract series slug from episode slug
   * e.g., "yabai-fukushuu-yami-site-1" -> "yabai-fukushuu-yami-site"
   */
  extractSeriesSlug(episodeSlug) {
    // Remove trailing episode number pattern like -1, -2, etc.
    return episodeSlug.replace(/-\d+$/, '');
  }

  mapSearchResultToMeta(raw) {
    const episodeSlug = raw.slug || raw.id?.toString();
    const seriesSlug = this.extractSeriesSlug(episodeSlug);
    
    return {
      id: raw.slug || raw.id?.toString(),
      name: raw.name,
      titles: raw.titles || [],
      slug: raw.slug,
      seriesSlug: seriesSlug,
      description: raw.description || '',
      views: raw.views || 0,
      interests: raw.interests || 0,
      posterUrl: raw.poster_url || raw.cover_url,
      coverUrl: raw.cover_url,
      brand: {
        name: raw.brand,
        id: raw.brand_id,
      },
      durationMs: raw.duration_in_ms,
      isCensored: raw.is_censored || false,
      likes: raw.likes || 0,
      rating: raw.rating || 0,
      dislikes: raw.dislikes || 0,
      downloads: raw.downloads || 0,
      rankMonthly: raw.monthly_rank,
      tags: raw.tags || [],
      createdAt: raw.created_at,
      releasedAt: raw.released_at,
    };
  }
}

module.exports = HAnimeScraper;
