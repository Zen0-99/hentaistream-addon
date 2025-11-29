# HentaiStream Addon for Stremio

**⚠️ 18+ Adult Content Only ⚠️**

A Stremio addon that provides streaming content from HAnime and HentaiHaven through direct HTTP streams.

## Features

- 🎬 Browse HAnime and HentaiHaven catalogs
- 🔍 Full-text search with tag/category support
- 🎯 Multiple quality options (sorted by highest first)
- 📊 Rich metadata with genres, descriptions, and thumbnails
- ⚡ Redis caching for optimal performance
- 🎭 Episode tracking and series organization

## Installation

### Prerequisites

- Node.js 18+ installed
- Redis server running (local or remote)
- Forked and deployed hentai-api instance

### Setup

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/hentaistream-addon.git
cd hentaistream-addon
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:
```env
HENTAI_API_URL=https://your-hentai-api-url.com
HENTAI_API_KEY=your_api_key
REDIS_HOST=your_redis_host
REDIS_PORT=6379
```

5. Start the addon:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Usage

### Add to Stremio

1. Start the addon server (it will run on `http://localhost:7000` by default)
2. Open Stremio
3. Go to Addons
4. Click "Install from URL"
5. Enter: `http://localhost:7000/manifest.json`

For production deployment, use your deployed URL instead.

### Search

- **By title**: Type the series name (e.g., "Overflow")
- **By tag**: Type tags (e.g., "Romance", "School")
- **By category**: Browse category catalogs in the addon

## Development

### Project Structure

```
hentaistream-addon/
├── src/
│   ├── addon/
│   │   ├── manifest.js          # Addon manifest
│   │   ├── handlers/            # Catalog, meta, stream handlers
│   │   └── index.js             # Addon builder
│   ├── providers/
│   │   ├── base.js              # Base provider class
│   │   ├── hanime.js            # HAnime provider
│   │   └── hentaihaven.js       # HentaiHaven provider
│   ├── cache/
│   │   ├── redis.js             # Redis implementation
│   │   └── lru.js               # LRU fallback cache
│   ├── utils/                   # Utility functions
│   ├── config/                  # Configuration
│   └── server.js                # Express server
├── tests/                       # Test suite
└── docker/                      # Docker configs
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

## Deployment

### Render

1. Fork this repository
2. Create new Web Service on Render
3. Connect your repository
4. Add environment variables
5. Deploy

See `render.yaml` for automatic deployment configuration.

### Docker

```bash
docker build -t hentaistream-addon .
docker run -p 7000:7000 --env-file .env hentaistream-addon
```

## Roadmap

- [x] Phase 0: Research & setup
- [x] Phase 0.5: Project structure
- [ ] Phase 1: HAnime provider MVP
- [ ] Phase 2: HentaiHaven + tags/categories
- [ ] Phase 3: Configuration UI & polish
- [ ] Phase 4: HentaiMama integration

See `PROJECT_PLAN.md` for detailed roadmap.

## Contributing

Contributions are welcome! Please read `CONTRIBUTING.md` first.

## Legal

This addon does not host any content. It only aggregates and links to publicly available streams from third-party providers. Users are responsible for ensuring their usage complies with local laws.

## License

MIT License - See `LICENSE` file for details

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

---

**Warning**: This addon is for adults only (18+). By using this addon, you confirm you are of legal age in your jurisdiction.
