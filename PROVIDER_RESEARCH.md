# Alternative Provider Research for Stremio Addon

## Executive Summary

HAnime.tv streams are DRM-protected with CORS restrictions, making direct playback impossible without browser fallback. This research evaluates alternative providers that offer **direct stream URLs** compatible with Stremio.

## Problem with HAnime

- ✅ **Metadata**: Clean API v8 endpoint works perfectly
- ✅ **Images**: CDN protection solved with proxy
- ❌ **Streams**: DRM-protected, CORS-restricted, require authentication
- ⚠️ **Browser Fallback**: Works but defeats "everything in Stremio" goal

## Alternative Provider Options

### Option 1: yt-dlp Integration (RECOMMENDED)

**Why yt-dlp?**
- Battle-tested video downloader with 1800+ supported sites
- **Plugin system** for extending support
- Active community maintains extractors
- Already has **HAnime plugin** available: https://github.com/cynthia2006/hanime-plugin

**Supported Adult Content Sites in yt-dlp:**
- PornHub / Thumbzilla (built-in)
- XNXX, XVideos (built-in)
- YouPorn (built-in)
- RedTube (built-in)
- XHamster (built-in)
- **HAnime** (via plugin)
- Many more adult sites with direct stream support

**Implementation Approach:**
```javascript
// Use yt-dlp as subprocess to extract stream URLs
const { exec } = require('child_process');

async function getStreamsWithYtDlp(url) {
  return new Promise((resolve, reject) => {
    exec(`yt-dlp -J "${url}"`, (error, stdout) => {
      if (error) reject(error);
      const data = JSON.parse(stdout);
      
      // Extract available formats
      const streams = data.formats
        .filter(f => f.vcodec !== 'none' && f.url)
        .map(f => ({
          url: f.url,
          quality: `${f.height}p`,
          name: `${f.height}p - ${f.ext}`,
        }));
      
      resolve(streams);
    });
  });
}
```

**Pros:**
- ✅ Handles authentication, CORS, DRM automatically
- ✅ Supports hundreds of sites out of the box
- ✅ Active maintenance and updates
- ✅ Plugin system for custom sites
- ✅ Returns direct stream URLs

**Cons:**
- ❌ External dependency (yt-dlp binary required)
- ❌ Slower than direct API calls
- ❌ May break if site changes (but community fixes quickly)

### Option 2: HentaiMama.io

**Current Status:** WordPress-based site with embedded players

**Investigation Results:**
- Uses embedded video players (not direct URLs visible)
- Likely uses Blogger/Google Drive or similar CDN
- Would require deep scraping to extract actual stream URLs
- **Stream protection unknown** - needs testing

**Assessment:** ⚠️ **Medium Effort, Unknown Success Rate**

Needs browser automation (Puppeteer) to:
1. Navigate to episode page
2. Wait for player to load
3. Extract stream URL from network requests
4. Test if URL works without session/cookies

### Option 3: Specialized Adult Anime Sites

**Candidates to Research:**

1. **WonderfulHentai** (wonderfulhentai.com)
   - Status: Unknown stream protection
   - Assessment: Needs investigation

2. **HentaiStream** (various domains)
   - Status: Many clone sites exist
   - Assessment: Quality varies

3. **Anitube variants**
   - Status: Multiple domains, protection varies
   - Assessment: Unstable

**Common Issues:**
- Most use anti-scraping protection
- Many require Cloudflare bypass
- Stream URLs often expire quickly
- Sites frequently change domains

### Option 4: Public Scrapers

**Available Resources:**

1. **get-sauce** (Go): https://github.com/gan-of-culture/get-sauce
   - Multi-site hentai video downloader
   - Supports: Multiple providers
   - Last updated: 5 days ago
   - Language: Go (would need to port or integrate)

2. **nsfw-api2** (TypeScript): https://github.com/Swag666baby/nsfw-api2
   - API for searching +18 sites
   - Active development
   - Could provide provider URLs

3. **PacaHub** (JavaScript): https://github.com/raisulrahat1/PacaHub
   - Multi-source anime/hentai API
   - Includes scraping logic
   - Could adapt for Stremio

## Recommended Solution

### Phase 1: yt-dlp Integration

**Implementation Plan:**

1. **Install yt-dlp dependency**
   ```json
   {
     "dependencies": {
       "yt-dlp-wrap": "^2.3.8"
     }
   }
   ```

2. **Create yt-dlp scraper** (`src/scrapers/ytdlp.js`)
   - Base class wrapper around yt-dlp
   - Extract metadata and streams
   - Support for multiple sites

3. **Add HAnime plugin support**
   - Install: https://github.com/cynthia2006/hanime-plugin
   - Configure yt-dlp to use plugin directory

4. **Update manifest to support multiple providers**
   ```javascript
   catalogs: [
     { id: 'ytdlp-hanime', name: 'HAnime (yt-dlp)', type: 'series' },
     { id: 'ytdlp-pornhub', name: 'Adult Anime (PH)', type: 'series' },
     // etc
   ]
   ```

**Benefits:**
- ✅ Immediate solution for HAnime stream issue
- ✅ Extensible to other sites
- ✅ Community-maintained extractors
- ✅ Direct stream URLs work in Stremio

### Phase 2: Add Alternative Native Scrapers

Once yt-dlp proves the concept, implement native scrapers for:

1. **Sites with clean APIs** (like HAnime metadata)
2. **Sites with direct m3u8/mp4 URLs**
3. **Sites without heavy protection**

Use yt-dlp as fallback for problematic sites.

## Testing Plan

### Test yt-dlp with HAnime

```bash
# Install yt-dlp + hanime plugin
npm install yt-dlp-wrap

# Download plugin
git clone https://github.com/cynthia2006/hanime-plugin.git

# Test extraction
yt-dlp --plugins hanime-plugin/yt-dlp-plugins/extractor/ -J "https://hanime.tv/videos/hentai/overflow-1"
```

Expected output:
- JSON with metadata
- List of formats with direct URLs
- Quality options (360p, 480p, 720p, 1080p)

### Test in Stremio

1. Update stream handler to use yt-dlp
2. Test video playback in Stremio
3. Verify quality selection works
4. Check if streams play without buffering

## Migration Strategy

### Current Architecture
```
User → Stremio → Our Addon → HAnime API v8 → DRM URLs ❌
```

### Proposed Architecture
```
User → Stremio → Our Addon → yt-dlp → HAnime → Direct URLs ✅
                          ├→ yt-dlp → PornHub → Direct URLs ✅
                          └→ yt-dlp → Other Sites → Direct URLs ✅
```

### Code Changes Required

**1. New Scraper: `src/scrapers/ytdlp.js`**
```javascript
const YTDlpWrap = require('yt-dlp-wrap').default;

class YtDlpScraper extends BaseScraper {
  constructor(pluginPath) {
    super('ytdlp');
    this.ytdlp = new YTDlpWrap();
    this.ytdlp.setUserAgent('Mozilla/5.0...');
    
    if (pluginPath) {
      this.ytdlp.setPluginPath(pluginPath);
    }
  }

  async getStreams(url) {
    const info = await this.ytdlp.getVideoInfo(url);
    
    return info.formats
      .filter(f => f.vcodec !== 'none' && f.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0))
      .map(f => ({
        url: f.url,
        name: `${f.height}p - ${f.protocol}`,
        quality: `${f.height}p`,
      }));
  }
}
```

**2. Update Stream Handler**
```javascript
// Instead of scraper.getStreams()
const videoUrl = `https://hanime.tv/videos/hentai/${episodeSlug}`;
const streams = await ytdlpScraper.getStreams(videoUrl);
```

**3. Keep Metadata from API v8**
- Catalog still uses HAnime API v8 (fast, clean)
- Meta still uses HAnime API v8 (franchise info)
- Only streams use yt-dlp (when needed)

## Decision Matrix

| Provider         | Stream Quality | Direct URLs | Stremio Compatible | Effort | Stability |
|------------------|----------------|-------------|-------------------|--------|-----------|
| HAnime (current) | ⭐⭐⭐⭐⭐          | ❌          | ❌ (browser only)  | ✅ Done | ⭐⭐⭐⭐⭐        |
| yt-dlp + HAnime  | ⭐⭐⭐⭐⭐          | ✅          | ✅                 | ⭐⭐⭐      | ⭐⭐⭐⭐         |
| HentaiMama       | ⭐⭐⭐⭐           | ❓          | ❓                 | ⭐⭐⭐⭐     | ⭐⭐⭐          |
| PornHub (anime)  | ⭐⭐⭐            | ✅          | ✅                 | ⭐⭐       | ⭐⭐⭐⭐⭐        |
| XVideos (anime)  | ⭐⭐⭐            | ✅          | ✅                 | ⭐⭐       | ⭐⭐⭐⭐⭐        |

**Legend:**
- ⭐⭐⭐⭐⭐ = Excellent
- ⭐⭐⭐⭐ = Good
- ⭐⭐⭐ = Average
- ⭐⭐ = Below Average
- ❓ = Unknown

## Recommendation

### Immediate Action: Implement yt-dlp Integration

**Reasoning:**
1. ✅ Solves HAnime stream issue immediately
2. ✅ Opens door to 1800+ sites
3. ✅ Community-maintained (less work for us)
4. ✅ Direct URLs work in Stremio
5. ✅ Can still use HAnime API v8 for metadata (fast)

**Trade-offs:**
- External dependency (yt-dlp binary)
- Slightly slower than direct API
- Need to handle yt-dlp updates

**Next Steps:**
1. Test yt-dlp with HAnime plugin locally
2. If successful, create new scraper
3. Update stream handler to use yt-dlp
4. Keep catalog/meta using API v8 (for speed)
5. Test in Stremio
6. Consider adding other providers (PornHub, XVideos for variety)

### Alternative: Pivot to Multi-Site Aggregator

If yt-dlp works well, consider pivoting the entire addon:

**New Vision: "Adult Anime Aggregator"**
- Multiple providers (HAnime, PornHub, XVideos, etc.)
- Unified search across all
- yt-dlp handles all stream extraction
- Best quality from all sources

**Catalogs:**
- "All Adult Anime" (combined from all)
- "HAnime Exclusives" (HAnime only)
- "Community Uploads" (PornHub/XVideos)
- "Uncensored" (filter for uncensored)

## Questions to Resolve

1. **Performance**: Is yt-dlp fast enough for Stremio?
   - Test: Extract streams from 10 episodes, measure time
   - Acceptable: <5s per request
   - Solution if slow: Cache stream URLs aggressively

2. **Binary deployment**: How to ship yt-dlp with addon?
   - Option A: Require user to install yt-dlp globally
   - Option B: Bundle yt-dlp binary (larger docker image)
   - Option C: Use yt-dlp as a service (separate container)

3. **Plugin management**: How to keep HAnime plugin updated?
   - Option A: Git submodule
   - Option B: Download on startup
   - Option C: Bundle in repo

4. **License**: yt-dlp is Unlicense, compatible with our project
   - ✅ No licensing issues

## Conclusion

**Recommendation: Switch to yt-dlp-based approach**

This solves the core issue (DRM streams) while opening possibilities for:
- Multiple providers
- Community-maintained extractors
- Direct URLs that work in Stremio
- Less maintenance burden on us

The metadata extraction from HAnime API v8 was successful and can be retained for catalog/meta, using yt-dlp only for stream URLs where needed.
