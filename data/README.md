# Data Directory

This directory contains the pre-bundled catalog database for HentaiStream addon.

## Files

- `catalog.json` - Uncompressed catalog database (development)
- `catalog.json.gz` - Gzipped catalog database (production, ~5-10MB)

## Building the Database

Run the build script to scrape all providers and generate the database:

```bash
node scripts/build-database.js
```

This will:
1. Scrape all catalog items from HentaiMama, HentaiTV, and HentaiSea
2. Build a slug registry for cross-provider matching
3. Generate both JSON and gzipped versions

## Database Structure

```json
{
  "version": 1,
  "buildDate": "2024-01-01T00:00:00.000Z",
  "providers": {
    "hmm": { "name": "hentaimama", "itemCount": 1000 },
    "hse": { "name": "hentaisea", "itemCount": 800 },
    "htv": { "name": "hentaitv", "itemCount": 600 }
  },
  "catalog": [
    { "id": "hmm-series-name", "name": "Series Name", "rating": 8.5, ... }
  ],
  "slugRegistry": {
    "series-name": {
      "hmm": { "id": "hmm-series-name", "rating": 8.5 },
      "hse": { "id": "hse-series-name", "rating": 7.2 }
    }
  },
  "stats": {
    "totalSeries": 2400,
    "byProvider": { "hmm": 1000, "hse": 800, "htv": 600 }
  }
}
```

## Automated Updates

The database can be automatically updated via GitHub Actions on a schedule.
See `.github/workflows/update-database.yml` for configuration.
