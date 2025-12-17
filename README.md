# HentaiStream Addon for Stremio

** 18+ Adult Content Only **

A free Stremio addon that brings adult anime content directly to your Stremio app. Browse, search, and stream from multiple sources with a clean interface.

---

##  What Does This Addon Do?

HentaiStream lets you watch adult anime (hentai) through Stremio by:
- **Browsing catalogs** - Top rated, latest releases, and trending content
- **Filtering content** - By genre (3D, Action, Comedy, etc.), studio, or release year
- **Searching** - Find specific titles quickly
- **Streaming** - Direct video playback through Stremio's player

The addon pulls content from multiple sources and combines them into one easy-to-use catalog.

---

##  Features

###  Multiple Catalogs
- **Top Rated** - Highest rated content
- **Latest Updates** - Recently added series
- **Trending** - Popular right now
- **Popular** - Most watched overall
- **All** - A list of All Hentai

###  Smart Filtering
- **101+ Genres** - 3D, Action, Adventure, Comedy, Drama, Fantasy, Horror, Romance, Sci-Fi, and many more
- **Studios** - Filter by your favorite animation studios
- **Release Years** - Browse content from specific years (2000-2025)

###  Quality Features
- Multiple options per episode
- Rich metadata with descriptions, genres and animation studios
- Smart caching for fast loading
- Blacklisting capabilities in the configure screen

---

##  Installation

### Option 1: Quick Install (Local)

1. **Install Node.js**
   - Download and install [Node.js 18+](https://nodejs.org/)

2. **Download & Setup**
   `ash
   git clone https://github.com/YOUR_USERNAME/hentaistream-addon.git
   cd hentaistream-addon
   npm install
   `

3. **Start the Server**
   `ash
   npm start
   `
   The server will run at `http://localhost:7000`

4. **Add to Stremio**
   - Open Stremio
   - Go to Addons
   - Paste this URL: `http://localhost:7000/manifest.json`
   - Click Install

### Option 2: Deploy to Cloud (Recommended)

You can deploy this addon to free hosting platforms so it's always available:

#### Deploy to Render.com (Free)
1. Fork this repository to your GitHub
2. Sign up at [Render.com](https://render.com/)
3. Create a new Web Service
4. Connect your GitHub repository
5. Use these settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
6. Copy your Render URL (e.g., `https://yourapp.onrender.com`)
7. Add to Stremio: `https://yourapp.onrender.com/manifest.json`

---

##  How to Use

### Basic Usage
1. Open Stremio after installing the addon
2. Go to the **Discover** section
3. You'll see new catalogs like "Hentai - Top Rated", "Hentai - Latest", etc.
4. Browse and click any title to start watching

### Using Filters
1. Click on any HentaiStream catalog
2. At the top, you'll see dropdown filters:
   - **Genre** - Select from 101+ genres
   - **Studio** - Filter by animation studio
   - **Year** - Choose release year
3. Filters can be combined (e.g., 3D genre + 2023)

### Searching
1. Use Stremio's search bar
2. Type the name of the series
3. Results will include content from HentaiStream

---

##  Configuration

The addon works out of the box with default settings. For advanced users:

### Environment Variables (Optional)

Create a `.env` file in the root directory:

`env
# Server Settings
PORT=7000
NODE_ENV=production

# Cache Duration (in seconds)
CACHE_TTL_CATALOG=3600    # 1 hour
CACHE_TTL_META=7200       # 2 hours  
CACHE_TTL_STREAM=300      # 5 minutes
CACHE_TTL_SEARCH=900      # 15 minutes
`

### Port Configuration
By default, the server runs on port 7000. To change it:
- Set `PORT` environment variable
- Or edit `src/config/env.js`

---

##  Troubleshooting

### Addon Not Showing in Stremio
- Make sure the server is running (`npm start`)
- Check the URL is correct: `http://localhost:7000/manifest.json`
- Try removing and re-adding the addon

### No Content Loading
- Check your internet connection
- Wait a few seconds - first load fetches from multiple sources
- Try refreshing the catalog

### Server Won't Start
- Make sure Node.js 18+ is installed (`node --version`)
- Delete `node_modules` and run `npm install` again
- Check if port 7000 is already in use

### Content Not Playing
- Some videos may have regional restrictions
- Try a different episode or series
- Check if the source website is accessible from your location

---

##  Project Structure

`
hentaistream-addon/
 src/
    server.js           # Main server entry point
    addon/              # Stremio addon logic
    scrapers/           # Content scrapers (HentaiMama, HentaiTV, HentaiSea)
    cache/              # Caching system
    utils/              # Helper functions
 docker/                 # Docker configuration
 public/                 # Static files
 package.json            # Dependencies
 render.yaml            # Cloud deployment config
`

---

##  Privacy & Legal

- This addon **does not host** any content
- It aggregates publicly available content from third-party websites
- All streaming links come from external sources
- Users are responsible for complying with their local laws
- Age verification: This addon is for **18+ users only**

---

##  Contributing

Contributions are welcome! If you find bugs or want to add features:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

##  License

This project is licensed under the MIT License - see the LICENSE file for details.

---

##  Disclaimer

This addon is provided for educational purposes only. The developers:
- Do not host, store, or distribute any content
- Are not responsible for content accessed through this addon
- Do not endorse piracy or copyright infringement
- Recommend users comply with their local laws and regulations

Use at your own risk.

---

##  Support

Having issues? 
- Check the [Troubleshooting](#-troubleshooting) section
- Open an issue on GitHub
- Make sure you're using the latest version

---

**Enjoy streaming! **
