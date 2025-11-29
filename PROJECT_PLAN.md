# Stremio Adult Content Addon - Project Plan

**Project Name**: HentaiStream
**Target Providers**: HAnime (Phase 1), HentaiHaven (Phase 2), HentaiMama (Future)  
**Architecture**: Self-contained addon with integrated scrapers  
**Deployment**: Render (Single service)  
**Tech Stack**: Node.js + stremio-addon-sdk + LRU Cache + Express.js + Cheerio  

---

## ⚠️ Architecture Decision: Self-Contained Addon

**Original Plan**: Separate services (hentai-api + Redis + Addon)  
**Revised Plan**: Single self-contained addon with integrated scrapers

### Why the Change?
- **Simplicity**: One service to deploy and maintain vs. three
- **Cost**: $0-7/month vs. $0-27/month (no Redis or separate API needed)
- **Control**: Direct scraper modifications without coordinating multiple repos
- **Performance**: No network calls between services
- **Reliability**: Fewer moving parts = fewer failure points

### What Changed?
| Component | Old Approach | New Approach |
|-----------|-------------|--------------|
| **Scrapers** | External hentai-api service | Integrated in `src/scrapers/` (ported from hentai-api) |
| **Caching** | Redis (required) + LRU fallback | LRU in-memory only |
| **Dependencies** | 3 services (addon, API, Redis) | 1 service (addon with scrapers) |
| **Code Porting** | Call hentai-api endpoints | Port TypeScript scrapers to JavaScript |
| **Deployment** | Render with 2+ services | Render with single web service |

### What Stays the Same?
- ✅ Stremio addon SDK and handlers
- ✅ HAnime and HentaiHaven support
- ✅ Quality sorting, metadata, caching
- ✅ All user requirements
- ✅ Phased development approach

---

## User Requirements Summary

### Environment & Experience
- **Node.js**: Installed and ready
- **Stremio**: Account and client installed for testing
- **Development Approach**: AI-assisted coding workflow
- **Hosting Platform**: Render (with forked hentai-api on GitHub)

### Core Features
- **Content Organization**: Series with episodes
- **Search**: Full-text search + category/tag recognition (e.g., "Hentai", "Boobs")
- **Categories & Tags**: Fully functional and browsable
- **Quality Options**: Show all available streams, sorted by highest quality first
- **Metadata**: Rich metadata (title, description, genres, tags, ratings, thumbnails)
- **Adult Content Warnings**: Rely on Stremio's addon description (no custom warnings)
- **Caching**: In-memory LRU cache for performance
- **Error Handling**: Show "No streams found" fake stream when content unavailable
- **Self-Contained**: All scraping logic built-in, no external dependencies

### Provider Priority
1. **Phase 1**: HAnime (currently implemented in hentai-api)
2. **Phase 2**: HentaiHaven (currently implemented in hentai-api)
3. **Future Phases**: HentaiMama (pending implementation in hentai-api)

### Research Focus Areas
- Adult content addons (if publicly available)
- Scraping-based addons (non-torrent, direct HTTP streams)
- Catalog-heavy addons (Netflix-style metadata display)
- Integrated scraper implementations (cheerio, HTML parsing)
- Project structure, caching, metadata, stream management, deployment
- Porting TypeScript scrapers to JavaScript

---

## Phase 0: Research & Analysis

**Goal**: Study existing Stremio addons to understand best practices and identify reusable patterns

### Phase 0.1: Primary Research Sources

#### 1. MediaFusion ⭐ PRIMARY REFERENCE
- **Repository**: https://github.com/mhdzumair/MediaFusion
- **Language**: Python (FastAPI framework)
- **Stars**: 689 | **Status**: Actively maintained
- **Why Study**:
  - Most comprehensive catalog system with multi-language support
  - Advanced scraping from multiple sources (TamilMV, TamilBlasters, Prowlarr, RSS)
  - Redis caching implementation
  - Extensive environment configuration
  - Production-ready deployment (Docker, Kubernetes, Heroku)
  - Category/tag implementation via catalogs and filters
  - MongoDB/Beanie for metadata storage
  - Rich metadata handling (RPDB posters, IMDb ratings)
  - Filter system (quality, resolution, certification)
- **Key Files to Study**:
  - `/mediafusion/` - Main addon logic
  - `/deployment/` - Docker and deployment configs
  - `streaming_providers/` - Scraper implementations
  - Cache management patterns
  - Catalog organization structure

#### 2. Inside4ndroid M3U-IPTV Addon ⭐ CACHING & CONFIG REFERENCE
- **Repository**: https://github.com/Inside4ndroid/M3U-XCAPI-EPG-IPTV-Stremio
- **Language**: JavaScript (Node.js)
- **Stars**: 75 | **Status**: Active
- **Why Study**:
  - Token-based configuration system with encryption
  - Multi-level caching (LRU + optional Redis)
  - Dynamic per-user instances via configuration tokens
  - Polished web configuration UI
  - EPG integration with channel metadata
  - Series detection and catalog organization
  - Uses official stremio-addon-sdk
- **Key Files to Clone**:
  - `cryptoConfig.js` - Configuration token system
  - `lruCache.js` - LRU cache implementation
  - `providers/` - Provider architecture
  - Logo proxy system
  - EPG parsing and caching patterns

#### 3. MammaMia ⭐ SCRAPING REFERENCE
- **Repository**: https://github.com/UrloMythus/MammaMia
- **Language**: Python (FastAPI)
- **Stars**: 141 | **Status**: Active
- **Why Study**:
  - Multiple scraper implementations for different sites
  - Config.json for easy site management
  - Proxy support (forward proxy and regular proxies)
  - MediaFlow-Proxy integration for bypassing protections
  - Clean environment variable configuration
  - Multiple deployment options (Render, Vercel, HuggingFace)
- **Key Files to Study**:
  - `/Src/` - Scraper organization
  - Site configuration system
  - Proxy management patterns
  - Stream extraction patterns
  - Error handling and logging
  - `Dockerfile` variations for deployment

#### 4. NuvioStreamsAddon ⭐ PROVIDER ARCHITECTURE
- **Repository**: https://github.com/tapframe/NuvioStreamsAddon
- **Language**: JavaScript (Node.js)
- **Stars**: 143 | **Status**: Active
- **Why Study**:
  - Multiple provider support with direct HTTP streams
  - Cookie-based authentication for quota access
  - Quality filtering system
  - Clean provider architecture (`/providers` directory)
  - Web-based configuration interface
  - Docker deployment ready
  - Uses stremio-addon-sdk
- **Key Files to Clone**:
  - Provider abstraction layer
  - Cookie management for authentication
  - Quality filtering implementation
  - Configuration management
  - Caching strategy
  - TMDB integration patterns

#### 5. Stremio Streaming Catalogs Addon ⭐ CATALOG REFERENCE
- **Repository**: https://github.com/rleroi/Stremio-Streaming-Catalogs-Addon
- **Language**: JavaScript (Node.js) + Vue.js frontend
- **Stars**: 96 | **Status**: Active
- **Why Study**:
  - Modern Vue.js web interface for configuration
  - Country-based filtering for providers
  - Catalog caching system (6-hour default)
  - Express.js backend with nodemon for development
  - Multiple streaming service support (Netflix, Disney+, HBO Max, etc.)
  - Clean project structure
- **Key Files to Study**:
  - `addon.js` - Stremio addon logic
  - `index.js` - Express server setup
  - `/vue` - Vue frontend configuration UI
  - Cache management system
  - Provider integration patterns
  - BeamUp deployment configuration

#### 6. Official Stremio Addon SDK ⭐ ESSENTIAL FOUNDATION
- **Repository**: https://github.com/Stremio/stremio-addon-sdk
- **Language**: JavaScript (Node.js)
- **Stars**: 951 | **Status**: Official & maintained
- **Why Master**:
  - Official examples in `/examples` directory
  - Complete documentation in `/docs`
  - CLI tool (`addon-bootstrap`)
  - Best practices and patterns
  - Deployment guides
  - Testing documentation
- **Key Concepts to Master**:
  - `addonBuilder` API
  - Handler definitions (stream, catalog, meta)
  - Manifest configuration
  - `serveHTTP` usage
  - `publishToCentral` for public addons
  - CORS handling
  - Resource and type definitions

### Phase 0.2: Secondary Research Sources

#### 7. AIOCatalogs (TypeScript Reference)
- **Repository**: https://github.com/panteLx/aiocatalogs
- **Language**: TypeScript
- **Useful For**: Modern TypeScript patterns, Cloudflare Workers deployment, D1 database integration

#### 8. Stremio GDrive Addon (OAuth & Parsing Reference)
- **Repository**: https://github.com/Viren070/stremio-gdrive-addon
- **Language**: JavaScript
- **Useful For**: OAuth implementation, regex filename parsing, configurable filtering/sorting

#### 9. Stremify (Modern Framework Reference)
- **Repository**: https://github.com/stremify/stremify
- **Language**: TypeScript (Nitro framework)
- **Useful For**: Nitro framework patterns, provider integration, TypeScript structure

#### 10. Stremio Top Movies (Simple Catalog Example)
- **Repository**: https://github.com/Deflix-tv/stremio-top-movies
- **Language**: Go
- **Useful For**: Catalog-only architecture, minimal dependencies, CSV + JSON data storage

### Phase 0.3: Research Deliverables

Create a research summary document covering:

1. **Architecture Patterns Comparison**
   - Node.js vs Python implementations
   - Express vs FastAPI frameworks
   - Monolithic vs microservices approach

2. **Caching Strategies**
   - Redis implementation patterns
   - In-memory LRU caching
   - Cache invalidation approaches
   - TTL recommendations by data type

3. **Provider/Scraper Organization**
   - File structure best practices
   - Abstraction layer patterns
   - Error handling approaches
   - Proxy management

4. **Catalog Implementation**
   - Multi-catalog support
   - Search functionality patterns
   - Filter/sort implementations
   - Pagination approaches

5. **Metadata Management**
   - External API integration (TMDB, IMDb)
   - Poster/thumbnail handling
   - Rich metadata structure
   - Caching strategies for metadata

6. **Configuration Management**
   - Environment variables
   - User-specific configs
   - Configuration UI patterns
   - Token-based systems

7. **Deployment Patterns**
   - Docker configurations
   - Render-specific requirements
   - Environment setup
   - Scaling considerations

---

## Phase 0.5: Code Analysis & Scraper Porting Strategy

**Goal**: Understand hentai-api scrapers and plan their integration

### 0.5.1: Analyze hentai-api Repository

1. **Study shimizudev/hentai-api**
   - **Original**: https://github.com/shimizudev/hentai-api
   - **Action**: Clone locally for reference (no fork needed)
   - **Focus Areas**:
     - `src/providers/hanime.ts` - HAnime scraper logic
     - `src/providers/hentai-haven.ts` - HentaiHaven scraper logic
     - `src/helpers/crypto.ts` - ROT13 cipher for decryption
     - Dependencies: cheerio, native fetch

2. **Extract Reusable Scraping Code**
   - **HAnime Scraper**:
     - Search API: POST to `https://search.htv-services.com`
     - Streams API: GET from `https://hanime.tv/rapi/v7/videos_manifests/{slug}`
     - Signature generation for auth
   - **HentaiHaven Scraper**:
     - WordPress HTML parsing with cheerio
     - Multi-layer iframe extraction
     - ROT13 cipher decryption (3 layers)
     - Stream URL extraction from decrypted data

3. **Port TypeScript to JavaScript**
   - **Action**: Convert TypeScript scrapers to plain JavaScript
   - **Changes**:
     - Remove TypeScript types
     - Keep scraping logic identical
     - Adapt to Node.js environment (no Bun)

4. **Identify Dependencies to Add**
   - **cheerio** - HTML/XML parsing
   - **axios** - HTTP requests (already have)
   - **No Redis** - Replace with LRU cache
   - **No MongoDB** - No database needed

### 0.5.2: Create Project Skeleton

Based on best practices from research, create initial project structure:

```
hentaistream-addon/
├── src/
│   ├── addon/
│   │   ├── manifest.js          # Addon manifest configuration
│   │   ├── handlers/
│   │   │   ├── catalog.js       # Catalog handler
│   │   │   ├── meta.js          # Metadata handler
│   │   │   ├── stream.js        # Stream handler
│   │   │   └── search.js        # Search functionality
│   │   └── index.js             # Addon builder
│   ├── scrapers/                # Integrated scrapers (ported from hentai-api)
│   │   ├── base.js              # Base scraper class
│   │   ├── hanime.js            # HAnime scraper with API calls
│   │   └── hentaihaven.js       # HentaiHaven scraper with HTML parsing
│   ├── cache/
│   │   └── lru.js               # In-memory LRU cache (only cache needed)
│   ├── utils/
│   │   ├── logger.js            # Logging utility
│   │   ├── metadata.js          # Metadata processing
│   │   ├── parser.js            # Episode/series parsing
│   │   ├── quality.js           # Quality sorting logic
│   │   └── crypto.js            # ROT13 cipher for HentaiHaven
│   ├── config/
│   │   └── env.js               # Environment variables
│   └── server.js                # Express server entry point
├── public/                       # Static files for config UI (Phase 3)
├── tests/                        # Unit and integration tests
├── docker/
│   └── Dockerfile               # Production Dockerfile
├── .env.example                 # Example environment variables
├── .gitignore
├── package.json
├── README.md
└── render.yaml                  # Render deployment config
```

### 0.5.3: Port Scrapers from hentai-api

#### HAnime Scraper (`src/scrapers/hanime.js`):
- **Port**: Search API integration from `providers/hanime.ts`
- **Port**: Stream manifest fetching with signature generation
- **Port**: Episode parsing and quality extraction
- **Adapt**: Convert TypeScript types to JavaScript JSDoc

#### HentaiHaven Scraper (`src/scrapers/hentaihaven.js`):
- **Port**: WordPress HTML parsing logic
- **Port**: Multi-layer iframe extraction
- **Port**: ROT13 cipher decryption (`src/utils/crypto.js`)
- **Port**: Stream URL extraction from decrypted data
- **Adapt**: Handle network errors gracefully

#### Base Scraper (`src/scrapers/base.js`):
- **Create**: Abstract base class for all scrapers
- **Methods**: `search()`, `getMeta()`, `getStreams()`, `getCatalog()`
- **Features**: Built-in error handling, logging, caching integration

#### From Official SDK Examples:
- **Copy**: Basic addon structure from `/examples/hello-world`
- **Adapt**: Extend with our custom handlers and scrapers

### 0.5.4: Setup Development Environment

1. **Initialize Node.js Project**
   ```bash
   npm init -y
   npm install stremio-addon-sdk express lru-cache axios cheerio dotenv winston
   npm install --save-dev nodemon eslint prettier jest supertest
   ```

2. **Clone hentai-api for Reference**
   ```bash
   git clone https://github.com/shimizudev/hentai-api.git reference/
   ```
   - Use as reference only for scraper logic
   - No need to run it

3. **Create Initial .env File**
   ```env
   # Server
   PORT=7000
   NODE_ENV=development
   
   # Cache TTL (seconds)
   CACHE_TTL_CATALOG=3600      # 1 hour
   CACHE_TTL_META=7200          # 2 hours
   CACHE_TTL_STREAM=300         # 5 minutes
   CACHE_MAX_ITEMS=500          # LRU cache size
   
   # Scraper Configuration
   USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
   REQUEST_TIMEOUT=10000        # 10 seconds
   MAX_RETRIES=3
   
   # Addon Configuration
   ADDON_NAME=HentaiStream
   ADDON_ID=com.hentaistream.addon
   ADDON_VERSION=0.1.0
   
   # Logging
   LOG_LEVEL=info
   ```

---

## Phase 1: MVP - HAnime Provider

**Goal**: Build working addon with HAnime provider support

**Duration Estimate**: 2-3 weeks

### 1.1: Addon Manifest & Basic Structure

**Tasks**:
- Define addon manifest with:
  - `id`: `com.hentaistream.addon`
  - `name`: `HentaiStream`
  - `description`: "Adult anime streaming addon. 18+ only."
  - `version`: `0.1.0`
  - `resources`: `['catalog', 'meta', 'stream']`
  - `types`: `['series']`
  - `catalogs`: Define initial HAnime catalog structure
  - `idPrefixes`: `['hanime-']`
- Setup Express server with CORS
- Initialize stremio-addon-sdk
- Create health check endpoint

**Deliverables**:
- `src/addon/manifest.js` - Complete manifest configuration
- `src/server.js` - Express server with addon mounted
- `src/addon/index.js` - Addon builder initialization
- Basic server running on port 7000

### 1.2: HAnime Scraper Implementation

**Tasks**:
- Create base scraper class (`src/scrapers/base.js`):
  - Abstract methods: `search()`, `getMeta()`, `getStreams()`, `getCatalog()`
  - Built-in axios client with retry logic
  - Error handling and logging
  - Cache integration
- Implement HAnime scraper (`src/scrapers/hanime.js`):
  - **Search**: POST to `https://search.htv-services.com` with query
  - **Metadata**: Parse response for series info (title, tags, description, episodes)
  - **Streams**: GET from `https://hanime.tv/rapi/v7/videos_manifests/{slug}`
  - **Signature Generation**: Create random signature for API auth
  - **Quality Extraction**: Parse m3u8 manifests for available qualities
  - Episode number parsing from slug
- Transform scraper data to Stremio format:
  - Series metadata → Stremio meta object
  - Stream manifests → Stremio stream objects with quality labels
  - Handle missing data gracefully

**Deliverables**:
- `src/scrapers/base.js` - Base scraper class with HTTP client
- `src/scrapers/hanime.js` - Complete HAnime scraper (ported from TypeScript)
- Signature generation utility
- m3u8 manifest parser

### 1.3: Catalog Handler

**Tasks**:
- Implement catalog handler (`src/addon/handlers/catalog.js`):
  - Support pagination (skip/limit)
  - Default catalog: "HAnime Series"
  - Return array of meta previews (id, name, poster, genres)
- Integrate with HAnime scraper's `getCatalog()` method
- Call scraper directly (no external API)
- Handle empty results
- Implement catalog caching via LRU (1 hour TTL)

**Catalog Structure**:
```javascript
{
  metas: [
    {
      id: 'hanime-overflow',
      type: 'series',
      name: 'Overflow',
      poster: 'https://...',
      genres: ['Hentai', 'Romance'],
      description: '...'
    },
    // ...
  ]
}
```

**Deliverables**:
- `src/addon/handlers/catalog.js` - Catalog handler
- Integration with HAnime provider
- Caching implementation

### 1.4: Metadata Handler

**Tasks**:
- Implement meta handler (`src/addon/handlers/meta.js`):
  - Fetch detailed metadata via scraper's `getMeta()` method
  - Parse episode information from scraper response
  - Format runtime, release year
  - Build video array with episode IDs
- Map HAnime scraper data to Stremio meta format:
  ```javascript
  {
    id: 'hanime-overflow',
    type: 'series',
    name: 'Overflow',
    poster: 'https://...',
    background: 'https://...',
    logo: 'https://...',
    description: '...',
    releaseInfo: '2020',
    genres: ['Hentai', 'Romance'],
    runtime: '20 min',
    videos: [
      { id: 'hanime-overflow:1:1', title: 'Episode 1', season: 1, episode: 1 },
      { id: 'hanime-overflow:1:2', title: 'Episode 2', season: 1, episode: 2 }
    ]
  }
  ```
- Implement metadata caching (2 hours TTL)

**Deliverables**:
- `src/addon/handlers/meta.js` - Metadata handler
- Episode parsing utility
- Rich metadata transformation

### 1.5: Stream Handler

**Tasks**:
- Implement stream handler (`src/addon/handlers/stream.js`):
  - Parse video ID format: `hanime-{slug}:{season}:{episode}`
  - Fetch streams via scraper's `getStreams()` method
  - Parse m3u8 manifests for multiple qualities
  - Sort by quality (highest first)
  - Return all available streams
  - Handle "no streams found" case with fake stream
- Stream object format:
  ```javascript
  {
    streams: [
      {
        url: 'https://example.com/video.m3u8',
        name: '1080p - main',
        title: 'HAnime Stream',
        behaviorHints: {
          notWebReady: true  // for HLS streams
        }
      },
      {
        url: 'https://example.com/video-720p.mp4',
        name: '720p - main',
        title: 'HAnime Stream'
      }
    ]
  }
  ```
- Handle different stream types:
  - HLS (m3u8) - Set `notWebReady: true`
  - Direct MP4 - No special hints
- Implement stream caching (5 minutes TTL)
- Error handling for expired URLs

**Deliverables**:
- `src/addon/handlers/stream.js` - Stream handler
- Quality sorting logic
- "No streams found" fallback

### 1.6: LRU Caching Layer

**Tasks**:
- Implement LRU cache (`src/cache/lru.js`):
  - In-memory cache with TTL support
  - Get/Set/Delete/Flush methods
  - Key naming convention: `hentaistream:{type}:{id}`
  - Max items: 500 (configurable)
- Integrate caching in scrapers (via base class):
  - Catalog: 1 hour TTL
  - Metadata: 2 hours TTL  
  - Streams: 5 minutes TTL
- Cache statistics logging
- Cache warming for popular content

**Deliverables**:
- `src/cache/lru.js` - Complete LRU cache with TTL
- Cache integration in base scraper
- Cache wrapper method for async functions

### 1.7: Testing & Debugging

**Tasks**:
- Test in Stremio desktop client:
  - Install addon locally: `http://localhost:7000/manifest.json`
  - Browse catalog
  - View metadata
  - Play streams
  - Test quality selection
- Test search functionality in Stremio
- Test error cases:
  - Invalid ID
  - No streams available
  - Network errors from scrapers
  - HTML parsing failures
- Performance testing:
  - Load time for catalog
  - Scraper response times
  - Cache hit rates
  - Stream URL generation time
- Fix bugs and optimize scraping logic

**Deliverables**:
- Working addon in Stremio
- Bug fixes
- Performance optimizations
- Test documentation

### 1.8: Deployment to Render (MVP)

**Tasks**:
- Create `render.yaml` configuration:
  ```yaml
  services:
    - type: web
      name: hentaistream-addon
      env: node
      buildCommand: npm install
      startCommand: npm start
      envVars:
        - key: NODE_ENV
          value: production
        - key: PORT
          value: 10000
        - key: CACHE_TTL_CATALOG
          value: 3600
        - key: CACHE_TTL_META
          value: 7200
        - key: CACHE_TTL_STREAM
          value: 300
        - key: CACHE_MAX_ITEMS
          value: 1000
        - key: LOG_LEVEL
          value: info
  ```
- Deploy single service to Render
- No external dependencies needed
- Configure environment variables
- Test production deployment
- Monitor logs for scraper errors

**Deliverables**:
- `render.yaml` - Simple single-service configuration
- Production deployment on Render
- Working public URL
- Monitoring setup

---

## Phase 2: HentaiHaven Provider & Enhanced Features

**Goal**: Add second provider and improve metadata/search

**Duration Estimate**: 2-3 weeks

### 2.1: HentaiHaven Scraper

**Tasks**:
- Implement HentaiHaven scraper (`src/scrapers/hentaihaven.js`):
  - **Search**: Scrape WordPress search results with cheerio
  - **Metadata**: Parse series page HTML for title, poster, genres, episodes
  - **Streams**: Multi-step iframe extraction and decryption:
    1. Extract iframe URL from episode page
    2. Fetch iframe content
    3. Extract ROT13 encrypted data
    4. Decrypt 3 layers of ROT13 cipher
    5. Parse final stream URLs
  - Quality sorting from available sources
- Implement ROT13 cipher (`src/utils/crypto.js`):
  - Port from hentai-api's `helpers/crypto.ts`
  - Support multiple decryption passes
- Add HentaiHaven catalog to manifest:
  - New catalog: "HentaiHaven Series"
  - ID prefix: `hh-`
- Update handlers to support multiple scrapers:
  - Route based on ID prefix
  - Scraper factory pattern
- Test both scrapers simultaneously

**Deliverables**:
- `src/scrapers/hentaihaven.js` - Complete HentaiHaven scraper
- `src/utils/crypto.js` - ROT13 cipher utility
- Updated manifest with HH catalog
- Scraper routing logic

**Deliverables**:
- `src/providers/hentaihaven.js` - HentaiHaven provider
- Updated manifest with new catalog
- Provider routing logic

### 2.2: Tag & Category System

**Tasks**:
- Parse tags/categories from provider responses
- Create category-based catalogs:
  - "Hentai by Tag: Romance"
  - "Hentai by Tag: School"
  - "Hentai by Studio"
- Implement genre filtering in catalog handler
- Add tags to metadata
- Dynamic catalog generation based on available tags

**Catalog Examples**:
```javascript
{
  type: 'series',
  id: 'hanime-tag-romance',
  name: 'HAnime - Romance',
  extra: [{ name: 'genre', isRequired: true }]
}
```

**Deliverables**:
- Tag parsing utilities
- Category-based catalogs
- Genre filtering in handlers
- Dynamic catalog system

### 2.3: Enhanced Search Functionality

**Tasks**:
- Implement full-text search handler:
  - Search across both providers
  - Aggregate results
  - Remove duplicates
  - Sort by relevance
- Tag-based search:
  - Query: "Boobs" → Return series with "Boobs" tag
  - Query: "Hentai Romance" → Match both tags
- Fuzzy matching for typos
- Search result caching (15 minutes TTL)
- Pagination support

**Search Flow**:
1. User types in Stremio search bar
2. Addon receives search query
3. Query both HAnime and HentaiHaven
4. Combine and deduplicate results
5. Return unified catalog

**Deliverables**:
- `src/addon/handlers/search.js` - Search handler
- Tag-based search logic
- Result aggregation from multiple providers
- Search caching

### 2.4: Rich Metadata Enhancement

**Tasks**:
- Add additional metadata fields:
  - Studio/producer
  - Release date (parsed)
  - Duration per episode
  - Cast/characters (if available)
  - Rating (create internal rating system)
  - View count (from API if available)
- Poster/thumbnail optimization:
  - Proxy images through addon (optional)
  - Fallback images for missing posters
  - Thumbnail generation for episodes
- Background images for series detail page
- Logo extraction (if available)

**Enhanced Meta Object**:
```javascript
{
  id: 'hanime-overflow',
  type: 'series',
  name: 'Overflow',
  poster: 'https://...',
  background: 'https://...',
  logo: 'https://...',
  description: '...',
  releaseInfo: '2020',
  genres: ['Hentai', 'Romance', 'School'],
  runtime: '20 min',
  director: ['Studio Name'],
  cast: ['Character 1', 'Character 2'],
  imdbRating: 7.5,  // Internal rating
  videos: [...]
}
```

**Deliverables**:
- Enhanced metadata parsing
- Image proxy (optional)
- Fallback image system
- Rating system implementation

### 2.5: Quality Filtering & User Preferences

**Tasks**:
- Add quality filtering in manifest:
  ```javascript
  extra: [
    { name: 'quality', options: ['1080p', '720p', '480p'] }
  ]
  ```
- Filter streams based on user selection
- Remember user preference (via URL parameters)
- Bandwidth-aware quality selection hints

**Deliverables**:
- Quality filtering in stream handler
- User preference support
- Manifest updates for filters

### 2.6: Error Handling & Resilience

**Tasks**:
- Comprehensive error handling:
  - Provider unavailable → Try other providers
  - Network timeouts → Retry with exponential backoff
  - Invalid responses → Log and return empty
  - Rate limits → Queue requests
- Logging system:
  - Winston or Pino for structured logging
  - Log levels: error, warn, info, debug
  - Request tracing
- Health monitoring:
  - `/health` endpoint with provider status
  - Redis connection check
  - API connectivity check
- Graceful degradation:
  - Cache fallback when API down
  - Stale data serving with warning

**Deliverables**:
- `src/utils/logger.js` - Logging system
- Error handling middleware
- Health check endpoint
- Retry logic

### 2.7: Testing & Optimization (Phase 2)

**Tasks**:
- Test both providers thoroughly
- Test tag/category browsing
- Test search with various queries
- Load testing with concurrent users
- Cache hit rate analysis
- Memory profiling
- Response time optimization

**Deliverables**:
- Test results documentation
- Performance benchmarks
- Optimization implementations

### 2.8: Deployment Update

**Tasks**:
- Update production deployment
- Monitor error rates
- Set up alerts (optional: Sentry integration)
- Update README with new features

**Deliverables**:
- Updated production deployment
- Monitoring dashboard
- Updated documentation

---

## Phase 3: Polish & Advanced Features

**Goal**: Configuration UI, analytics, and production hardening

**Duration Estimate**: 2-4 weeks

### 3.1: Web Configuration Interface

**Tasks**:
- Create Vue.js/React frontend (or simple HTML/CSS):
  - Provider selection (enable/disable HAnime, HentaiHaven)
  - Quality preferences
  - Category visibility toggle
  - Cache TTL configuration
  - API key management (optional)
- Generate configuration token
- URL structure: `https://addon.url/{token}/manifest.json`
- Serve configuration UI at root path

**UI Features**:
- Provider toggle switches
- Quality dropdown
- Category checkboxes
- Save configuration button
- Install URL preview

**Deliverables**:
- `public/` - Configuration UI
- Token generation system
- Per-user configuration support

### 3.2: Analytics & Usage Tracking (Optional)

**Tasks**:
- Track addon usage:
  - Popular series
  - Search queries
  - Stream quality preferences
  - Error rates
- Store in MongoDB or PostgreSQL
- Privacy-respecting (no personal data)
- Admin dashboard for insights

**Deliverables**:
- Analytics middleware
- Database schema
- Admin dashboard (basic)

### 3.3: Advanced Caching Strategy

**Tasks**:
- Implement multi-tier caching:
  - L1: In-memory LRU (hot data)
  - L2: Redis (shared cache)
  - L3: Persistent database (cold data)
- Smart cache warming:
  - Pre-cache popular series
  - Pre-cache trending content
- Cache invalidation webhooks (if API supports)
- Cache analytics (hit rate, miss rate)

**Deliverables**:
- Multi-tier cache implementation
- Cache warming background jobs
- Cache performance dashboard

### 3.4: Subtitle Support (If Available)

**Tasks**:
- Check if providers offer subtitles
- Parse subtitle URLs from API responses
- Add to stream object:
  ```javascript
  {
    url: '...',
    subtitles: [
      { url: 'https://...', lang: 'eng' },
      { url: 'https://...', lang: 'jpn' }
    ]
  }
  ```
- Subtitle proxy (if needed)

**Deliverables**:
- Subtitle parsing
- Subtitle integration in streams

### 3.5: Rate Limiting & DDoS Protection

**Tasks**:
- Implement rate limiting:
  - Per-IP limits
  - Per-token limits (if using config tokens)
  - Redis-backed rate limiter
- DDoS protection:
  - Cloudflare integration (optional)
  - Request throttling
  - IP blacklisting for abuse

**Deliverables**:
- Rate limiting middleware
- Abuse detection system
- IP blacklist management

### 3.6: Documentation

**Tasks**:
- Comprehensive README:
  - Installation instructions
  - Configuration guide
  - API documentation
  - Troubleshooting section
  - FAQ
- Developer documentation:
  - Architecture overview
  - Provider development guide
  - Contributing guidelines
- User guide:
  - How to install addon
  - How to search
  - How to report issues

**Deliverables**:
- `README.md` - User documentation
- `CONTRIBUTING.md` - Developer guide
- `API.md` - API documentation

### 3.7: Testing Suite

**Tasks**:
- Unit tests:
  - Provider methods
  - Utility functions
  - Cache operations
- Integration tests:
  - Handler workflows
  - API integration
  - Caching behavior
- End-to-end tests:
  - Addon installation
  - Content browsing
  - Stream playback (simulated)
- CI/CD setup:
  - GitHub Actions for automated testing
  - Automated deployment on merge to main

**Testing Stack**:
- Jest or Mocha for unit tests
- Supertest for API testing
- Docker Compose for integration tests

**Deliverables**:
- `tests/` - Complete test suite
- `.github/workflows/test.yml` - CI configuration
- Test coverage report (aim for 80%+)

### 3.8: Security Hardening

**Tasks**:
- Environment variable validation
- Input sanitization (search queries, IDs)
- HTTPS enforcement
- Content Security Policy headers
- Dependency vulnerability scanning:
  - npm audit
  - Dependabot
- Secrets management (no hardcoded credentials)

**Deliverables**:
- Security audit report
- Hardened codebase
- Dependency updates

### 3.9: Performance Optimization

**Tasks**:
- Code profiling:
  - Identify bottlenecks
  - Optimize hot paths
- Database query optimization
- Response compression (gzip)
- CDN integration for static assets
- Lazy loading for large catalogs
- Pagination optimization

**Deliverables**:
- Performance benchmarks (before/after)
- Optimized code
- Performance monitoring setup

### 3.10: Final Deployment & Launch

**Tasks**:
- Production deployment checklist:
  - All environment variables set
  - Redis configured and scaled
  - Monitoring active
  - Backups configured (if using database)
- Load balancing (if needed)
- DNS configuration
- SSL certificate (Render provides this)
- Publish to Stremio Community:
  - Use `publishToCentral()` from SDK
  - Or list in community addon repositories
- Announce on Reddit/forums (if desired)

**Deliverables**:
- Production-ready deployment
- Public addon URL
- Community announcement

---

## Phase 4: HentaiMama Integration (Future)

**Goal**: Add HentaiMama scraper to addon

**Prerequisites**: Complete research on HentaiMama website structure

### 4.1: Research HentaiMama

**Tasks**:
- Analyze HentaiMama website structure
- Understand video hosting mechanism
- Identify stream URL patterns
- Check for API or scraping opportunities
- Study Aniyomi source code for HentaiMama extension
- Test scraping approach with Puppeteer (if needed for dynamic content)

**Deliverables**:
- HentaiMama technical analysis document
- Scraping strategy (HTML parsing vs headless browser)
- Sample scraping code proof-of-concept

### 4.2: Implement HentaiMama Scraper

**Tasks**:
- Implement HentaiMama scraper (`src/scrapers/hentaimama.js`):
  - Search functionality (HTML parsing or API if available)
  - Metadata extraction (series info, episodes, posters)
  - Stream URL extraction
  - Quality detection
- Extend base scraper class
- Add any new utilities needed (e.g., Puppeteer if required)
- Test locally with real content

**Deliverables**:
- `src/scrapers/hentaimama.js` - Complete scraper
- Updated dependencies (Puppeteer if needed)
- Unit tests for scraper

### 4.3: HentaiMama Integration in Addon

**Tasks**:
- Add HentaiMama catalog to manifest:
  - New catalog: "HentaiMama Series"
  - ID prefix: `hm-`
- Update handler routing for 3 scrapers
- Implement scraper factory with all three sources
- Test integration end-to-end
- Deploy to production

**Deliverables**:
- HentaiMama catalog live
- Updated addon with 3 scrapers
- Tested and deployed

### 4.4: Scraper Comparison & Optimization

**Tasks**:
- Compare content across scrapers:
  - Identify duplicates across HAnime/HentaiHaven/HentaiMama
  - Merge catalogs intelligently
  - Prefer higher quality sources
- Unified search across all three scrapers
- Scraper fallback logic (if one fails, try others)
- Performance optimization (parallel scraping for search)

**Deliverables**:
- Unified catalog experience
- Scraper fallback system
- Duplicate detection

---

## Phase 5: Maintenance & Community (Ongoing)

**Goal**: Keep addon updated and respond to community feedback

### 5.1: Monitoring & Alerts

**Tasks**:
- Set up monitoring:
  - Uptime monitoring (UptimeRobot, Pingdom)
  - Error tracking (Sentry)
  - Performance monitoring (New Relic, Datadog)
- Configure alerts:
  - High error rate
  - API downtime
  - Cache failures
  - Disk/memory issues

**Deliverables**:
- Monitoring dashboards
- Alert configurations

### 5.2: Regular Updates

**Tasks**:
- Monthly dependency updates
- Security patches
- Provider updates (if APIs change)
- Bug fixes
- Feature requests from users

**Deliverables**:
- Updated codebase
- Changelog

### 5.3: Community Support

**Tasks**:
- GitHub Issues management
- User support (Discord, Reddit)
- Feature request evaluation
- Bug triage and fixes
- Documentation updates based on feedback

**Deliverables**:
- Active community engagement
- Improved addon based on feedback

### 5.4: Scale & Optimize

**Tasks**:
- Monitor usage growth
- Scale infrastructure (more Redis nodes, load balancers)
- Optimize costs
- CDN for static assets
- Database optimization

**Deliverables**:
- Scaled infrastructure
- Cost-optimized deployment

---

## Technical Stack Summary

### Languages & Frameworks
- **Backend**: Node.js 18+ with Express.js
- **Addon SDK**: stremio-addon-sdk (official)
- **Scraping**: Cheerio for HTML parsing, Axios for HTTP
- **Frontend** (Phase 3): Vue.js or React (for config UI)

### Data & Caching
- **Cache**: LRU in-memory cache only (no Redis needed)
- **Database**: None (fully stateless)
- **Scrapers**: Integrated HAnime and HentaiHaven scrapers (ported from hentai-api)

### DevOps & Deployment
- **Hosting**: Render (single web service)
- **Version Control**: GitHub
- **CI/CD**: GitHub Actions
- **Monitoring**: Sentry (errors), UptimeRobot (uptime), Render logs

### Key Dependencies
```json
{
  "dependencies": {
    "stremio-addon-sdk": "^1.6.8",
    "express": "^4.18.2",
    "lru-cache": "^10.0.1",
    "axios": "^1.6.0",
    "cheerio": "^1.0.0-rc.12",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1",
    "eslint": "^8.52.0",
    "prettier": "^3.0.3",
    "jest": "^29.7.0",
    "supertest": "^6.3.3"
  }
}
```

---

## Success Metrics

### Phase 1 (MVP)
- ✅ Addon installs successfully in Stremio
- ✅ Catalog loads with HAnime content
- ✅ Metadata displays correctly
- ✅ Streams play without errors
- ✅ Deployed to Render and accessible publicly

### Phase 2 (Enhanced)
- ✅ HentaiHaven provider working
- ✅ Tag-based search functional
- ✅ Category catalogs available
- ✅ Rich metadata display
- ✅ Error handling robust

### Phase 3 (Production)
- ✅ Configuration UI deployed
- ✅ Analytics tracking (optional)
- ✅ >90% uptime
- ✅ Response time <500ms for catalogs
- ✅ Cache hit rate >80%
- ✅ Test coverage >80%

### Phase 4 (HentaiMama)
- ✅ HentaiMama provider integrated
- ✅ Three providers working simultaneously
- ✅ Unified search across providers

### Phase 5 (Maintenance)
- ✅ Active community (GitHub stars, forks)
- ✅ Regular updates (monthly)
- ✅ Low error rate (<1%)
- ✅ Positive user feedback

---

## Risk Management

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Website structure changes break scrapers | High | High | Monitor for errors, update scraper logic, maintain multiple scrapers for redundancy |
| Stream URLs expire quickly | Medium | Medium | Short cache TTL (5 min), just-in-time scraping, URL refresh logic |
| HLS compatibility issues | Low | Medium | Test on all platforms, provide MP4 alternatives, set behaviorHints correctly |
| Rate limiting/IP blocking from target sites | Medium | High | Implement aggressive caching, request delays, user-agent rotation, consider proxy support |
| Scraper performance issues | Medium | Medium | LRU cache for hot content, optimize HTML parsing, parallel requests where possible |
| Render service downtime | Low | Medium | Monitor uptime, have backup deployment ready (Railway, Vercel) |
| Legal/DMCA issues | Medium | High | Clear disclaimers, user responsibility, no content hosting, quick takedown response |

### Development Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Scope creep | Medium | Medium | Stick to phased plan, prioritize MVP, defer advanced features |
| AI coding errors | Medium | Medium | Code review, testing, incremental development |
| Provider unavailable during dev | Low | Medium | Use mock data for testing, test with multiple providers |

### Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| High traffic costs | Low | Medium | Monitor usage, set billing alerts, optimize caching |
| Security breach | Low | High | Follow security best practices, regular audits, no sensitive data storage |
| Content policy violations | Medium | High | 18+ warnings, clear addon description, comply with platform policies |

---

## Budget Estimate

### Development Costs
- **Time**: 6-10 weeks total (AI-assisted)
- **Cost**: $0 (self-developed)

### Operational Costs (Monthly)

| Service | Tier | Cost |
|---------|------|------|
| Render Web Service | Starter ($7/mo) or Free | $0-$7 |
| Domain (optional) | Namecheap | $10/year |
| Monitoring (optional) | Free tiers | $0 |
| **Total** | | **$0-$7/month** |

### Scaling Costs (If >1000 users)

| Service | Tier | Cost |
|---------|------|----- |
| Render Web Service | Standard ($25/mo) | $25 |
| Render Redis | Standard ($15/mo) | $15 |
| CDN (Cloudflare) | Free or Pro | $0-$20 |
| Monitoring (Sentry) | Developer ($26/mo) | $26 |
| **Total** | | **~$86/month** |

---

## Next Steps

1. **Complete Phase 0**: Research existing addons (2-3 days) ✅ DONE
2. **Complete Phase 0.5**: Analyze hentai-api and plan scraper porting (1 day)
3. **Begin Phase 1**: Create project structure and port HAnime scraper (2-3 days)
4. **Set up development environment**: Install dependencies (cheerio, lru-cache, etc.)
5. **Test scrapers**: Verify HAnime scraping works before Stremio integration
6. **Daily progress reviews**: Review AI-generated code, test functionality, iterate

---

## Notes & Considerations

### Stremio Platform Specifics
- **Desktop (Windows/Mac/Linux)**: Best compatibility, HLS support varies
- **Android**: Native HLS support, good performance
- **iOS**: Native HLS support, excellent performance
- **Web**: Limited codec support, test thoroughly

### Content Considerations
- **Adult Content**: Clearly mark as 18+ in description
- **DMCA**: You're linking, not hosting, but be prepared for takedown requests
- **Privacy**: No user tracking beyond anonymous analytics

### Future Expansion Ideas
- **More providers**: nhentai, Rule34, etc. (if APIs become available)
- **Recommendations**: "Similar series" based on tags
- **Watchlist**: Save favorite series (requires user accounts)
- **Comments**: Community discussion (Phase 6+)
- **Mobile app**: Native Android/iOS wrapper for better UX

---

## Resources & References

### Official Documentation
- Stremio Addon SDK: https://github.com/Stremio/stremio-addon-sdk
- Stremio Protocol Spec: https://github.com/Stremio/stremio-addon-sdk/tree/master/docs
- Hentai-API: https://github.com/shimizudev/hentai-api

### Referenced GitHub Repositories
1. MediaFusion: https://github.com/mhdzumair/MediaFusion
2. Inside4ndroid M3U-IPTV: https://github.com/Inside4ndroid/M3U-XCAPI-EPG-IPTV-Stremio
3. MammaMia: https://github.com/UrloMythus/MammaMia
4. NuvioStreamsAddon: https://github.com/tapframe/NuvioStreamsAddon
5. Stremio Streaming Catalogs: https://github.com/rleroi/Stremio-Streaming-Catalogs-Addon
6. AIOCatalogs: https://github.com/panteLx/aiocatalogs
7. Stremio GDrive: https://github.com/Viren070/stremio-gdrive-addon
8. Stremify: https://github.com/stremify/stremify
9. Stremio Top Movies: https://github.com/Deflix-tv/stremio-top-movies
10. Official SDK: https://github.com/Stremio/stremio-addon-sdk

### Community Resources
- Stremio Reddit: r/StremioAddons
- Stremio Discord: (check official website)
- Addon Registry: https://stremio-addons.netlify.app/

---

## Version History

- **v0.1** (2025-11-27): Initial project plan created
  - Phases 0-5 defined
  - Technical stack selected
  - Research completed
  - User requirements documented

---

*This plan is a living document and will be updated as the project progresses.*
