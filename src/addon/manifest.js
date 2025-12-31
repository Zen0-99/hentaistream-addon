const config = require('../config/env');
const fs = require('fs');
const path = require('path');

// Spam entries to filter out from both genres and studios
const SPAM_ENTRIES = [
  '[email protected]', '[email\u00a0protected]', 'email protected', 'email-protected',
  'better than e-hentai', 'better than nhentai', 'gehentai', 'noname',
  'watch hentai', 'hentai stream', 'free hentai'
];

/**
 * Check if a name is spam/invalid
 */
function isSpamEntry(name) {
  const lower = name.toLowerCase().trim();
  return SPAM_ENTRIES.some(spam => lower.includes(spam));
}

/**
 * Normalize name for comparison (case-insensitive, trim, normalize spaces)
 */
function normalizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Optimized genre list - deduplicated and essential tags only (~80 items)
const GENRE_OPTIONS = [
  // Combined genres from HentaiMama + HentaiTV
  "3D", "Action", "Adventure", "Ahegao", "Anal", "Animal Girls", "BDSM", 
  "Big Ass", "Big Boobs", "Blackmail", "Blow Job", "Blowjob", "Bondage", 
  "Boob Job", "Brainwashed", "Bukkake", "Bunny Girl", "Cat Girl", "Censored",
  "Cheating", "Comedy", "Condom", "Corruption", "Cosplay", "Cowgirl", 
  "Cream Pie", "Cross-dressing", "Cunnilingus", "Cute & Funny", 
  "Dark Skin", "Deepthroat", "Demons", "Dildo", "Doctor", "Doggy Style", 
  "Domination", "Double Penetration", "Drama", "Drugs", "Dubbed", "Ecchi", 
  "Elf", "Eroge", "Facial", "Facesitting", "Fantasy", "Female Doctor", 
  "Female Teacher", "Femdom", "Filmed", "Fingering", "Foot Job", "Footjob", 
  "Fox Girl", "Furry", "Futanari", "Gangbang", "Glasses", "Group Sex", 
  "Gyaru", "Hand Job", "Handjob", "Harem", "HD", "Historical", "Horror", 
  "Horny Slut", "Housewife", "Humiliation", "Idol", "Incest", "Inflation", 
  "Internal Cumshot", "Lactation", "Large Breasts", "Loli", "Magical Girls", 
  "Maid", "Martial Arts", "Masturbation", "Megane", "MILF", "Mind Break", 
  "Mind Control", "Missionary", "Molestation", "Monster", "Monster Girl", 
  "Nekomimi", "Non-Japanese", "NTR", "Nuns", "Nurse", "Nurses", "Office Ladies", 
  "Oral", "Oral Sex", "Orc", "Orgy", "Paizuri", "Pantyhose", "Plot", "Police", 
  "POV", "Pregnant", "Princess", "Prostitution", "Public Sex", "Queen Bee", 
  "Rape", "Reverse Cowgirl", "Reverse Rape", "Rim Job", "Rimjob", "Romance", 
  "Scat", "School Girl", "School Girls", "Schoolgirl", "Sci-Fi", "Sex Toys", 
  "Shimapan", "Short", "Shota", "Shoutacon", "Sister", "Slave", "Small Breasts", 
  "Softcore", "Sports", "Squirting", "Step Daughter", "Step Mother", "Step Sister", 
  "Stocking", "Strap-on", "Succubus", "Super Power", "Supernatural", "Swimsuit", 
  "Teacher", "Tentac", "Tentacle", "Tentacles", "Threesome", "Tits Fuck", "Toys", 
  "Train Molestation", "Trap", "Tsundere", "Twin Tail", "Twins", "Ugly Bastard",
  "Uncensored", "Urination", "Vampire", "Vanilla", "Virgin", "Virgins", 
  "Watersports", "Widow", "X-Ray", "Yaoi", "Yuri"
];

/**
 * Load dynamic filter options from database analysis
 * Falls back to defaults if analysis file not found
 */
function loadFilterOptions() {
  const optionsPath = path.join(__dirname, '..', '..', 'data', 'filter-options.json');
  
  try {
    if (fs.existsSync(optionsPath)) {
      const options = JSON.parse(fs.readFileSync(optionsPath, 'utf8'));
      return options;
    }
  } catch (err) {
    console.warn('[Manifest] Could not load filter-options.json:', err.message);
  }
  
  return null;
}

/**
 * Get studio options with counts, properly formatted
 * Truncates long names and includes series count
 */
function getStudioOptions() {
  const options = loadFilterOptions();
  
  if (options?.studios?.withCounts) {
    // Deduplicate studios by normalized name (case-insensitive)
    // Keep the entry with highest count
    const studioMap = new Map();
    
    for (const entry of options.studios.withCounts) {
      const match = entry.match(/^(.+?)\s*\((\d+)\)$/);
      if (!match) continue;
      
      const name = match[1].trim();
      const count = parseInt(match[2]);
      
      // Skip spam entries
      if (isSpamEntry(name)) continue;
      
      // Skip entries with count < 2
      if (count < 2) continue;
      
      const normalizedKey = normalizeName(name);
      const existing = studioMap.get(normalizedKey);
      
      if (!existing || count > existing.count) {
        // Keep the version with proper capitalization (prefer Title Case)
        studioMap.set(normalizedKey, { name, count, entry: `${name} (${count})` });
      } else if (count === existing.count) {
        // If same count, merge counts and prefer better capitalization
        const betterName = name.charAt(0) === name.charAt(0).toUpperCase() ? name : existing.name;
        const mergedCount = existing.count + count;
        studioMap.set(normalizedKey, { name: betterName, count: mergedCount, entry: `${betterName} (${mergedCount})` });
      }
    }
    
    // Convert to array and sort alphabetically
    return Array.from(studioMap.values())
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map(s => s.entry)
      .slice(0, 200);
  }
  
  // Fallback to static list
  return getDefaultStudioOptions();
}

/**
 * Get year options with counts
 */
function getYearOptions() {
  const options = loadFilterOptions();
  
  if (options?.years?.withCounts) {
    // Deduplicate years (take highest count for each year)
    const yearMap = new Map();
    for (const opt of options.years.withCounts) {
      const match = opt.match(/^(\d{4})\s*\((\d+)\)$/);
      if (match) {
        const year = match[1];
        const count = parseInt(match[2]);
        const existing = yearMap.get(year);
        if (!existing || count > existing.count) {
          yearMap.set(year, { year, count });
        }
      }
    }
    
    // Convert back to formatted strings, sorted by year descending
    return Array.from(yearMap.values())
      .sort((a, b) => parseInt(b.year) - parseInt(a.year))
      .filter(y => y.count > 0)
      .map(y => `${y.year} (${y.count})`);
  }
  
  // Fallback to static list
  return getDefaultYearOptions();
}

/**
 * Get genre options with counts from database
 * Sorted by count (most popular first)
 */
function getGenreOptions() {
  const options = loadFilterOptions();
  
  // Genre synonyms - map variations to canonical name
  const GENRE_SYNONYMS = {
    '3d hentai': '3d',
    'blow job': 'blowjob',
    'boob job': 'paizuri',
    'tits fuck': 'paizuri',
    'cream pie': 'creampie',
    'foot job': 'footjob',
    'hand job': 'handjob',
    'rim job': 'rimjob',
    'school girl': 'schoolgirl',
    'school girls': 'schoolgirl',
    'female students': 'schoolgirl',
    'virgin': 'virgin',
    'virgins': 'virgin',
    'nurse': 'nurse',
    'nurses': 'nurse',
    'tentacle': 'tentacles',
    'tentac': 'tentacles',
    'oral': 'oral sex',
    'big tits': 'big boobs',
    'large breasts': 'big boobs',
    'big bust': 'big boobs',
    'oppai': 'big boobs',
    'group': 'group sex',
    'young': 'loli',
    'shoutacon': 'shota',
    'forced': 'rape'
  };
  
  // Canonical genre names (the preferred display name)
  const CANONICAL_GENRES = new Set([
    '3d', 'action', 'adventure', 'ahegao', 'anal', 'animal girls', 'bdsm',
    'big ass', 'big boobs', 'blackmail', 'blowjob', 'bondage', 'brainwashed',
    'bukkake', 'bunny girl', 'cat girl', 'censored', 'cheating', 'comedy',
    'condom', 'corruption', 'cosplay', 'cowgirl', 'creampie', 'cross-dressing',
    'cunnilingus', 'cute & funny', 'dark skin', 'deepthroat', 'demons', 'dildo',
    'doctor', 'doggy style', 'domination', 'double penetration', 'drama', 'drugs',
    'dubbed', 'ecchi', 'elf', 'eroge', 'facial', 'facesitting', 'fantasy',
    'female doctor', 'female teacher', 'femdom', 'filmed', 'fingering', 'footjob',
    'fox girl', 'furry', 'futanari', 'gangbang', 'glasses', 'group sex', 'gyaru',
    'handjob', 'harem', 'hd', 'historical', 'horror', 'horny slut', 'housewife',
    'humiliation', 'idol', 'incest', 'inflation', 'internal cumshot', 'lactation',
    'loli', 'magical girls', 'maid', 'martial arts', 'masturbation', 'megane',
    'milf', 'mind break', 'mind control', 'missionary', 'molestation', 'monster',
    'monster girl', 'nekomimi', 'non-japanese', 'ntr', 'nuns', 'nurse',
    'office ladies', 'oral sex', 'orc', 'orgy', 'paizuri', 'pantyhose', 'plot',
    'police', 'pov', 'pregnant', 'princess', 'prostitution', 'public sex',
    'rape', 'reverse cowgirl', 'reverse rape', 'rimjob', 'romance', 'scat',
    'schoolgirl', 'sci-fi', 'sex toys', 'shimapan', 'short', 'shota', 'sister',
    'slave', 'small breasts', 'softcore', 'sports', 'squirting', 'step daughter',
    'step mother', 'step sister', 'stocking', 'strap-on', 'succubus', 'super power',
    'supernatural', 'swimsuit', 'teacher', 'tentacles', 'threesome', 'toys',
    'train molestation', 'trap', 'tsundere', 'twin tail', 'twins', 'ugly bastard',
    'uncensored', 'urination', 'vampire', 'vanilla', 'virgin', 'watersports',
    'widow', 'x-ray', 'yaoi', 'yuri'
  ]);
  
  if (options?.genres?.withCounts) {
    // Deduplicate and filter to only valid genres
    const genreMap = new Map();
    
    for (const entry of options.genres.withCounts) {
      const match = entry.match(/^(.+?)\s*\((\d+)\)$/);
      if (!match) continue;
      
      const name = match[1].trim();
      const count = parseInt(match[2]);
      
      // Skip spam entries
      if (isSpamEntry(name)) continue;
      
      // Normalize for comparison
      let normalizedKey = normalizeName(name);
      
      // Apply synonym mapping
      if (GENRE_SYNONYMS[normalizedKey]) {
        normalizedKey = GENRE_SYNONYMS[normalizedKey];
      }
      
      // Only include if it's a canonical genre
      if (!CANONICAL_GENRES.has(normalizedKey)) continue;
      
      const existing = genreMap.get(normalizedKey);
      
      if (!existing) {
        // Get proper display name (Title Case)
        const displayName = normalizedKey.split(' ').map(w => 
          w.charAt(0).toUpperCase() + w.slice(1)
        ).join(' ').replace('Bdsm', 'BDSM').replace('Hd', 'HD').replace('Milf', 'MILF')
         .replace('Ntr', 'NTR').replace('Pov', 'POV').replace('3d', '3D');
        genreMap.set(normalizedKey, { name: displayName, count });
      } else {
        // Merge counts for duplicates/synonyms
        existing.count += count;
      }
    }
    
    // Convert to array and sort alphabetically
    return Array.from(genreMap.values())
      .filter(g => g.count >= 2)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map(g => `${g.name} (${g.count})`)
      .slice(0, 200);
  }
  
  // Fallback to static GENRE_OPTIONS (without counts)
  return GENRE_OPTIONS;
}

/**
 * Get time period options for New Releases catalog
 * Shows This Week, This Month, 3 Months, This Year with counts
 * 
 * DYNAMIC: Calculates counts fresh from database on each manifest request
 * This ensures counts update when time passes (e.g., items fall out of "This Week")
 */
function getTimePeriodOptions() {
  // Try to calculate dynamically from database
  try {
    const databaseLoader = require('../utils/databaseLoader');
    
    if (databaseLoader.isReady()) {
      const db = databaseLoader.getCatalog();
      
      if (db && db.length > 0) {
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        
        const counts = {
          'This Week': 0,
          'This Month': 0,
          '3 Months': 0,
          'This Year': 0
        };
        
        for (const item of db) {
          const lastUpdated = item.lastUpdated || item.releaseInfo;
          if (!lastUpdated) continue;
          
          const itemDate = new Date(lastUpdated);
          if (isNaN(itemDate.getTime())) continue;
          
          if (itemDate >= oneWeekAgo) counts['This Week']++;
          if (itemDate >= oneMonthAgo) counts['This Month']++;
          if (itemDate >= threeMonthsAgo) counts['3 Months']++;
          if (itemDate >= oneYearAgo) counts['This Year']++;
        }
        
        return Object.entries(counts).map(([period, count]) => `${period} (${count})`);
      }
    }
  } catch (err) {
    // Database not loaded yet (startup), fall back to file
  }
  
  // Fall back to filter-options.json (used during startup before database loads)
  const options = loadFilterOptions();
  if (options?.timePeriods?.withCounts) {
    return options.timePeriods.withCounts;
  }
  
  // Fallback to static list (without counts)
  return ["This Week", "This Month", "3 Months", "This Year"];
}

/**
 * Default studio options (fallback)
 */
function getDefaultStudioOptions() {
  return [
    "Pink Pineapple", "Queen Bee", "Mary Jane", "PoRO", "T-Rex",
    "Green Bunny", "Suzuki Mirano", "Vanilla", "Discovery", "Bunnywalker"
  ];
}

/**
 * Default year options (fallback)
 */
function getDefaultYearOptions() {
  const years = [];
  for (let y = 2025; y >= 1990; y--) {
    years.push(String(y));
  }
  return years;
}

// Load dynamic options
const STUDIO_OPTIONS = getStudioOptions();
const YEAR_OPTIONS = getYearOptions();
const DYNAMIC_GENRE_OPTIONS = getGenreOptions();
const TIME_PERIOD_OPTIONS = getTimePeriodOptions();

/**
 * Get base manifest with custom 'hentai' content type
 * Multiple catalogs for different sorting/filtering options
 */
function getBaseManifest() {
  return {
    id: config.addon.id,
    version: config.addon.version,
    name: config.addon.name,
    description: config.addon.description,
    
    // Resources provided by this addon
    resources: [
      'catalog',
      'meta',
      'stream',
    ],
    
    // Custom content type 'hentai' - appears as separate type in Stremio Discover
    // Also include 'series' because our meta objects return type='series' for display
    // This tells Stremio we can provide streams for series content
    types: ['hentai', 'series'],
    
    // ID prefixes for routing (all supported providers)
    idPrefixes: ['hmm-', 'hse-', 'htv-', 'hs-'],
    
    // Multiple catalogs for different sorting/filtering options
    catalogs: [
      // Top Rated - sorted by rating (DEFAULT)
      // NOTE: No search on this catalog - users should use "All Hentai" for search
      {
        type: 'hentai',
        id: 'hentai-top-rated',
        name: 'Top Rated',
        extra: [{ name: 'skip' }, { name: 'genre', options: DYNAMIC_GENRE_OPTIONS }],
        // Hide from home screen by default - user can enable in Browse view
        // This prevents adult content from appearing on the main home screen
        behaviorHints: { notForHome: true }
      },
      // New Releases - filter by time period (This Week, This Month, etc.)
      // NOTE: No search on this catalog - search would bypass the date filter
      // Users should use "Top Rated" or "All Hentai" for search
      // NOTE: Uses getTimePeriodOptions() directly for DYNAMIC counts
      {
        type: 'hentai',
        id: 'hentai-monthly',
        name: 'New Releases',
        extra: [{ name: 'skip' }, { name: 'genre', options: getTimePeriodOptions() }],
        behaviorHints: { notForHome: true }
      },
      // Studios - filter by animation studio
      {
        type: 'hentai',
        id: 'hentai-studios',
        name: 'Studios',
        extra: [{ name: 'skip' }, { name: 'genre', options: STUDIO_OPTIONS }],
        behaviorHints: { notForHome: true }
      },
      // Release Year - filter by year
      {
        type: 'hentai',
        id: 'hentai-years',
        name: 'Release Year',
        extra: [{ name: 'skip' }, { name: 'genre', options: YEAR_OPTIONS }],
        behaviorHints: { notForHome: true }
      },
      // All Hentai - with genre filter and search
      {
        type: 'hentai',
        id: 'hentai-all',
        name: 'All Hentai',
        extra: [{ name: 'search' }, { name: 'skip' }, { name: 'genre', options: DYNAMIC_GENRE_OPTIONS }],
        behaviorHints: { notForHome: true }
      },
      // Search-only catalog (isRequired: true means this catalog ONLY handles search)
      // This ensures Stremio always routes search queries here
      // Pattern from Anime Kitsu addon
      // Hidden from UI but functional for search routing
      {
        type: 'hentai',
        id: 'hentai-search',
        name: 'Search Hentai',
        extra: [
          { name: 'search', isRequired: true },
          { name: 'skip' }
        ],
        // Hide from all catalog views - only used for search routing
        behaviorHints: { notForHome: true }
      },
    ],
  
    // Background image for addon
    background: `${config.server.baseUrl}/logo.png`,
    
    // Logo for addon (served from /public folder)
    logo: `${config.server.baseUrl}/logo.png`,
    
    // Contact email
    contactEmail: '',
    
    // Behavioral hints
    behaviorHints: {
      adult: true,  // Mark as adult content
      configurable: true,  // Will be true in Phase 3 with config UI
      configurationRequired: false,
    },
  };
}

/**
 * Add genre catalogs to manifest
 * NOTE: All catalogs are hidden from home screen by default
 */
async function addGenreCatalogs(manifest, genres) {
  // DISABLED: Don't add additional genre catalogs to avoid cluttering
  // Users can use the genre filter in the main catalogs instead
  // These were appearing on the home screen which we don't want
  
  // If we ever re-enable this, make sure to add:
  // behaviorHints: { notForHome: true }
  // to each catalog
  
  return manifest;
}

/**
 * Get manifest with dynamic genre catalogs
 */
async function getManifest() {
  const manifest = getBaseManifest();
  
  // Try to add genre catalogs (non-blocking)
  try {
    const hentaimamaScraper = require('../scrapers/hentaimama');
    const genres = await hentaimamaScraper.getGenres();
    if (genres && genres.length > 0) {
      await addGenreCatalogs(manifest, genres);
    }
  } catch (error) {
    // Silently fail - just return base manifest
  }
  
  return manifest;
}

// Export both for backwards compatibility
module.exports = getBaseManifest();
module.exports.getManifest = getManifest;
module.exports.GENRE_OPTIONS = GENRE_OPTIONS;
module.exports.STUDIO_OPTIONS = STUDIO_OPTIONS;
module.exports.YEAR_OPTIONS = YEAR_OPTIONS;
