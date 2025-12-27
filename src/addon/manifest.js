const config = require('../config/env');

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

// Studio/Brand list - Combined from HentaiMama, HentaiTV, and HentaiSea
// Prioritizing properly capitalized names over all-caps variants
const STUDIO_OPTIONS = [
  "@ OZ", "#1ma Made de Ichiban Yokatta Sex The Animation", "37c-Binetsu",
  "8bit", "Actas", "Active", "Adult Source Media", "AIC", "AIC A.S.T.A.",
  "Ajia-Do", "Alice Soft", "Almond Collective", "Alpha Polis", "Ameliatie",
  "Amour", "An DerCen", "Angelfish", "Animac", "Anime Antenna Iinkai",
  "AniMan", "AnimeFesta", "Animax", "Antechinus", "APPP", "Armor", "Arms",
  "Asahi Production", "AT-2", "Bishop", "Blue Eyes", "BOMB! CUTE! BOMB!",
  "Bootleg", "BreakBottle", "BugBug", "Bunnywalker", "Celeb", "Central Park Media",
  "CherryLips", "ChiChinoya", "Chippai", "Chocolat", "ChuChu", "Circle Tribute",
  "CLOCKUP", "CoCoans", "Collaboration Works", "Comet", "Comic Media",
  "Cosmic Ray", "Cosmo", "Cosmos", "Cotton Doll", "Cranberry", "Crimson",
  "D3", "Daiei", "demodemon", "Digital Works", "Discovery", "Dollhouse",
  "Dream Force", "Dubbed", "Easy Film", "EBIMARU-DO", "Echo", "ECOLONUN",
  "Edge", "Erozuki", "evee", "EXNOA", "FINAL FUCK 7", "Filmlink International",
  "Five Ways", "Front Line", "Frontier Works", "fruit", "Godoy", "GodoyG",
  "Gold Bear", "gomasioken", "Green Bunny", "Groover", "Himajin Planning",
  "Hokiboshi", "Hoods Entertainment", "Horipro", "Hot Bear", "HydraFXX",
  "Hykobo", "Innocent Grey", "IRONBELL", "ITONAMI", "Ivory Tower", "J.C.",
  "Jam", "JapanAnime", "Jellyfish", "Jewel", "Juicymango", "Jumondo",
  "kate_sai", "KENZsoft", "King Bee", "Kitty Films", "Kitty Media",
  "Knack", "Knack Productions", "KSS", "Kuril", "L.", "Lemon Heart", "Lilix",
  "Lune Pictures", "Magic Bus", "Magin Label", "Majin", "Majin Petit",
  "Marigold", "Marvelous Entertainment", "Mary Jane", "Media", "Media Blasters",
  "MediaBank", "Metro Notes", "Milkshake", "Milky", "MiMiA Cute", "Mitsu",
  "Moon Rock", "Moonstone Cherry", "Mousou Senka", "MS Pictures", "Muse",
  "N43", "Nag", "New generation", "Nihikime no Dozeu", "Nikkatsu Video",
  "No Future", "NuTech Digital", "nur", "Obtain Future", "Office Take Off",
  "OLE-M", "Oriental Light and Magic", "Otodeli", "Oz", "Pashmina",
  "Passione", "Peach Pie", "Pink Pineapple", "Pinkbell", "Pix", "Pixy",
  "Pixy Soft", "Pocomo Premium", "PoRO", "Production I.G", "Project No.9",
  "Pumpkin Pie", "Queen Bee", "Rabbit Gate", "Rene Pictures", "Rojiura Jack",
  "sakamotoJ", "Sakura Purin", "Sakura Purin Animation", "SANDWICHWORKS",
  "Schoolzone", "seismic", "Selfish", "Seven", "Shadow Prod. Co.", "Shelf",
  "Shinkuukan", "Shinyusha", "ShoSai", "Shouten", "Showten", "Silky's",
  "Sodeno19", "Soft Garage", "Soft on Demand", "SoftCel Pictures", "SoftCell",
  "SPEED", "STARGATE3D", "Studio 9 Maiami", "Studio Akai Shohosen",
  "Studio Deen", "Studio Eromatick", "Studio Fantasia", "Studio FOW",
  "studio GGB", "Studio Gokumi", "Studio Houkiboshi", "Studio Jack",
  "Studio Kyuuma", "Studio Matrix", "Studio Sign", "Studio Tulip",
  "Studio Unicorn", "Studio Zealot", "Suiseisha", "Suzuki Mirano", "SYLD",
  "t japan", "T-Rex", "TDK Core", "The Right Stuf International", "TNK",
  "Toho Company", "TOHO", "Top-Marschal", "Toranoana", "Torudaya",
  "Toshiba Entertainment", "Triangle", "Triangle Bitter", "Trimax",
  "Triple X", "TYS Work", "U-Jin", "Umemaro-3D", "Umemaro3D", "Union Cho",
  "Valkyria", "Vanilla", "White Bear", "X City", "XTER", "Y.O.U.C.", "yosino",
  "ZIZ", "ZIZ Entertainment", "Zyc"
];

// Year options from 1969 to 2025 (individual years)
const YEAR_OPTIONS = [
  "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016",
  "2015", "2014", "2013", "2012", "2011", "2010", "2009", "2008", "2007", "2006",
  "2005", "2004", "2003", "2002", "2001", "2000", "1999", "1998", "1997", "1996",
  "1995", "1994", "1993", "1992", "1991", "1990", "1989", "1988", "1987", "1986",
  "1985", "1984", "1983", "1982", "1981", "1980", "1979", "1978", "1977", "1976",
  "1975", "1974", "1973", "1972", "1971", "1970", "1969"
];

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
      {
        type: 'hentai',
        id: 'hentai-top-rated',
        name: 'Top Rated',
        extra: [{ name: 'search' }, { name: 'skip' }, { name: 'genre', options: GENRE_OPTIONS }],
        // Hide from home screen by default - user can enable in Browse view
        // This prevents adult content from appearing on the main home screen
        behaviorHints: { notForHome: true }
      },
      // Monthly Releases - updated in last 30 days
      // NOTE: No search on this catalog - search would bypass the date filter
      // Users should use "Top Rated" or "All Hentai" for search
      {
        type: 'hentai',
        id: 'hentai-monthly',
        name: 'New Releases',
        extra: [{ name: 'skip' }, { name: 'genre', options: GENRE_OPTIONS }],
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
        extra: [{ name: 'search' }, { name: 'skip' }, { name: 'genre', options: GENRE_OPTIONS }],
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
 */
async function addGenreCatalogs(manifest, genres) {
  // Add popular genres to the catalog list
  const popularGenres = ['uncensored', '3d', 'large-breasts', 'ntr', 'creampie', 'ahegao'];
  
  genres.forEach(genre => {
    // Only add popular genres to avoid cluttering the UI
    if (popularGenres.includes(genre.slug)) {
      manifest.catalogs.push({
        type: 'series',
        id: `hentaimama-genre-${genre.slug}`,
        name: `HentaiMama - ${genre.name}`,
        extra: [
          {
            name: 'skip',
            isRequired: false,
          },
        ],
      });
    }
  });
  
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
