const config = require('../config/env');

/**
 * Get base manifest (will be extended with genre catalogs dynamically)
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
    
    // Content types supported
    types: ['series'],
    
    // ID prefixes for routing
    idPrefixes: ['hmm-'],
    
    // Base catalogs (will be extended with genres)
    catalogs: [
      {
        type: 'series',
        id: 'hentaimama-all',
        name: 'HentaiMama',
        extra: [
          {
            name: 'skip',
            isRequired: false,
          },
          {
            name: 'genre',
            isRequired: false,
            options: [
              "3D", "Action", "Adventure", "Ahegao", "Anal", "Animal Girls", "BDSM", 
              "Big Ass", "Blackmail", "Blowjob", "Bondage", "Boob Job", "Brainwashed", 
              "Bukkake", "Bunny Girl", "Cat Girl", "Cheating", "Comedy", "Condom", 
              "Corruption", "Cosplay", "Cowgirl", "Creampie", "Cross-dressing", 
              "Cunnilingus", "Cute & Funny", "Dark Skin", "Deepthroat", "Demons", 
              "Dildo", "Doctor", "Doggy Style", "Domination", "Double Penetration", 
              "Drama", "Drugs", "Dubbed", "Ecchi", "Elf", "Eroge", "Facesitting", 
              "Facial", "Fantasy", "Female Doctor", "Female Teacher", "Femdom", 
              "Fingering", "Footjob", "Fox Girl", "Furry", "Futanari", "Gangbang", 
              "Glasses", "Group Sex", "Gyaru", "Handjob", "Harem", "Historical", 
              "Horny Slut", "Housewife", "Humiliation", "Idol", "Incest", "Inflation", 
              "Internal Cumshot", "Lactation", "Large Breasts", "Loli", "Magical Girls", 
              "Maid", "Martial Arts", "Masturbation", "Megane", "MILF", "Mind Break", 
              "Mind Control", "Missionary", "Molestation", "Monster", "Monster Girl", 
              "Non-Japanese", "NTR", "Nuns", "Nurses", "Office Ladies", "Oral Sex", 
              "Orc", "Orgy", "Paizuri", "Pantyhose", "Police", "POV", "Pregnant", 
              "Princess", "Prostitution", "Public Sex", "Queen Bee", "Rape", "Reverse Cowgirl", 
              "Rim Job", "Romance", "Scat", "School Girls", "Schoolgirl", "Sci-Fi", 
              "Sex Toys", "Shimapan", "Short", "Shota", "Shoutacon", "Sister", "Slave", 
              "Small Breasts", "Sports", "Squirting", "Step Daughter", "Step Mother", 
              "Step Sister", "Stocking", "Strap-on", "Succubus", "Super Power", 
              "Supernatural", "Swimsuit", "Teacher", "Tentacles", "Threesome", 
              "Tits Fuck", "Toys", "Train Molestation", "Tsundere", "Twin Tail", 
              "Twins", "Uncensored", "Urination", "Vampire", "Vanilla", "Virgin", 
              "Virgins", "Widow", "X-Ray", "Yaoi", "Yuri"
            ]
          }
        ],
      },
    ],
  
    // Background image for addon
    background: 'https://via.placeholder.com/1920x1080?text=HentaiStream+Addon',
    
    // Logo for addon
    logo: 'https://via.placeholder.com/256x256?text=HS',
    
    // Contact email
    contactEmail: '',
    
    // Behavioral hints
    behaviorHints: {
      adult: true,  // Mark as adult content
      configurable: false,  // Will be true in Phase 3 with config UI
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
