# Cloudflare Workers

This folder contains the scraper workers that handle stream extraction.
Deploy each file to a separate Cloudflare Worker via the dashboard.

## Workers

| File | Worker Name | Purpose |
|------|-------------|---------|
| `scraper-hentaimama.js` | hentaimama | Scrapes HentaiMama.io streams |
| `scraper-hentaisea.js` | hentaisea | Scrapes HentaiSea.com streams |
| `scraper-hentaitv.js` | hentaitv | Scrapes HentaiTV streams |

## Deployment

1. Go to Cloudflare Dashboard → Workers & Pages
2. Create a new Worker (or edit existing)
3. Copy the code from the corresponding `.js` file
4. Add a KV namespace binding named `STREAM_CACHE`
5. Save and Deploy

## KV Namespace Setup

Each worker needs a KV namespace for caching:
1. Go to Storage & Databases → Workers KV
2. Create a namespace (e.g., `STREAM_CACHE_HENTAIMAMA`)
3. In the worker settings, add binding: `STREAM_CACHE` → your namespace

## Environment Variables (Render)

Set these in Render dashboard:
```
WORKER_HENTAIMAMA=https://hentaimama.your-account.workers.dev
WORKER_HENTAISEA=https://hentaisea.your-account.workers.dev
WORKER_HENTAITV=https://hentaitv.your-account.workers.dev
```
