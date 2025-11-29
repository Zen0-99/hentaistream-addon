# HentaiStream Addon - Setup Guide

This guide will help you get the addon running locally for testing.

## Prerequisites Checklist

- [x] Node.js 18+ installed
- [x] Stremio desktop client installed
- [ ] Redis server running
- [ ] hentai-api forked and deployed

## Quick Start

### 1. Setup Redis (Required)

**Option A: Using Docker (Recommended)**
```powershell
docker run -d -p 6379:6379 --name hentaistream-redis redis:alpine
```

**Option B: Install Redis on Windows**
- Download from: https://github.com/microsoftarchive/redis/releases
- Or use WSL2 with Redis

### 2. Setup hentai-api

You need a running instance of the hentai-api:

**Option A: Deploy to Render (Recommended for production)**
1. Fork https://github.com/shimizudev/hentai-api to your GitHub
2. Create new Web Service on Render
3. Connect your forked repository
4. Add environment variables (Redis required)
5. Deploy
6. Copy your deployed URL

**Option B: Run locally for development**
```powershell
cd c:\Users\karol\OneDrive\Documents\GitHub\Mama
git clone https://github.com/YOUR_USERNAME/hentai-api.git
cd hentai-api
npm install
# Setup Redis connection in .env
npm start
```

### 3. Configure the Addon

Update `.env` file with your hentai-api URL:
```env
HENTAI_API_URL=http://localhost:3000
# Or your Render URL:
# HENTAI_API_URL=https://your-hentai-api.onrender.com
```

### 4. Start the Addon

```powershell
cd c:\Users\karol\OneDrive\Documents\GitHub\Mama\hentaistream-addon
npm start
```

You should see:
```
========================================
🚀 HentaiStream v0.1.0
========================================
Server running on port 7000
Environment: development
Manifest URL: http://localhost:7000/manifest.json
Health Check: http://localhost:7000/health
Redis: ✓ Connected
========================================
```

### 5. Test the Addon

Open your browser and test these endpoints:

1. **Health Check**: http://localhost:7000/health
2. **Manifest**: http://localhost:7000/manifest.json
3. **Root Info**: http://localhost:7000

### 6. Install in Stremio

1. Open Stremio desktop client
2. Go to **Addons** (puzzle piece icon)
3. Scroll down and click **Install from URL**
4. Enter: `http://localhost:7000/manifest.json`
5. Click **Install**

The addon should now appear in your Stremio addons list!

### 7. Test in Stremio

1. Go to **Discover** or **Board**
2. Look for "HAnime" catalog
3. Browse content
4. Click on a series to view details
5. Click on an episode
6. Select a stream quality to play

## Troubleshooting

### Redis Connection Failed

**Issue**: `Redis: ✗ Disconnected`

**Solution**:
- Make sure Redis is running: `docker ps` or check Windows services
- Check REDIS_HOST and REDIS_PORT in `.env`
- Test Redis connection: `redis-cli ping` (should return PONG)

### Hentai-API Not Responding

**Issue**: Addon can't fetch data from hentai-api

**Solution**:
- Check if hentai-api is running (visit the URL in browser)
- Verify HENTAI_API_URL in `.env` is correct
- Check hentai-api logs for errors
- Ensure hentai-api has Redis configured

### No Content in Stremio

**Issue**: Catalogs are empty or no streams available

**Possible Causes**:
1. hentai-api is not properly scraping data
2. Network issues between addon and hentai-api
3. Cache issues

**Solutions**:
- Check addon logs for errors
- Test hentai-api endpoints directly in browser:
  - `http://your-api-url/api/hanime/search/hentai`
  - `http://your-api-url/api/hanime/123/streams`
- Clear cache: Restart both addon and Redis

### Module Not Found Errors

**Issue**: `Cannot find module '...'`

**Solution**:
```powershell
rm -r node_modules
rm package-lock.json
npm install
```

## Development Mode

For active development with auto-restart:

```powershell
npm run dev
```

This uses nodemon to watch for file changes and auto-restart the server.

## Docker Setup (Alternative)

If you prefer using Docker Compose:

```powershell
cd docker
docker-compose up -d
```

This starts both the addon and Redis in containers.

## Next Steps

Once you have the addon working:

1. **Phase 1 Testing**: Test all HAnime functionality
2. **Deploy to Render**: Use `render.yaml` for production deployment
3. **Phase 2**: Add HentaiHaven provider
4. **Phase 3**: Build configuration UI

## Useful Commands

```powershell
# Start addon
npm start

# Development mode (auto-restart)
npm run dev

# Run tests
npm test

# Check for errors
npm run lint

# Format code
npm run format

# View logs (in production)
tail -f logs/combined.log
tail -f logs/error.log
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 7000 | Server port |
| `NODE_ENV` | No | development | Environment |
| `HENTAI_API_URL` | Yes | - | Hentai-API base URL |
| `HENTAI_API_KEY` | No | - | API key for higher limits |
| `REDIS_HOST` | Yes | localhost | Redis host |
| `REDIS_PORT` | No | 6379 | Redis port |
| `REDIS_PASSWORD` | No | - | Redis password |
| `CACHE_TTL_CATALOG` | No | 3600 | Catalog cache (seconds) |
| `CACHE_TTL_META` | No | 7200 | Metadata cache (seconds) |
| `CACHE_TTL_STREAM` | No | 300 | Stream cache (seconds) |
| `LOG_LEVEL` | No | info | Logging level |

## Support

If you encounter issues:

1. Check the logs for error messages
2. Verify all prerequisites are met
3. Test each component individually
4. Create an issue on GitHub with:
   - Error logs
   - Steps to reproduce
   - Environment details (OS, Node version, etc.)

---

**Note**: This is an adult content addon (18+). Use responsibly and ensure compliance with local laws.
