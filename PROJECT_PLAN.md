# HentaiStream - Multi-Provider Stremio Addon

**Project Name**: HentaiStream  
**Architecture**: Unified catalog with multi-source stream aggregation  
**Current Status**: HentaiMama working (catalog, metadata, streams, pagination)  
**Deployment**: Render (Single service)  
**Tech Stack**: Node.js + stremio-addon-sdk + LRU Cache + Express.js + Cheerio  

---

## 🎯 Core Architecture Vision

### The Unified Mega-Catalog Approach

**Catalog Aggregation**: Combine ALL providers into one massive catalog
- Query ALL providers (HentaiMama, HentaiHaven, HStream, OppaiStream, etc.)
- Merge results with smart deduplication (same series = one entry)
- Exclusive content from ANY provider appears in catalog
- Example: "Series A" on 3 providers → shows ONCE | "Series B" only on OppaiStream → still appears

**Metadata Strategy**: MAL as source of truth + provider posters
- **MAL (MyAnimeList)**: Rating, description, genres, episode count (universal data)
- **English Titles**: Store as "ghost" searchable fields (not displayed, only for search matching)
- **Display Titles**: Keep provider titles (Japanese romanized names)
- **Providers**: Cover images (MAL censors images, providers don't)
- **Poster Priority**: Best quality/fastest → HentaiMama default (already implemented)
- **Rating Fallback**: If no MAL rating (rare for 3D hentai) → use provider rating - 1.0 (MAL stricter)

**Stream Aggregation**: Show ALL available sources per episode
- When user clicks episode → scrape ALL providers for that specific episode
- Display multiple stream options: "HentaiMama - 1080p", "OppaiStream - 720p", etc.
- User chooses preferred source and quality
- Only providers with that episode appear in stream list

**Example User Flow**:
1. User browses catalog → sees "Overflow" (on 3 providers), "Series X" (only on HStream)
2. User clicks "Overflow" → sees MAL description + rating, HentaiMama poster
3. User clicks "Episode 1" → sees streams from:
   - ✅ HentaiMama - 1080p
   - ✅ OppaiStream - 720p  
   - ✅ HStream - 480p
   - ❌ (HentaiHaven doesn't have this episode)
4. User picks HentaiMama 1080p stream → watches

---

## 📋 Current Implementation Status

### ✅ Phase 0: Foundation (COMPLETE)
- [x] HentaiMama scraper with WordPress pagination
- [x] Catalog handler with 20-item pagination
- [x] Metadata handler with episode listings
- [x] Stream handler with quality sorting
- [x] LRU caching system (catalog, meta, streams)
- [x] 101+ genre support
- [x] Git repository initialized
- [x] Streams tested and working

### 🔄 Current Capabilities
- **Catalog**: Browse HentaiMama series (20 at a time)
- **Search**: Genre-based filtering via manifest
- **Metadata**: Full series details with episodes
- **Streams**: Working video playback
- **Pagination**: Infinite scroll with deduplication

### ❌ Missing Features
- [ ] Search handler (tag, keyword, title search)
- [ ] Multi-provider catalog aggregation
- [ ] MAL (MyAnimeList) API integration for metadata
- [ ] Series name → MAL ID mapping/fuzzy matching
- [ ] Smart catalog deduplication across providers
- [ ] Additional providers (HentaiHaven, HStream, OppaiStream, etc.)
- [ ] Multi-provider stream aggregation
- [ ] Provider health checks
- [ ] Deployment to production

---

## 🚀 Phase 1: Search Implementation (IMMEDIATE PRIORITY - Part 1)

**Goal**: Enable tag-based, keyword, and title search in Stremio

**Duration**: 2-4 hours

### 1.1: Manifest Configuration (15 minutes)
- Add `search` extra parameter to HentaiMama catalog in `src/addon/manifest.js`
- Enable Stremio's native search bar for the catalog

### 1.2: Catalog Handler Extension (30 minutes)
- Detect `extra.search` parameter in `src/addon/handlers/catalog.js`
- Route search queries to new search logic
- Add `handleSearch()` helper function

### 1.3: HentaiMama Search Method (45 minutes)
- Implement hybrid search in `src/scrapers/hentaimama.js`:
  - **Tag search**: "Romance" → return genre catalog
  - **Keyword search**: "Hentai", "Anime Porn" → return main catalog
  - **Title search**: "overflow" → filter 1 page (20 items) for title matches
- Add search result caching (15-minute TTL)

### 1.4: Testing (30 minutes)
- Test tag-based search: "Romance", "School", "Boobs"
- Test keyword search: "Hentai", "Anime Porn"
- Test title search: "overflow", "toga"
- Test empty results handling
- Test search pagination

**Deliverables**:
- ✅ Working search in Stremio search bar
- ✅ Tag, keyword, and title search functional
- ✅ Results cached for performance
- ✅ 1 page (20 items) search results (Stremio handles "show all")

**Success Metrics**:
- User types "Romance" → sees Romance genre series
- User types "overflow" → sees Overflow series
- Search results appear in <2 seconds (cached)

---

## 🎭 Phase 1.5: MAL Integration & Metadata Enhancement (CRITICAL)

**Goal**: Replace provider-specific metadata with universal MAL data

**Duration**: 6-8 hours

### 1.5.1: MAL API Integration (2 hours)
- Research MAL API (Jikan v4 - unofficial MAL REST API)
- Implement MAL client in `src/utils/mal.js`:
  - Search anime by name (fuzzy matching)
  - Get anime details (rating, description, genres, episodes)
  - Handle rate limiting (3 requests/second)
  - Cache MAL responses (24-hour TTL)

### 1.5.2: Series Name Normalization (2 hours)
- Create `src/utils/nameNormalizer.js`:
  - Strip special characters, normalize spacing
  - Handle common variations ("Series Name" vs "Series-Name")
  - Match provider titles to MAL entries
  - Fuzzy matching for close matches (Levenshtein distance)

### 1.5.3: Metadata Merger (2 hours)
- Update `src/addon/handlers/meta.js`:
  - Fetch MAL data for series
  - Use MAL rating, description, genres
  - **Store English title as "ghost" field** (for search only, not display)
  - Keep provider title for display (Japanese romanized)
  - Keep provider poster (HentaiMama default)
  - **Rating Fallback**: If no MAL rating → `providerRating - 1.0`
  - Cache merged metadata (2-hour TTL)

### 1.5.4: Catalog Enhancement (2 hours)
- Update catalog responses with MAL ratings
- Sort "by rating" uses MAL rating (or adjusted provider rating)
- Display MAL rating in catalog preview

**Deliverables**:
- ✅ MAL API client with rate limiting
- ✅ Name normalization for provider → MAL matching
- ✅ Metadata merger (MAL data + provider posters)
- ✅ Rating fallback logic (provider rating - 1.0)
- ✅ Cached MAL responses for performance

**Success Metrics**:
- 90%+ series match to MAL entries
- Consistent ratings across all providers
- MAL descriptions visible in Stremio
- Provider posters display correctly (uncensored)

**Technical Notes**:
```javascript
// Example MAL integration
async function enrichWithMAL(series) {
  const malEntry = await malClient.searchAnime(series.name);
  
  if (malEntry) {
    return {
      ...series,
      name: series.name,                // Keep provider title (display)
      englishTitle: malEntry.title_english || malEntry.title, // Ghost field for search
      rating: malEntry.score,           // MAL rating (0-10)
      description: malEntry.synopsis,    // MAL description
      genres: malEntry.genres,           // MAL genres
      poster: series.poster,             // Keep provider poster
      malId: malEntry.mal_id
    };
  }
  
  // Fallback: No MAL entry (3D hentai, etc.)
  return {
    ...series,
    rating: series.rating ? series.rating - 1.0 : null,
    description: series.description,
    poster: series.poster
  };
}
```

---

## 🔬 Phase 2: Multi-Provider Catalog Aggregation (CRITICAL)

**Goal**: Combine catalogs from ALL providers into unified view

**Duration**: 1-2 days

### 2.1: Provider Catalog Aggregator (4-6 hours)
- Create `src/utils/catalogAggregator.js`:
  - Query ALL provider `getCatalog()` methods in parallel
  - Merge results into single array
  - Smart deduplication (same series from multiple providers)
  - Track which providers have each series (for stream aggregation later)

### 2.2: Deduplication Strategy (2-3 hours)
- Normalize series names for matching
- Match criteria:
  - Exact name match (case-insensitive)
  - Fuzzy match (90%+ similarity)
  - MAL ID match (if available)
- When duplicate found:
  - Keep first poster found (HentaiMama priority)
  - Store all provider slugs: `['hmm-overflow', 'hh-overflow', 'hs-overflow']`
  - Use MAL metadata (universal)

### 2.3: Catalog Handler Update (2 hours)
- Modify `src/addon/handlers/catalog.js`:
  - Call catalog aggregator instead of single provider
  - Return deduplicated results
  - Include provider availability in metadata
  - Cache aggregated catalog (1-hour TTL)

### 2.4: Testing Aggregation (2 hours)
- Test series on multiple providers (shows once)
- Test exclusive series (only on one provider)
- Test catalog sorting by MAL rating
- Verify poster quality from different providers

**Deliverables**:
- ✅ Catalog aggregator queries all providers
- ✅ Smart deduplication by name + MAL ID
- ✅ Unified catalog with content from ALL providers
- ✅ Provider tracking for stream aggregation
- ✅ Cached aggregated results

**Success Metrics**:
- Catalog includes exclusive content from each provider
- Duplicates properly merged (one entry per series)
- Sorting by rating uses MAL scores
- Browse shows 200+ unique series (not just HentaiMama's ~100)

**Deduplication Example**:
```javascript
// HentaiMama: "Overflow" (slug: hmm-overflow)
// HentaiHaven: "Overflow" (slug: hh-overflow)
// Result: ONE entry with:
{
  id: 'hmm-overflow',              // Primary ID (first found)
  name: 'Overflow',
  poster: 'https://hentaimama...',  // HentaiMama poster
  rating: 7.2,                      // MAL rating
  description: '...',               // MAL description
  providers: ['hmm', 'hh'],         // Available on both
  providerSlugs: {
    hmm: 'overflow',
    hh: 'overflow'
  }
}
```

---

## 🔬 Phase 3: Provider Research & Viability Assessment

**Goal**: Identify which providers are scrapable and prioritize implementation

**Duration**: 4-8 hours

### 2.1: Provider Investigation
Research each candidate provider:
- **HentaiHaven**: WordPress structure (already have yt-dlp plugin)
- **HStream**: Check site structure and anti-bot measures
- **OppaiStream**: Analyze video hosting and scraping approach
- **OHentai**: Investigate API or HTML parsing options
- **Others**: htv, hentaimama competitors

### 2.2: Scraping Feasibility Matrix
For each provider, document:
- ✅ **Easy**: Simple HTML parsing, no protection
- ⚠️ **Medium**: JavaScript rendering or light protection
- ❌ **Hard**: Heavy anti-bot, CAPTCHA, or DDoS protection
- 🚫 **Blocked**: Same issues as HAnime (unusable)

### 2.3: Create Implementation Roadmap
Priority order based on:
1. **Ease of implementation** (quick wins first)
2. **Content availability** (most episodes)
3. **Stream quality** (1080p preferred)
4. **Site reliability** (uptime, speed)

**Deliverables**:
- Provider viability report (markdown doc)
- Ranked list of providers to implement
- Estimated implementation time per provider
- Technical approach notes for each

---

## 🔨 Phase 4: Multi-Provider Stream Aggregation

**Goal**: When user clicks episode, show streams from ALL providers

**Duration**: 3-5 days per provider

### 3.1: Architecture Changes

#### Stream Handler Redesign (`src/addon/handlers/stream.js`)
**Current**: Single provider returns streams  
**New**: Query ALL providers, aggregate results

```javascript
// New flow:
async function streamHandler(args) {
  const { id } = args; // e.g., "hmm-overflow:1:1"
  
  // Parse series slug and episode
  const [prefix, slug, season, episode] = parseVideoId(id);
  
  // Query ALL providers in parallel
  const allProviders = getAllScrapers();
  const streamPromises = allProviders.map(async (provider) => {
    try {
      return await provider.getStreams(slug, season, episode);
    } catch (error) {
      return []; // Provider doesn't have this episode
    }
  });
  
  // Wait for all providers (with timeout)
  const results = await Promise.allSettled(streamPromises);
  
  // Combine and label streams
  const streams = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .map(stream => ({
      ...stream,
      name: `${stream.provider} - ${stream.quality}`,
      title: `${stream.provider} Stream`
    }));
  
  return { streams };
}
```

#### Scraper Base Class Updates (`src/scrapers/base.js`)
- Add `provider` property (e.g., "HentaiMama", "OppaiStream")
- Standardize `getStreams(slug, season, episode)` signature
- Add timeout handling (3-5 seconds max per provider)
- Add error handling (don't crash if one provider fails)

### 3.2: Provider Implementation Pattern

For each new provider, create `src/scrapers/{provider}.js`:

```javascript
class ProviderScraper extends BaseScraper {
  constructor() {
    super();
    this.name = 'ProviderName';
    this.baseUrl = 'https://provider.com';
  }
  
  // Optional: Only if provider has catalog
  async getCatalog(page, genre, sortBy) {
    // Implementation...
  }
  
  // Optional: Only if provider has metadata
  async getMeta(id) {
    // Implementation...
  }
  
  // Required: Every provider must implement
  async getStreams(slug, season, episode) {
    // 1. Find episode URL on provider site
    // 2. Extract video stream URLs
    // 3. Return array of streams with quality labels
    return [
      {
        url: 'https://...',
        quality: '1080p',
        provider: this.name
      }
    ];
  }
}
```

### 3.3: Provider-Specific Implementations

#### Provider 1: HentaiHaven (`src/scrapers/hentaihaven.js`)
- **Status**: yt-dlp plugin exists, needs integration
- **Approach**: Use existing yt-dlp plugin
- **Priority**: HIGH (already have extractor)
- **Estimated Time**: 4-6 hours

#### Provider 2: OppaiStream (`src/scrapers/oppaistream.js`)
- **Status**: Needs research
- **Approach**: TBD from Phase 2 research
- **Priority**: HIGH (common source)
- **Estimated Time**: 1-2 days

#### Provider 3: HStream (`src/scrapers/hstream.js`)
- **Status**: Needs research
- **Approach**: TBD from Phase 2 research
- **Priority**: MEDIUM
- **Estimated Time**: 1-2 days

#### Provider 4: OHentai (`src/scrapers/ohentai.js`)
- **Status**: Needs research
- **Approach**: TBD from Phase 2 research
- **Priority**: MEDIUM
- **Estimated Time**: 1-2 days

### 3.4: Stream Aggregation Logic

**Deduplication Strategy**:
- Different providers may have same episode with different URLs
- Keep ALL streams (user chooses preferred source)
- Label clearly: "HentaiMama - 1080p", "OppaiStream - 720p"
- Sort by: 1) Quality (1080p first), 2) Provider reliability

**Performance Optimization**:
- Parallel provider queries (Promise.all)
- 5-second timeout per provider (don't wait forever)
- Cache aggregated results (5-minute TTL)
- If provider fails, log and continue (don't block other streams)

**Deliverables**:
- ✅ Stream handler queries all providers
- ✅ Multiple stream sources per episode
- ✅ Clear labeling (provider + quality)
- ✅ Graceful degradation (one provider down doesn't break addon)

---

## 🧪 Phase 5: Testing & Optimization

**Goal**: Ensure multi-provider system works reliably

**Duration**: 1-2 days

### 4.1: Integration Testing
- Test series with episodes on multiple providers
- Test series only on one provider (others return empty)
- Test all providers down scenario
- Test mixed quality availability (1080p on one, 720p on another)

### 4.2: Performance Testing
- Measure stream aggregation time (should be <5 seconds)
- Test cache hit rates
- Test parallel provider queries
- Optimize timeout values

### 4.3: User Experience Testing
- Install addon in Stremio
- Browse catalog (should be fast - single provider)
- Search for series (should be fast - 1 page)
- Click episode → verify multiple streams appear
- Play streams from different providers

**Deliverables**:
- ✅ All providers working correctly
- ✅ Stream aggregation under 5 seconds
- ✅ Clear stream labeling in Stremio UI
- ✅ Graceful error handling

---

## 🚀 Phase 6: Production Deployment

**Goal**: Deploy to Render and make public

**Duration**: 2-4 hours

### 5.1: Environment Configuration
- Update `render.yaml` with production settings
- Add provider-specific environment variables (if needed)
- Configure cache settings for production load

### 5.2: Deployment
- Push to GitHub
- Deploy to Render
- Test production URL in Stremio
- Monitor logs for errors

### 5.3: Documentation
- Update README with:
  - Supported providers list
  - Installation instructions
  - Search capabilities
  - Multi-source stream feature
- Add troubleshooting section

**Deliverables**:
- ✅ Working production deployment
- ✅ Public addon URL
- ✅ Updated documentation
- ✅ Monitoring setup

---

## 🔄 Phase 7: Maintenance & Expansion (Ongoing)

**Goal**: Keep addon working and add more providers

### 6.1: Provider Health Monitoring
- Detect when provider sites change structure
- Alert when scraper breaks
- Update scrapers as needed

### 6.2: Add New Providers
- Research new sources
- Implement new scrapers following Phase 3 pattern
- Deploy and test

### 6.3: Performance Optimization
- Analyze cache hit rates
- Optimize slow providers
- Add CDN for static assets (if needed)

---

## 📊 Implementation Timeline

| Phase | Duration | Priority |
|-------|----------|----------|
| **Phase 1: Search** | 2-4 hours | 🔴 CRITICAL |
| **Phase 1.5: MAL Integration** | 6-8 hours | 🔴 CRITICAL |
| **Phase 2: Catalog Aggregation** | 1-2 days | 🔴 CRITICAL |
| **Phase 3: Provider Research** | 4-8 hours | 🔴 CRITICAL |
| **Phase 4: Multi-Provider Streams** | 2-3 weeks | 🟡 HIGH |
| **Phase 5: Testing** | 1-2 days | 🟡 HIGH |
| **Phase 6: Deployment** | 2-4 hours | 🟡 HIGH |
| **Phase 7: Maintenance** | Ongoing | 🟢 MEDIUM |

**Total Time to MVP**: 4-5 weeks

---

## 🎯 Success Criteria

### Search Implementation (Phase 1)
- ✅ User can search by tag/genre name
- ✅ User can search by keyword ("Hentai")
- ✅ User can search by title ("overflow")
- ✅ Search results cached and fast (<2 seconds)
- ✅ Stremio "show all" button works naturally

### Multi-Provider Streams (Phase 3)
- ✅ Episode shows streams from 3+ providers
- ✅ Stream labels clearly show source ("HentaiMama - 1080p")
- ✅ Streams load within 5 seconds
- ✅ If one provider fails, others still work
- ✅ User can choose preferred quality/source

### Production System (Phase 5)
- ✅ Deployed to Render and accessible
- ✅ Uptime >95%
- ✅ Average response time <500ms (catalog/meta)
- ✅ Stream aggregation <5 seconds
- ✅ Clear documentation for users

---

## 🛠️ Technical Stack

### Core Technologies
- **Node.js 18+**: Runtime environment
- **Express.js**: Web server
- **stremio-addon-sdk**: Stremio integration
- **Axios**: HTTP requests
- **Cheerio**: HTML parsing
- **LRU Cache**: In-memory caching

### Scrapers & Tools
- **yt-dlp**: Video extraction (for compatible sites)
- **Custom scrapers**: WordPress, standard HTML parsing
- **winston**: Logging and monitoring

### Deployment
- **Render**: Hosting platform (single web service)
- **GitHub**: Version control
- **Git**: Local repository

---

## 📝 Key Design Decisions

### Why Aggregated Multi-Provider Catalog?
- **Completeness**: ALL content from ALL providers (no exclusives missed)
- **Redundancy**: If HentaiMama down, other providers still populate catalog
- **User Choice**: Maximum content availability (200+ series vs 100)
- **Deduplication**: Same series shown once (not 3x duplicates)

### Why Multi-Source Streams?
- **Reliability**: If one provider down, others still work
- **Quality**: Users choose preferred quality/source
- **Completeness**: Maximum episode availability
- **Redundancy**: Content survives site takedowns

### Why 1-Page Search Results?
- **Performance**: Fast response times (<2 seconds)
- **Stremio UX**: "Show all" button naturally switches to browse mode
- **Cache Efficiency**: Smaller cache footprint
- **User Experience**: 20 results sufficient for initial search

### Why MAL for Metadata?
- **Universal**: Same rating/description regardless of provider
- **Quality**: Professional descriptions and genre tagging
- **Consistency**: Avoid rating discrepancies between providers
- **Uncensored Posters**: Keep provider images (MAL censors)
- **Fallback Logic**: Provider rating - 1.0 for content not on MAL (3D hentai)

### Why Skip HAnime?
- **Blocked**: Anti-bot protection similar to issues encountered
- **Alternative Sources**: Other providers have same content
- **Time Efficiency**: Focus on working providers first
- **Future**: Can revisit if protection bypassed

---

## 🚨 Risk Management

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Provider site structure changes | HIGH | Monitor logs, maintain multiple providers, update scrapers quickly |
| Stream URLs expire quickly | MEDIUM | Short cache TTL (5 min), just-in-time fetching |
| Provider downtime | MEDIUM | Multi-provider redundancy, graceful degradation |
| Rate limiting | HIGH | Aggressive caching, request delays, user-agent rotation |
| Slow stream aggregation | MEDIUM | Parallel queries, 5-second timeout, cache results |

### Operational Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| High traffic costs | LOW | Monitor usage, optimize caching, free tier sufficient for <1000 users |
| Legal/DMCA | MEDIUM | Clear 18+ warnings, no content hosting, link aggregation only |
| Addon policy violations | MEDIUM | Follow Stremio guidelines, adult content disclaimer |

---

## 💰 Cost Estimate

### Monthly Operational Costs

| Service | Tier | Cost |
|---------|------|------|
| Render Web Service | Free/Starter | $0-7 |
| Domain (optional) | Namecheap | $1/month |
| Monitoring | Free tier | $0 |
| **Total** | | **$0-8/month** |

### Scaling Costs (>1000 users)

| Service | Tier | Cost |
|---------|------|------|
| Render Web Service | Standard | $25 |
| Monitoring (Sentry) | Developer | $26 |
| **Total** | | **~$51/month** |

---

## 📚 Resources & References

### Official Documentation
- Stremio Addon SDK: https://github.com/Stremio/stremio-addon-sdk
- yt-dlp Documentation: https://github.com/yt-dlp/yt-dlp
- Jikan API (MAL): https://jikan.moe/ (v4 documentation)
- MyAnimeList: https://myanimelist.net/

### Existing Scrapers (Reference)
- HentaiHaven yt-dlp plugin: `yt_dlp_plugins/extractor/hentaihaven.py`
- HentaiMama yt-dlp plugin: `yt_dlp_plugins/extractor/hentaimama.py`
- HStream yt-dlp plugin: `yt_dlp_plugins/extractor/hstream.py`
- OHentai yt-dlp plugin: `yt_dlp_plugins/extractor/ohentai.py`
- OppaiStream yt-dlp plugin: `yt_dlp_plugins/extractor/oppaistream.py`

---

## 🎬 Next Immediate Steps

1. **Implement Search** (Phase 1)
   - Add search to manifest
   - Extend catalog handler
   - Implement hybrid search in HentaiMama scraper
   - Test in Stremio

2. **Integrate MAL** (Phase 1.5)
   - Set up Jikan API client
   - Implement name normalization and fuzzy matching
   - Create metadata merger (MAL + provider posters)
   - Add rating fallback logic (provider - 1.0)

3. **Aggregate Catalogs** (Phase 2)
   - Build catalog aggregator (query all providers)
   - Implement smart deduplication
   - Track provider availability per series
   - Test unified catalog in Stremio

4. **Research Additional Providers** (Phase 3)
   - Test each provider's scraping feasibility
   - Create viability matrix
   - Prioritize implementation order

5. **Begin Multi-Provider Streams** (Phase 4)
   - Start with HentaiHaven (yt-dlp plugin ready)
   - Refactor stream handler for aggregation
   - Test with 2 providers before adding more

---

*This plan focuses on practical implementation with clear deliverables and realistic timelines. Each phase builds on the previous one, ensuring steady progress toward a production-ready multi-provider addon.*


