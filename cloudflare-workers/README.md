# Cloudflare Workers - Edge Architecture

This folder contains all Cloudflare Workers for the fully-scalable edge deployment.

## Architecture Overview

```
┌─────────────────┐      ┌─────────────────────────┐
│    Stremio      │      │   Cloudflare Workers    │
│    Client       │─────▶│                         │
└─────────────────┘      │  ┌─────────────────┐    │
                         │  │  addon-edge.js  │    │
                         │  │  (Main Router)  │    │
                         │  └────────┬────────┘    │
                         │           │             │
                         │  ┌────────┴────────┐    │
                         │  ▼                 ▼    │
                         │ Catalog/Meta   Streams  │
                         │ (from KV)    (scrapers) │
                         └─────────────────────────┘
```

## Workers

| File | Purpose | Free Tier |
|------|---------|-----------|
| `addon-edge.js` | **Main addon** - handles manifest, catalog, meta, streams | 100k req/day |
| `scraper-hentaimama.js` | Stream extraction from HentaiMama.io | 100k req/day |
| `scraper-hentaisea.js` | Stream extraction from HentaiSea.com | 100k req/day |
| `scraper-hentaitv.js` | Stream extraction from HentaiTV | 100k req/day |

## Why This Scales Infinitely

1. **No Shared Memory** - Each request runs in isolation
2. **KV Reads are FREE** - Database stored in KV, unlimited reads
3. **Global Edge** - Requests served from nearest data center
4. **No Server Crashes** - No RAM limits to hit

## Quick Deployment

```bash
# Install wrangler
npm install -g wrangler
wrangler login

# Create KV namespace for database
wrangler kv:namespace create "CATALOG_DB"
# Copy the namespace ID!

# Edit wrangler.toml with your namespace ID

# Upload database to KV
export KV_NAMESPACE_ID="your-namespace-id"
node scripts/upload-to-kv.js

# Deploy main addon
wrangler deploy

# Deploy scrapers (separate workers)
wrangler deploy cloudflare-workers/scraper-hentaimama.js --name hentaimama
wrangler deploy cloudflare-workers/scraper-hentaisea.js --name hentaisea
wrangler deploy cloudflare-workers/scraper-hentaitv.js --name hentaitv
```

## KV Structure

The `CATALOG_DB` namespace stores:

| Key | Content | Size |
|-----|---------|------|
| `catalog` | Full series array (JSON) | ~15-20 MB |
| `stats` | Database statistics | < 1 KB |
| `filterOptions` | Genre/studio options | ~50 KB |
| `buildDate` | Last build timestamp | < 1 KB |

## Updating the Database

After running `build-database.js` or `update-database.js`:

```bash
node scripts/upload-to-kv.js
```

This uploads the new catalog to KV. The edge worker will serve the updated data immediately.

## Caching Strategy

- **Manifest**: 24 hour cache
- **Catalog**: 5 minute cache (from KV)
- **Meta**: 1 hour cache
- **Streams**: 3 minute cache (from scraper workers)

## Troubleshooting

### "CATALOG_DB KV namespace not bound"
→ Make sure you've created the KV namespace and added it to `wrangler.toml`

### Empty catalog
→ Run `node scripts/upload-to-kv.js` to upload the database

### Scraper workers not responding
→ Check each scraper is deployed: `wrangler deploy cloudflare-workers/scraper-*.js`

## Costs

| Resource | Free Tier | Paid |
|----------|-----------|------|
| Worker requests | 100k/day | $0.50/million |
| KV reads | **Unlimited** | Unlimited |
| KV writes | 1,000/day | $5/million |
| KV storage | 1 GB | $0.50/GB |

For most addons, the free tier is sufficient for thousands of daily users!
