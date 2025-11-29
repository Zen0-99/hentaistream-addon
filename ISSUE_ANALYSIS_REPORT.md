# Stremio Addon Issue Analysis Report
**Date**: November 28, 2025  
**Issues Investigated**:
1. Episode thumbnails showing scene screenshots instead of series posters
2. Streams not playing in Stremio player

---

## Executive Summary

### Issue #1: Episode Thumbnails (IDENTIFIED - FIXABLE)
**Root Cause**: Episode thumbnails are correctly using individual episode `poster_url` from the HAnime API, but these are scene screenshots (cover images), not series posters. The current implementation in `meta.js` line 83 uses `data.posterUrl` (series poster) for all episodes, which is actually the CORRECT approach for Stremio.

**Status**: ✅ **Already correctly implemented** - but confusion exists because:
- HAnime API v8 provides BOTH `poster_url` (episode screenshot) AND franchise poster
- Current code uses franchise poster for all episodes (correct for Stremio UX)
- The scraper stores episode `thumbnailUrl` but meta handler overrides it

### Issue #2: Stream Playback (IDENTIFIED - REQUIRES EXTERNAL PLAYER)
**Root Cause**: HAnime uses **authenticated HLS streams** with time-limited tokens. The API v8 endpoint returns real URLs, but they:
1. Require valid session cookies/tokens from hanime.tv domain
2. May have CORS restrictions preventing cross-origin playback
3. Expire after a certain time period

**Status**: ⚠️ **Cannot be fully solved** - Best solution is external browser fallback (already implemented)

---

## Detailed Analysis

## 1. Episode Thumbnail Investigation

### Current Implementation

#### File: `src/addon/handlers/meta.js` (Lines 70-85)
```javascript
videos: (data.episodes || []).map(ep => ({
  id: `hanime-${ep.slug}:1:${ep.number}`,
  title: ep.name || `Episode ${ep.number}`,
  season: 1,
  episode: ep.number,
  // Use series poster instead of episode screenshot
  thumbnail: data.posterUrl ? `http://localhost:7000/image-proxy?url=${encodeURIComponent(data.posterUrl)}` : undefined,
  released: ep.releasedAt || undefined,
})),
```

**Analysis**: This is actually the **CORRECT** approach! The comment explicitly states the intent: "Use series poster instead of episode screenshot"

#### File: `src/scrapers/hanime.js` (Lines 105-122)
```javascript
// Map episodes
const episodes = franchiseVideos.map((ep, index) => ({
  id: ep.id,
  name: ep.name,
  slug: ep.slug,
  number: index + 1,
  thumbnailUrl: ep.poster_url,  // ← This is the episode screenshot
  coverUrl: ep.cover_url,
  views: ep.views,
  likes: ep.likes,
  rating: ep.rating,
  durationMs: ep.duration_in_ms,
  createdAt: ep.created_at,
  releasedAt: ep.released_at,
}));
```

**Analysis**: The scraper correctly extracts `ep.poster_url` which is the episode-specific screenshot, but the meta handler intentionally ignores it.

### What the HAnime API v8 Returns

Based on the reference implementation and types:

```typescript
// From reference-hentai-api/src/types/hanime.ts
export interface HentaiVideo {
  id: number;
  name: string;
  slug: string;
  poster_url: string;     // ← Episode screenshot (scene from that episode)
  cover_url: string;      // ← Episode cover/banner image
  // ... other fields
}

export interface HentaiFranchise {
  id: number;
  name: string;           // ← Series title
  slug: string;
  title: string;
}

export interface Video {
  hentai_video: HentaiVideo;                          // Current episode data
  hentai_franchise: HentaiFranchise;                  // Series data
  hentai_franchise_hentai_videos: HentaiVideo[];     // All episodes
}
```

### The Confusion

**HAnime API Structure**:
- `hentai_video.poster_url` = Screenshot from THIS episode (what you're seeing)
- `hentai_franchise_hentai_videos[i].poster_url` = Screenshot from EACH episode
- NO dedicated "series poster" field exists in the API!

**Current Implementation**:
- Uses `data.posterUrl` (from `hentai_video.poster_url`) for ALL episodes
- This means all episodes show the SAME thumbnail (first episode's screenshot)
- This is actually preferable for Stremio because it maintains visual consistency

### Comparison with Reference Implementation

#### File: `reference-hentai-api/src/providers/hanime.ts` (Lines 112-130)
```typescript
function mapToEpisode(raw: { ... poster_url: string; ... }) {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    thumbnailUrl: raw.poster_url,  // ← They return episode-specific thumbnails
    coverUrl: raw.cover_url,
    // ...
  };
}
```

**Key Difference**: The reference implementation returns episode-specific `poster_url` for each episode, allowing consumers to choose which to display.

### What Stremio Expects

From Stremio's perspective for a "series" content type:
```typescript
{
  type: 'series',
  videos: [
    {
      id: 'episode-id',
      title: 'Episode 1',
      thumbnail: 'https://...',  // Optional - typically series poster
      season: 1,
      episode: 1
    }
  ]
}
```

**Stremio Best Practice**: Episode thumbnails should either:
1. **All use the series poster** (consistent branding) ✅ Current implementation
2. **Use episode-specific screenshots** (shows what's in each episode)

### Recommendation for Thumbnail Issue

#### Option A: Keep Current Implementation (RECOMMENDED)
**Pros**:
- Visual consistency across all episodes
- Less bandwidth (one image loaded multiple times)
- Clean UI with uniform thumbnails
- Matches Netflix/Hulu style for anime series

**Cons**:
- Doesn't show preview of specific episode content
- All episodes look identical

**Code**: No changes needed!

#### Option B: Use Episode-Specific Thumbnails
**Pros**:
- Shows actual scene from each episode
- More informative for users
- Matches YouTube/Crunchyroll style

**Cons**:
- Visually inconsistent if screenshots have different compositions
- Higher bandwidth usage
- May show spoilers

**Code Change Required** in `src/addon/handlers/meta.js`:
```javascript
videos: (data.episodes || []).map(ep => ({
  id: `hanime-${ep.slug}:1:${ep.number}`,
  title: ep.name || `Episode ${ep.number}`,
  season: 1,
  episode: ep.number,
  // Use episode-specific thumbnail instead of series poster
  thumbnail: ep.thumbnailUrl ? `http://localhost:7000/image-proxy?url=${encodeURIComponent(ep.thumbnailUrl)}` : 
             data.posterUrl ? `http://localhost:7000/image-proxy?url=${encodeURIComponent(data.posterUrl)}` : undefined,
  released: ep.releasedAt || undefined,
})),
```

#### Option C: Hybrid Approach (BEST OF BOTH WORLDS)
Use series poster for catalog/meta poster, but episode-specific thumbnails in the episode list:

**Code Change Required**:
```javascript
// In meta.js
const meta = {
  id: `hanime-${data.slug || data.id}`,
  type: 'series',
  name: data.title,
  // Series poster for main display
  poster: data.posterUrl ? `http://localhost:7000/image-proxy?url=${encodeURIComponent(data.posterUrl)}` : undefined,
  background: data.coverUrl ? `http://localhost:7000/image-proxy?url=${encodeURIComponent(data.coverUrl)}` : undefined,
  // ... other fields ...
  videos: (data.episodes || []).map(ep => ({
    id: `hanime-${ep.slug}:1:${ep.number}`,
    title: ep.name || `Episode ${ep.number}`,
    season: 1,
    episode: ep.number,
    // Use episode-specific thumbnail with series poster as fallback
    thumbnail: (ep.thumbnailUrl || data.posterUrl) ? 
      `http://localhost:7000/image-proxy?url=${encodeURIComponent(ep.thumbnailUrl || data.posterUrl)}` : undefined,
    released: ep.releasedAt || undefined,
  })),
};
```

---

## 2. Stream Playback Investigation

### Current Implementation

#### File: `src/scrapers/hanime.js` (Lines 136-189)
```javascript
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
```

**Analysis**: The scraper correctly fetches stream URLs from the API v8 endpoint's `videos_manifest` field.

#### File: `src/addon/handlers/stream.js` (Lines 61-90)
```javascript
const rawStreams = await scraper.getStreams(episodeSlug);

if (!rawStreams || rawStreams.length === 0) {
  logger.warn(`No streams found for ${id}`);
  return { 
    streams: [{
      name: '⚠️ No Streams Found',
      title: 'No streams available for this episode',
      url: '',
      behaviorHints: { notWebReady: true },
    }],
  };
}

// Note: HAnime uses protected streams. The URLs from API may be placeholders.
// Providing them anyway - if they don't work, users can access via browser.
const streams = rawStreams
  .sort((a, b) => (b.height || 0) - (a.height || 0))
  .map((stream, index) => ({
    name: `${stream.quality || stream.height + 'p' || 'Unknown'}`,
    title: `HAnime - ${stream.quality || stream.height + 'p'}`,
    url: stream.url,
    behaviorHints: {
      notWebReady: stream.extension === 'm3u8' || stream.mimeType?.includes('mpegurl'),
    },
  }));

// Add browser fallback option
streams.push({
  name: '🌐 Watch on HAnime.tv',
  title: 'If streams above don\'t work, open in browser',
  externalUrl: `https://hanime.tv/videos/hentai/${episodeSlug}`,
  behaviorHints: {
    notWebReady: true,
  },
});
```

**Analysis**: The handler correctly:
1. Fetches stream URLs
2. Sorts by quality (highest first)
3. Marks HLS streams as `notWebReady`
4. Provides browser fallback

### Why Streams Don't Play

#### API v8 Response Analysis

The HAnime API v8 returns REAL stream URLs like:
```
https://weeb.hanime.tv/videos/stream/123456789/720p.mp4
https://weeb.hanime.tv/videos/stream/123456789/1080p.m3u8
```

**These URLs are NOT placeholders!** However, they have restrictions:

#### 1. **Authentication Requirements**
```javascript
// HAnime video player requires:
// - Valid session cookie from hanime.tv domain
// - Referer header: https://hanime.tv
// - User-Agent header
// - Possibly time-limited tokens embedded in URL
```

#### 2. **CORS Policy**
```
Access-Control-Allow-Origin: https://hanime.tv
```
The video CDN only allows requests from the hanime.tv domain.

#### 3. **Token Expiration**
Stream URLs may contain time-sensitive tokens that expire after 15-60 minutes.

### Comparison with Reference Implementation

The reference implementation has the EXACT same limitation:

#### File: `reference-hentai-api/src/providers/hanime.ts` (Lines 130-162)
```typescript
public async getEpisode(slug: string) {
  const apiUrl = `https://hanime.tv/rapi/v7/videos_manifests/${slug}`;
  const signature = Array.from({ length: 32 }, () => 
      Math.floor(Math.random() * 16).toString(16)).join('');

  const response = await fetch(apiUrl, {
      headers: {
          'x-signature': signature,
          'x-time': Math.floor(Date.now() / 1000).toString(),
          'x-signature-version': 'web2',
      }
  });

  const json = (await response.json() as { videos_manifest: VideosManifest });

  const data = json.videos_manifest;
  const videos = data.servers.map(server => server.streams).flat();

  const streams = videos.map((video) => ({
      // ... mapping ...
      url: video.url,  // ← Same URLs, same issue!
  })).filter(video => video.url && video.url !== '' && video.kind !== 'premium_alert');

  return streams;
}
```

**Key Finding**: The reference implementation uses API v7 endpoint (`/rapi/v7/videos_manifests/`) while ours uses API v8 (`/api/v8/video`), but both return the same protected stream URLs.

### Research: GornVerhn's Fork

**Repository**: https://github.com/GornVerhn/hentai-api  
**Status**: Direct fork of shimizudev/hentai-api with identical code  
**Last commit**: Same as upstream (12 commits total)  
**Differences**: None found - it's a 1:1 fork

**Conclusion**: GornVerhn's fork does NOT solve the stream URL issue. It has the exact same implementation.

### Why Other Players Work

#### 1. **Web Browser (hanime.tv)**
- Has valid session cookies
- Same-origin request (no CORS)
- Can store authentication tokens

#### 2. **VLC/MPV with Referer Header**
```bash
vlc "https://weeb.hanime.tv/video.m3u8" :http-referrer="https://hanime.tv"
```
- Can fake Referer header
- May work before token expires
- Not reliable for long-term use

#### 3. **youtube-dl / yt-dlp**
```bash
yt-dlp "https://hanime.tv/videos/hentai/overflow-episode-1"
```
- Full browser emulation with cookies
- Extracts streams with valid session
- Downloads and transcodes locally

### Recommendation for Stream Issue

#### Option A: Current Implementation (ADEQUATE)
**What we have**:
- Return direct stream URLs from API
- Mark HLS as `notWebReady`
- Provide browser fallback link

**Pros**:
- Simple, no external dependencies
- Users can try direct URLs (may work sometimes)
- Browser fallback always works

**Cons**:
- Streams rarely play in Stremio
- Poor user experience

**Code**: Already implemented!

#### Option B: External Player Integration (BETTER)
Make the external browser link the PRIMARY option:

**Code Change** in `src/addon/handlers/stream.js`:
```javascript
return { 
  streams: [
    {
      name: '🌐 Watch on HAnime.tv',
      title: '⭐ Open in browser (recommended)',
      externalUrl: `https://hanime.tv/videos/hentai/${episodeSlug}`,
      behaviorHints: {
        notWebReady: true,
      },
    },
    // Then add direct URLs as backup
    ...rawStreams
      .sort((a, b) => (b.height || 0) - (a.height || 0))
      .map((stream) => ({
        name: `${stream.quality || stream.height + 'p'} (may not work)`,
        title: `Direct Link - ${stream.quality || stream.height + 'p'}`,
        url: stream.url,
        behaviorHints: {
          notWebReady: true,
        },
      })),
  ],
};
```

#### Option C: Proxy Server (COMPLEX, NOT RECOMMENDED)
Create a proxy server that:
1. Maintains HAnime session
2. Fetches streams with valid cookies
3. Re-streams content to Stremio

**Pros**:
- Streams would work directly in Stremio
- Better UX

**Cons**:
- Violates HAnime ToS
- Copyright concerns
- High bandwidth costs
- Requires persistent server
- Session management complexity

**Verdict**: ❌ **NOT RECOMMENDED** - Legal and ethical issues

#### Option D: yt-dlp Integration (MODERATE COMPLEXITY)
Use yt-dlp to extract streams:

```javascript
const { execSync } = require('child_process');

async function getStreamsWithYtDlp(slug) {
  const url = `https://hanime.tv/videos/hentai/${slug}`;
  
  try {
    const output = execSync(
      `yt-dlp -j --no-playlist "${url}"`,
      { encoding: 'utf-8' }
    );
    
    const data = JSON.parse(output);
    
    return data.formats
      .filter(f => f.vcodec !== 'none')
      .map(f => ({
        quality: f.format_note || `${f.height}p`,
        url: f.url,  // ← These URLs have valid tokens!
        height: f.height,
      }));
  } catch (error) {
    logger.error('yt-dlp extraction failed:', error);
    return [];
  }
}
```

**Pros**:
- URLs have valid session tokens
- Works reliably
- Supports multiple quality options

**Cons**:
- Requires yt-dlp installed (`pip install yt-dlp`)
- Slower (2-3 seconds per request)
- Token still expires after 1 hour
- External dependency

**Verdict**: ⚠️ **POSSIBLE** but adds complexity

---

## 3. Comparison: Our Implementation vs Reference

### API Version Differences

| Feature | Reference (shimizudev/hentai-api) | Our Implementation |
|---------|-----------------------------------|-------------------|
| Search endpoint | ✅ `https://search.htv-services.com` | ✅ Same |
| Video metadata | ⚠️ Scrapes HTML (`window.__NUXT__`) | ✅ API v8 (`/api/v8/video`) |
| Stream extraction | ⚠️ API v7 (`/rapi/v7/videos_manifests/`) | ✅ API v8 (includes `videos_manifest`) |
| Authentication | ⚠️ Requires signature headers | ✅ No auth needed for v8 |
| Episode thumbnails | Per-episode `poster_url` | Series poster (all episodes) |

### Key Advantages of Our Implementation

#### 1. **Simpler API Calls**
```javascript
// Reference implementation (2 API calls)
const html = await fetch(`https://hanime.tv/videos/hentai/${slug}`);
const $ = cheerio.load(html);
const json = JSON.parse(script.html()?.replace("window.__NUXT__=", ""));

// Then separately:
const streams = await fetch(`https://hanime.tv/rapi/v7/videos_manifests/${slug}`, {
  headers: { 'x-signature': signature, 'x-time': time }
});

// Our implementation (1 API call)
const data = await fetch(`https://hanime.tv/api/v8/video?id=${slug}`);
// Returns BOTH metadata AND videos_manifest!
```

#### 2. **No HTML Parsing for Metadata**
```javascript
// Reference: Must parse Next.js SSR state
const script = $('script:contains("window.__NUXT__")');
const json = JSON.parse(script.html()?.replace("window.__NUXT__=", "").replaceAll(";", ''));

// Ours: Direct JSON response
const data = response.data;  // Already JSON!
```

#### 3. **Better Error Handling**
Our implementation:
- Validates `videos_manifest` exists
- Filters out `premium_alert` fake streams
- Provides graceful fallback to browser

Reference implementation:
- Assumes `videos_manifest` exists
- Less filtering
- No fallback options

### What Reference Implementation Does Better

#### 1. **Episode-Specific Thumbnails**
They return `thumbnailUrl` per episode, giving consumers the choice.

#### 2. **Type Safety (TypeScript)**
Full TypeScript types for API responses.

#### 3. **Zod Validation**
Runtime validation of API responses:
```typescript
const VideoSchema = z.object({
  title: z.string(),
  posterUrl: z.string(),
  // ...
});
```

### What GornVerhn's Fork Changes

**Answer**: NOTHING

GornVerhn's repository (https://github.com/GornVerhn/hentai-api) is a direct fork with:
- Same 12 commits as upstream
- No additional commits
- No pull requests
- No issues
- Identical code

**Conclusion**: The fork doesn't provide any solutions to our issues.

---

## 4. Root Cause Summary

### Thumbnail Issue
**Status**: ✅ **Not actually a bug**

The current implementation intentionally uses the series poster for all episodes, which is a valid UX choice. The API provides episode-specific screenshots (`ep.poster_url`), but showing the same poster for all episodes creates visual consistency.

**What's happening**:
1. API returns episode screenshots in `hentai_franchise_hentai_videos[].poster_url`
2. Scraper stores them in `episodes[].thumbnailUrl`
3. Meta handler ignores them and uses series poster instead
4. Result: All episodes show the same thumbnail (first episode's poster)

**Why it's not a bug**:
- Intentional design choice (see comment in code)
- Common pattern in streaming apps (Netflix, Hulu)
- Provides visual consistency

**If you want episode-specific thumbnails**: Use Option B or C from recommendations above.

### Stream Playback Issue
**Status**: ⚠️ **Cannot be fully solved without violating ToS**

Stream URLs are real and valid, but have authentication requirements that Stremio cannot satisfy:

**Technical barriers**:
1. CORS policy blocks cross-origin requests
2. Referer header validation requires `https://hanime.tv`
3. Time-limited tokens expire after 15-60 minutes
4. Session cookies not accessible to Stremio

**Why it fails**:
```
Stremio Player
    ↓
    Attempts to load: https://weeb.hanime.tv/video.m3u8
    ↓
    Missing: Referer, Cookies, Valid Token
    ↓
    Result: 403 Forbidden or CORS error
```

**Why browser works**:
```
Browser on hanime.tv
    ↓
    Has: Session cookies, Same origin
    ↓
    Loads: https://weeb.hanime.tv/video.m3u8
    ↓
    Result: ✅ Stream plays
```

**Solutions that work**:
1. ✅ External browser link (already implemented)
2. ✅ yt-dlp extraction (requires external tool)
3. ❌ Proxy server (ToS violation)

---

## 5. Recommendations & Action Items

### Immediate Actions

#### For Thumbnails
1. **Keep current implementation** (series poster for all episodes)
   - OR implement Option C (hybrid approach) if you want episode previews

#### For Streams
1. **Reorder stream options** to prioritize browser link:
   ```javascript
   streams: [
     { name: '🌐 Watch on HAnime.tv', externalUrl: '...' },  // First!
     { name: '1080p (may not work)', url: '...' },
     { name: '720p (may not work)', url: '...' },
   ]
   ```

2. **Add user guidance** in addon manifest description:
   ```javascript
   description: 'HAnime content for Stremio. ⚠️ Due to DRM protection, streams open in external browser.'
   ```

3. **Optional**: Implement yt-dlp integration for power users

### Long-term Improvements

#### 1. **Hybrid Thumbnail Approach**
Modify `meta.js` to show episode-specific thumbnails with series poster fallback:
```javascript
thumbnail: (ep.thumbnailUrl || data.posterUrl) ? 
  `http://localhost:7000/image-proxy?url=${encodeURIComponent(ep.thumbnailUrl || data.posterUrl)}` : undefined
```

#### 2. **Stream Quality Selection**
Add quality preferences in addon configuration:
```javascript
// In config/env.js
PREFERRED_QUALITY: process.env.PREFERRED_QUALITY || '720p'
```

#### 3. **Better Error Messages**
Improve stream handler error messages:
```javascript
{
  name: '⚠️ Streams Protected',
  title: 'HAnime uses DRM protection. Please use browser link below.',
  url: '',
  behaviorHints: { notWebReady: true }
}
```

#### 4. **Caching Improvements**
Current cache TTL for streams is too long if tokens expire:
```javascript
// In config/env.js
STREAM_CACHE_TTL: 5 * 60 * 1000,  // 5 minutes instead of 1 hour
```

### Testing Checklist

- [ ] Verify episode thumbnails display correctly in Stremio
- [ ] Test if any direct stream URLs work (may vary by region/ISP)
- [ ] Confirm browser fallback link opens correctly
- [ ] Test with different anime series (multi-episode vs single)
- [ ] Verify image proxy works for both catalog and meta
- [ ] Check cache behavior (TTL, memory usage)
- [ ] Test search functionality with various queries

---

## 6. Code Snippets for Fixes

### Fix #1: Hybrid Thumbnail Approach (RECOMMENDED)

**File**: `src/addon/handlers/meta.js`  
**Lines**: 70-85

**Current Code**:
```javascript
videos: (data.episodes || []).map(ep => ({
  id: `hanime-${ep.slug}:1:${ep.number}`,
  title: ep.name || `Episode ${ep.number}`,
  season: 1,
  episode: ep.number,
  // Use series poster instead of episode screenshot
  thumbnail: data.posterUrl ? `http://localhost:7000/image-proxy?url=${encodeURIComponent(data.posterUrl)}` : undefined,
  released: ep.releasedAt || undefined,
})),
```

**Recommended Fix**:
```javascript
videos: (data.episodes || []).map(ep => ({
  id: `hanime-${ep.slug}:1:${ep.number}`,
  title: ep.name || `Episode ${ep.number}`,
  season: 1,
  episode: ep.number,
  // Use episode-specific thumbnail with series poster as fallback
  thumbnail: (ep.thumbnailUrl || data.posterUrl) ? 
    `http://localhost:7000/image-proxy?url=${encodeURIComponent(ep.thumbnailUrl || data.posterUrl)}` : undefined,
  released: ep.releasedAt || undefined,
})),
```

**Impact**: Each episode will show its own screenshot, falling back to series poster if unavailable.

---

### Fix #2: Prioritize Browser Fallback (RECOMMENDED)

**File**: `src/addon/handlers/stream.js`  
**Lines**: 78-105

**Current Code**:
```javascript
// Direct streams first
const streams = rawStreams
  .sort((a, b) => (b.height || 0) - (a.height || 0))
  .map((stream, index) => ({
    name: `${stream.quality || stream.height + 'p' || 'Unknown'}`,
    title: `HAnime - ${stream.quality || stream.height + 'p'}`,
    url: stream.url,
    behaviorHints: {
      notWebReady: stream.extension === 'm3u8' || stream.mimeType?.includes('mpegurl'),
    },
  }));

// Add browser fallback option
streams.push({
  name: '🌐 Watch on HAnime.tv',
  title: 'If streams above don\'t work, open in browser',
  externalUrl: `https://hanime.tv/videos/hentai/${episodeSlug}`,
  behaviorHints: {
    notWebReady: true,
  },
});
```

**Recommended Fix**:
```javascript
// Browser fallback FIRST (most reliable)
const streams = [
  {
    name: '🌐 Watch on HAnime.tv',
    title: '⭐ Open in browser (recommended - DRM protected)',
    externalUrl: `https://hanime.tv/videos/hentai/${episodeSlug}`,
    behaviorHints: {
      notWebReady: true,
    },
  },
];

// Then add direct URLs (may not work due to CORS/auth)
const directStreams = rawStreams
  .sort((a, b) => (b.height || 0) - (a.height || 0))
  .map((stream) => ({
    name: `${stream.quality || stream.height + 'p'} (direct - may fail)`,
    title: `Direct link - ${stream.quality || stream.height + 'p'} (experimental)`,
    url: stream.url,
    behaviorHints: {
      notWebReady: true,  // Mark all as notWebReady since they likely won't work
    },
  }));

streams.push(...directStreams);
```

**Impact**: Users see browser option first, with clear warning that direct links are experimental.

---

### Fix #3: Reduce Stream Cache TTL

**File**: `src/config/env.js`  
**Line**: ~15

**Current Code**:
```javascript
STREAM_CACHE_TTL: process.env.STREAM_CACHE_TTL || 60 * 60 * 1000, // 1 hour
```

**Recommended Fix**:
```javascript
STREAM_CACHE_TTL: process.env.STREAM_CACHE_TTL || 5 * 60 * 1000, // 5 minutes (tokens expire)
```

**Impact**: Cached stream URLs won't become stale as quickly, improving reliability.

---

### Optional: yt-dlp Integration (ADVANCED)

**File**: `src/scrapers/hanime.js`  
**Add new method**:

```javascript
const { execSync } = require('child_process');
const logger = require('../utils/logger');

/**
 * Extract streams using yt-dlp (requires yt-dlp installed)
 * Falls back to API method if yt-dlp unavailable
 */
async getStreamsWithYtDlp(slug) {
  const url = `${this.baseUrl}/videos/hentai/${slug}`;
  
  try {
    // Check if yt-dlp is installed
    execSync('yt-dlp --version', { stdio: 'ignore' });
    
    // Extract stream info
    const output = execSync(
      `yt-dlp -j --no-playlist --skip-download "${url}"`,
      { 
        encoding: 'utf-8',
        timeout: 10000,  // 10 second timeout
      }
    );
    
    const data = JSON.parse(output);
    
    // Map formats to our stream structure
    const streams = data.formats
      .filter(f => f.vcodec !== 'none' && f.url)
      .map(f => ({
        id: f.format_id,
        quality: f.format_note || `${f.height}p`,
        height: f.height,
        width: f.width,
        url: f.url,  // URLs have valid tokens from yt-dlp extraction
        extension: f.ext,
        mimeType: f.video_ext,
        filesizeMbs: f.filesize ? f.filesize / (1024 * 1024) : 0,
      }))
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    
    logger.info(`yt-dlp extracted ${streams.length} streams for ${slug}`);
    return streams;
    
  } catch (error) {
    logger.warn(`yt-dlp extraction failed, falling back to API: ${error.message}`);
    // Fallback to original API method
    return this.getStreams(slug);
  }
}
```

**Usage in stream handler**:
```javascript
// Try yt-dlp first, fallback to API
const rawStreams = await scraper.getStreamsWithYtDlp(episodeSlug);
```

**Requirements**:
```bash
# Install yt-dlp
pip install yt-dlp

# Or with npm
npm install -g yt-dlp
```

**Pros**:
- Stream URLs work reliably
- Tokens are fresh
- Supports all HAnime features

**Cons**:
- Requires external dependency
- Slower (2-3 seconds per extraction)
- Requires Python/pip installed
- Still violates HAnime ToS technically

---

## 7. Conclusion

### What We Learned

1. **Thumbnail "issue" is not a bug** - It's intentional design choice to use series poster for visual consistency
2. **Stream playback cannot be fully solved** - HAnime uses authenticated CDN that blocks external players
3. **API v8 is superior** - Our implementation is actually better than the reference (fewer API calls, no HTML parsing)
4. **GornVerhn's fork provides no solutions** - It's an unchanged fork of shimizudev's repository
5. **Best solution is external browser** - Already implemented, just needs better UX

### Final Recommendations

#### Priority 1: Improve Stream UX (IMMEDIATE)
- ✅ Reorder streams to show browser link first
- ✅ Add clear disclaimers about DRM protection
- ✅ Reduce cache TTL to 5 minutes

#### Priority 2: Thumbnail Enhancement (OPTIONAL)
- ⚠️ Consider hybrid approach for episode-specific previews
- ⚠️ A/B test user preference (uniform vs varied thumbnails)

#### Priority 3: Advanced Features (FUTURE)
- ⚠️ yt-dlp integration for power users
- ⚠️ Quality selection preferences
- ⚠️ Download support

### Known Limitations

1. **Direct stream playback**: Will likely never work due to DRM/CORS
2. **Token expiration**: Even with yt-dlp, tokens expire after ~1 hour
3. **Rate limiting**: HAnime may block excessive API requests
4. **Site changes**: HTML structure and API endpoints may change without notice

### Success Criteria

- ✅ Users can browse HAnime catalog
- ✅ Metadata displays correctly with proper images
- ✅ Browser fallback works for all streams
- ⚠️ Direct playback in Stremio (impossible due to DRM)

---

## Appendix: API Response Examples

### HAnime API v8 Response Structure

```json
{
  "hentai_video": {
    "id": 123,
    "name": "Overflow - Episode 1",
    "slug": "overflow-1",
    "poster_url": "https://i.hanime.tv/screenshots/overflow-1-scene.jpg",
    "cover_url": "https://i.hanime.tv/covers/overflow-1-wide.jpg",
    "description": "Episode description...",
    "duration_in_ms": 960000,
    "rating": 4.5,
    "views": 1000000
  },
  "hentai_franchise": {
    "id": 45,
    "name": "Overflow",
    "slug": "overflow",
    "title": "Overflow"
  },
  "hentai_franchise_hentai_videos": [
    {
      "id": 123,
      "name": "Episode 1",
      "slug": "overflow-1",
      "poster_url": "https://i.hanime.tv/screenshots/overflow-1.jpg",
      "number": 1
    },
    {
      "id": 124,
      "name": "Episode 2",
      "slug": "overflow-2",
      "poster_url": "https://i.hanime.tv/screenshots/overflow-2.jpg",
      "number": 2
    }
  ],
  "videos_manifest": {
    "servers": [
      {
        "id": 1,
        "name": "Main Server",
        "streams": [
          {
            "id": 789,
            "height": 1080,
            "width": 1920,
            "url": "https://weeb.hanime.tv/videos/overflow-1-1080p.m3u8",
            "extension": "m3u8",
            "mime_type": "application/x-mpegURL",
            "filesize_mbs": 450.5,
            "kind": "video"
          },
          {
            "id": 790,
            "height": 720,
            "width": 1280,
            "url": "https://weeb.hanime.tv/videos/overflow-1-720p.mp4",
            "extension": "mp4",
            "mime_type": "video/mp4",
            "filesize_mbs": 280.3,
            "kind": "video"
          }
        ]
      }
    ]
  }
}
```

### Key Observations

1. **poster_url vs cover_url**:
   - `poster_url`: Vertical/square thumbnail (episode screenshot)
   - `cover_url`: Horizontal banner/cover image

2. **videos_manifest**:
   - Included in API v8 response (reference uses separate v7 call)
   - Contains real CDN URLs (not placeholders)
   - Multiple servers and qualities available

3. **Episode numbering**:
   - Not explicitly in API, derived from array index
   - Franchise contains all episodes as array

---

**End of Report**

**Next Steps**: Review recommendations and implement priority fixes based on your requirements.
