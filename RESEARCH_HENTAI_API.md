# HentaiAPI Repository Research Summary

**Repository**: shimizudev/hentai-api  
**Date**: November 27, 2025  
**Purpose**: Understanding scraper architecture for porting to self-contained Stremio addon

---

## 1. Repository Structure

```
hentai-api/
├── src/
│   ├── index.ts              # Main entry point (Hono server setup)
│   ├── providers/            # Scraper implementations
│   │   ├── hanime.ts
│   │   ├── hentai-haven.ts
│   │   └── rule34.ts
│   ├── helpers/              # Utility functions
│   │   ├── crypto.ts         # ROT13 cipher, HMAC tokens
│   │   └── dimension.ts      # Aspect ratio calculations
│   ├── schema/               # Zod validation schemas
│   │   ├── hanime.ts
│   │   ├── hentai-haven.ts
│   │   └── r34.ts
│   └── types/                # TypeScript type definitions
│       ├── hanime.ts
│       └── r34.ts
├── package.json
├── tsconfig.json
└── Dockerfile
```

---

## 2. Dependencies (package.json)

### Production Dependencies
```json
{
  "cheerio": "^1.0.0",        // HTML parsing (like jQuery for Node)
  "hono": "^4.6.16",          // Web framework (lightweight Express alternative)
  "ioredis": "^5.4.2",        // Redis client (REQUIRED for caching)
  "luxon": "^3.5.0",          // Date/time manipulation
  "mongodb": "^6.12.0",       // MongoDB client (OPTIONAL - only for API keys)
  "zod": "^3.24.1"            // Schema validation
}
```

### Dev Dependencies
```json
{
  "@types/bun": "latest",
  "@types/luxon": "^3.4.2",
  "typescript": "^5.0.0"
}
```

### Key Observations
- **No Puppeteer/Playwright**: Uses simple HTTP requests + Cheerio (static HTML scraping)
- **No Axios**: Uses native `fetch()` API
- **Bun Runtime**: Designed for Bun, but code is compatible with Node.js

---

## 3. Redis Usage Analysis

### Current Implementation (src/index.ts)
```typescript
// REDIS IS REQUIRED - App exits if not configured
const redis = new Redis({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

// Two main uses:
// 1. Rate limiting
const rateLimit = async (c, key, limit, ttl) => {
  const count = await redis.incr(key);
  if (count > limit) return c.json({ error: "Rate limit exceeded" }, 429);
  await redis.expire(key, ttl);
};

// 2. Response caching (1 hour TTL)
const cache = async (c, key, fetcher) => {
  const cached = await redis.get(key);
  if (cached) return c.json(JSON.parse(cached));
  const data = await fetcher();
  await redis.set(key, JSON.stringify(data), 'EX', 3600);
  return c.json(data);
};
```

### Can We Eliminate Redis?
**YES - For our use case**
- **Rate limiting**: Not needed for single-user Stremio addon
- **Caching**: Can use simple in-memory LRU cache (like we have in `src/cache/lru.js`)
- **Distributed cache**: Not needed - each user runs their own addon instance

---

## 4. MongoDB Usage Analysis

### Current Implementation
```typescript
const mongoClient = process.env.MONGODB_URL 
  ? new MongoClient(process.env.MONGODB_URL) 
  : undefined;

// ONLY used for API key authentication
const apiKeyAuth = async (c) => {
  const apiKey = c.req.header("x-api-key");
  if (!apiKey) return undefined;
  const key = await apiKeyCollection?.findOne({ key: apiKey });
  if (!key) return c.json({ error: "Invalid API key" }, 401);
};
```

### Can We Eliminate MongoDB?
**YES - It's already optional**
- MongoDB is only used for API key management
- For self-contained addon: No authentication needed
- README states: `MONGODB_URL=mongodb://localhost:27017/hentai-api # Not required`

---

## 5. HAnime Scraper Deep Dive

### Architecture
**Direct API Access** - HAnime exposes internal APIs that the website uses

### Key Endpoints
```typescript
private readonly BASE_URL = "https://hanime.tv";
private readonly SEARCH_URL = "https://search.htv-services.com";
```

### Search Implementation
```typescript
public async search(query: string, page = 1, perPage = 10) {
  const response = await fetch("https://search.htv-services.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blacklist: [],
      brands: [],
      order_by: "created_at_unix",
      page: page - 1,
      tags: [],
      search_text: query,
      tags_mode: "AND",
    }),
  });
  
  const data = await response.json();
  const allResults = JSON.parse(data.hits).map(mapToSearchResult);
  // Pagination handled in-memory
  return {
    pages: Math.ceil(data.nbHits / perPage),
    total: data.nbHits,
    results: allResults.slice(startIndex, endIndex),
  };
}
```

### Video Info Extraction
```typescript
public async getInfo(slug: string) {
  const url = `https://hanime.tv/videos/hentai/${slug}`;
  const response = await fetch(url);
  const html = await response.text();
  const $ = load(html);
  
  // CRITICAL: Extract Next.js state from HTML
  const script = $('script:contains("window.__NUXT__")');
  const json = JSON.parse(
    script.html()
      ?.replace("window.__NUXT__=", "")
      .replaceAll(";", '')
  );
  
  const videoData = json.state.data.video;
  return {
    title: videoData.hentai_franchise.name,
    id: videoData.hentai_video.id,
    description: videoData.hentai_video.description,
    posterUrl: videoData.hentai_video.poster_url,
    tags: videoData.hentai_tags,
    episodes: {
      next: mapToEpisode(videoData.next_hentai_video),
      all: json.state.data.video.hentai_franchise_hentai_videos.map(mapToEpisode),
    }
  };
}
```

### Stream URL Extraction (Most Complex Part)
```typescript
public async getEpisode(slug: string) {
  const apiUrl = `https://hanime.tv/rapi/v7/videos_manifests/${slug}`;
  
  // Generate random signature for API authentication
  const signature = Array.from({ length: 32 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  
  const response = await fetch(apiUrl, {
    headers: {
      'x-signature': signature,
      'x-time': Math.floor(Date.now() / 1000).toString(),
      'x-signature-version': 'web2',
    }
  });
  
  const json = await response.json();
  const data = json.videos_manifest;
  
  // Extract all streams from all servers
  const videos = data.servers.map(server => server.streams).flat();
  
  return videos
    .map((video) => ({
      width: video.width,
      height: video.height,
      url: video.url,
      filesizeMbs: video.filesize_mbs,
    }))
    .filter(video => video.url && video.kind !== 'premium_alert');
}
```

### Key Takeaways for HAnime
1. **No Cheerio needed for search** - Direct API calls
2. **Cheerio only for video page** - Extract `window.__NUXT__` state
3. **Stream API authentication** - Simple random signature + timestamp
4. **Multiple quality streams** - Returns array with different resolutions

---

## 6. HentaiHaven Scraper Deep Dive

### Architecture
**Full HTML Scraping** - No API access, must parse WordPress HTML

### Base URL
```typescript
private baseUrl: string = "http://hentaihaven.xxx";
```

### Search Implementation
```typescript
public async fetchSearchResult(query: string): Promise<SearchResult[]> {
  const url = `${this.baseUrl}/?s=${query}&post_type=wp-manga`;
  const response = await fetch(url);
  const data = await response.text();
  const $ = load(data);
  
  const results: SearchResult[] = [];
  
  $(".c-tabs-item__content").each((i, el) => {
    const cover = $(el).find(".c-image-hover img").attr("src");
    const id = $(el).find(".c-image-hover a").attr("href")?.split("/")[4];
    const title = $(el).find(".post-title h3").text().trim();
    const alternative = $(el).find(".mg_alternative .summary-content").text().trim();
    const released = Number($(el).find(".mg_release .summary-content").text().trim());
    const totalEpisodes = getNumberFromString(
      $(el).find(".latest-chap .chapter").text().trim()
    );
    
    // Date parsing with Luxon
    const dateString = $(el).find(".post-on").text().trim();
    const parsedDate = DateTime.fromFormat(dateString, "yyyy-MM-dd HH:mm:ss", {
      zone: 'utc'
    });
    
    const rating = Number($(el).find(".total_votes").text().trim());
    
    // Extract genres
    const genres: Genre[] = [];
    $(".mg_genres .summary-content a").each((_, element) => {
      genres.push({
        id: $(element).attr("href")?.split("/")[4],
        url: $(element).attr("href"),
        name: $(element).text().trim().replaceAll(",", ""),
      });
    });
    
    results.push({ id, title, cover, rating, released, genres, totalEpisodes });
  });
  
  return results;
}
```

### Video Info Extraction
```typescript
public async fetchInfo(id: string, episodesSort: EpisodesSort = "ASC") {
  const url = `${this.baseUrl}/watch/${id}`;
  const response = await fetch(url);
  const data = await response.text();
  const $ = load(data);
  
  const title = $(".post-title h1").text().trim();
  const cover = $(".summary_image img").attr("src");
  const ratingCount = Number($('span[property="ratingCount"]').text().trim());
  const views = getNumberFromString($(".post-content_item:nth-child(4) .summary-content").text());
  const summary = $(".description-summary p").text().trim();
  
  // Extract episodes (WordPress manga chapter structure)
  const episodes: HentaiEpisode[] = [];
  const episodesLength = $("li.wp-manga-chapter").length;
  
  $("li.wp-manga-chapter").each((i, el) => {
    const thumbnail = $(el).find("img").attr("src");
    const id = `${$(el).find("a").attr("href")?.split("/")[4]}/${
      $(el).find("a").attr("href")?.split("/")[5]
    }`;
    const title = $(el).find("a").text().trim();
    const number = episodesLength - i;
    const released = $(el).find(".chapter-release-date").text().trim();
    const releasedUTC = DateTime.fromFormat(released, "MMMM dd, yyyy", {zone: 'utc'});
    
    episodes.push({
      id: btoa(id),  // Base64 encode the path as ID
      title,
      thumbnail,
      number,
      releasedUTC,
    });
  });
  
  return { id, title, cover, summary, views, genres, episodes };
}
```

### Stream URL Extraction (Most Complex Part!)
```typescript
public async fetchSources(id?: string): Promise<HentaiSources> {
  // Step 1: Get the page HTML
  const pageUrl = `${this.baseUrl}/watch/${atob(id!)}`;  // Decode base64 ID
  const pageResponse = await fetch(pageUrl);
  const pageHtml = await pageResponse.text();
  const $page = load(pageHtml);
  
  // Step 2: Extract iframe source
  const iframeSrc = $page(".player_logic_item > iframe").attr("src");
  
  // Step 3: Fetch iframe content
  const iframeResponse = await fetch(iframeSrc);
  const iframeHtml = await iframeResponse.text();
  const $iframe = load(iframeHtml);
  
  // Step 4: Extract encrypted token from meta tag
  const secureToken = $iframe('meta[name="x-secure-token"]')
    .attr("content")
    ?.replace("sha512-", "");
  
  // Step 5: Decrypt token using ROT13 cipher (3 layers!)
  const rotatedSha = CryptoHelper.rot13Cipher(secureToken);
  const decryptedData = JSON.parse(
    atob(CryptoHelper.rot13Cipher(atob(CryptoHelper.rot13Cipher(atob(rotatedSha)))))
  ) as { en: string; iv: string; uri: string };
  
  // Step 6: POST to API with decrypted data
  const formData = new FormData();
  formData.append("action", "zarat_get_data_player_ajax");
  formData.append("a", decryptedData.en);
  formData.append("b", decryptedData.iv);
  
  const apiUrl = `${
    decryptedData.uri || "https://hentaihaven.xxx/wp-content/plugins/player-logic/"
  }api.php`;
  
  const apiResponse = await fetch(apiUrl, {
    method: "POST",
    body: formData,
    mode: "cors",
  });
  
  const json = await apiResponse.json();
  const sources = json.data.sources;
  const thumbnail = json.data.image;
  
  return { sources, thumbnail };
}
```

### Key Takeaways for HentaiHaven
1. **Heavy Cheerio usage** - WordPress HTML structure
2. **Complex decryption** - 3-layer ROT13 cipher for video tokens
3. **Multi-step process** - Page → Iframe → Decrypt → API call
4. **Luxon for dates** - Parse release dates (can replace with native Date)
5. **Base64 ID encoding** - Episode IDs are encoded paths

---

## 7. Helper Functions We Need

### crypto.ts - ROT13 Cipher
```typescript
export default class CryptoHelper {
  public static rot13Cipher(str: string): string {
    return str.replace(/[a-zA-Z]/g, (c) => {
      const charCode = c.charCodeAt(0);
      const isUpperCase = charCode >= 65 && charCode <= 90;
      const shiftedCharCode = isUpperCase
        ? ((charCode - 65 + 13) % 26) + 65
        : ((charCode - 97 + 13) % 26) + 97;
      return String.fromCharCode(shiftedCharCode);
    });
  }
}
```

**Usage**: HentaiHaven video decryption  
**Can we skip?**: No, absolutely required for HentaiHaven streams

### dimension.ts - Aspect Ratio
```typescript
export class Dimension {
  public getAspectRatio(): string {
    const gcd = this.gcd(this.width, this.height);
    return `${this.width / gcd}:${this.height / gcd}`;
  }
  
  private gcd(a: number, b: number): number {
    return b === 0 ? a : this.gcd(b, a % b);
  }
}
```

**Usage**: Not used in current scrapers  
**Can we skip?**: Yes

---

## 8. Data Flow Architecture

```
┌─────────────────────────────────────────────────────┐
│  Client Request                                     │
│  GET /api/hanime/search/:query                      │
└────────────────┬────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────┐
│  index.ts - handleRequest()                         │
│  1. Check API key (optional - MongoDB)              │
│  2. Rate limit check (Redis INCR)                   │
│  3. Cache check (Redis GET)                         │
└────────────────┬────────────────────────────────────┘
                 │
                 v (if cache miss)
┌─────────────────────────────────────────────────────┐
│  Provider (hanime.ts / hentai-haven.ts)             │
│  1. Fetch HTML/API                                  │
│  2. Parse with Cheerio or JSON.parse()              │
│  3. Transform to schema                             │
└────────────────┬────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────┐
│  Zod Schema Validation                              │
│  Ensures response matches expected structure        │
└────────────────┬────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────┐
│  Cache & Return                                     │
│  1. Redis SET (1 hour TTL)                          │
│  2. Return JSON response                            │
└─────────────────────────────────────────────────────┘
```

---

## 9. Porting Strategy for Stremio Addon

### What to Keep
✅ **Providers** (hanime.ts, hentai-haven.ts) - Core scraping logic  
✅ **crypto.ts** - ROT13 cipher for HentaiHaven  
✅ **Cheerio** - HTML parsing  
✅ **Native fetch()** - Already using it  

### What to Replace
🔄 **Hono → Express** - We already use Express in our addon  
🔄 **Redis → LRU Cache** - Simple in-memory cache (already implemented)  
🔄 **Luxon → Native Date** - Reduce dependencies  
🔄 **Zod validation → Simple checks** - Optional, Zod is nice but not critical  

### What to Remove
❌ **ioredis** - Not needed  
❌ **mongodb** - Not needed  
❌ **Rate limiting** - Not needed for single-user addon  
❌ **API key auth** - Not needed  

### Implementation Plan
```
1. Copy providers/hanime.ts → src/providers/hanime.js
   - Convert TypeScript to JavaScript
   - Remove Zod imports
   - Keep all scraping logic

2. Copy providers/hentai-haven.ts → src/providers/hentaihaven.js
   - Convert TypeScript to JavaScript
   - Replace Luxon with native Date
   - Keep ROT13 decryption

3. Copy helpers/crypto.ts → src/utils/crypto.js
   - Convert to CommonJS module
   - Keep rot13Cipher method

4. Update package.json
   - Add: cheerio: ^1.0.0
   - Remove: ioredis, mongodb, hono, luxon, zod

5. Integrate with existing addon
   - Use LRU cache from src/cache/lru.js
   - Wire up to Stremio handlers (catalog.js, stream.js)
   - Transform responses to Stremio format
```

---

## 10. Critical Code Snippets to Port

### HAnime Search (Simplest)
```javascript
async function searchHAnime(query) {
  const response = await fetch('https://search.htv-services.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blacklist: [],
      brands: [],
      order_by: 'created_at_unix',
      page: 0,
      tags: [],
      search_text: query,
      tags_mode: 'AND',
    }),
  });
  
  const data = await response.json();
  return JSON.parse(data.hits);
}
```

### HAnime Streams (Medium Complexity)
```javascript
async function getHAnimeStreams(slug) {
  const signature = Array.from({ length: 32 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  
  const response = await fetch(`https://hanime.tv/rapi/v7/videos_manifests/${slug}`, {
    headers: {
      'x-signature': signature,
      'x-time': Math.floor(Date.now() / 1000).toString(),
      'x-signature-version': 'web2',
    }
  });
  
  const json = await response.json();
  return json.videos_manifest.servers
    .map(server => server.streams)
    .flat()
    .filter(video => video.url && video.kind !== 'premium_alert');
}
```

### HentaiHaven Streams (Most Complex)
```javascript
const cheerio = require('cheerio');
const { rot13Cipher } = require('./crypto');

async function getHentaiHavenStreams(episodeId) {
  // 1. Decode base64 ID and fetch page
  const decodedId = Buffer.from(episodeId, 'base64').toString();
  const pageUrl = `http://hentaihaven.xxx/watch/${decodedId}`;
  const pageHtml = await (await fetch(pageUrl)).text();
  const $page = cheerio.load(pageHtml);
  
  // 2. Extract and fetch iframe
  const iframeSrc = $page('.player_logic_item > iframe').attr('src');
  const iframeHtml = await (await fetch(iframeSrc)).text();
  const $iframe = cheerio.load(iframeHtml);
  
  // 3. Decrypt token (3-layer ROT13)
  const secureToken = $iframe('meta[name="x-secure-token"]')
    .attr('content')
    ?.replace('sha512-', '');
  
  const rotatedSha = rot13Cipher(secureToken);
  const decryptedData = JSON.parse(
    Buffer.from(
      rot13Cipher(
        Buffer.from(
          rot13Cipher(
            Buffer.from(rotatedSha, 'base64').toString()
          ), 'base64'
        ).toString()
      )
    ).toString()
  );
  
  // 4. POST to API
  const formData = new FormData();
  formData.append('action', 'zarat_get_data_player_ajax');
  formData.append('a', decryptedData.en);
  formData.append('b', decryptedData.iv);
  
  const apiUrl = decryptedData.uri || 
    'https://hentaihaven.xxx/wp-content/plugins/player-logic/api.php';
  
  const apiResponse = await fetch(apiUrl, {
    method: 'POST',
    body: formData,
  });
  
  const json = await apiResponse.json();
  return json.data.sources;
}
```

---

## 11. Final Recommendations

### Immediate Actions
1. ✅ **Install Cheerio**: `npm install cheerio`
2. ✅ **Create crypto.js**: Port ROT13 cipher helper
3. ✅ **Port HAnime scraper**: Easiest, start here
4. ✅ **Port HentaiHaven scraper**: More complex, test thoroughly

### Testing Strategy
```javascript
// Test HAnime search
const results = await searchHAnime('overflow');
console.log(results[0].name); // Should show title

// Test HAnime streams
const streams = await getHAnimeStreams('overflow-episode-1');
console.log(streams[0].url); // Should show video URL

// Test HentaiHaven (more fragile, site changes often)
const hhStreams = await getHentaiHavenStreams(episodeId);
console.log(hhStreams[0].src); // Should show video URL
```

### Potential Issues
⚠️ **HentaiHaven fragility**: Site structure changes frequently, encryption may change  
⚠️ **CORS issues**: May need CORS proxy for some requests  
⚠️ **Rate limiting**: HAnime may block excessive requests  
⚠️ **URL changes**: Both sites have changed domains before  

### Success Metrics
- Can search HAnime and return results ✓
- Can get HAnime video streams ✓
- Can get HentaiHaven video streams ✓
- Cache works and reduces requests ✓
- Stremio displays catalogs correctly ✓
- Streams play in Stremio player ✓

---

## 12. Dependency Comparison

### hentai-api Current
```json
{
  "cheerio": "^1.0.0",
  "hono": "^4.6.16",
  "ioredis": "^5.4.2",
  "luxon": "^3.5.0",
  "mongodb": "^6.12.0",
  "zod": "^3.24.1"
}
```

### Our Addon After Porting
```json
{
  "express": "^4.18.2",      // Already have
  "cheerio": "^1.0.0",       // NEW - need to add
  "node-cache": "^5.1.2"     // Already have (LRU alternative)
}
```

**Dependency reduction**: 6 → 3 (50% reduction!)  
**No external services**: No Redis, no MongoDB  
**Self-contained**: Everything runs in one Node.js process  

---

## Conclusion

The shimizudev/hentai-api repository is well-structured and surprisingly portable. The scrapers themselves are clean, focused, and don't have heavy external dependencies (no Puppeteer!). The main dependencies (Redis/MongoDB) are only used for caching and authentication, which we don't need for a single-user Stremio addon.

**Bottom Line**: We can port ~95% of the scraping logic directly, replace Redis with our existing LRU cache, and have a fully functional self-contained addon. The hardest part will be the HentaiHaven decryption logic, but it's clearly documented and can be tested independently.
