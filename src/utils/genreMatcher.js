/**
 * Smart Genre Matching System
 * 
 * Provides intelligent genre matching with:
 * - Synonym/alias matching (90 points)
 * - 2-level parent-child hierarchy matching (70-80 points)
 * - Explicit exclusion rules to prevent false positives
 * - Canonical genre normalization across providers
 * 
 * Threshold for inclusion: >= 70 points
 */

const logger = require('./logger');

// ============================================================================
// CANONICAL GENRE SET
// All providers (HentaiMama, HentaiSea, HentaiTV) normalize to these canonical genres
// ============================================================================

const CANONICAL_GENRES = [
  // Content Types
  '3d', 'action', 'adventure', 'comedy', 'drama', 'ecchi', 'fantasy', 'historical',
  'horror', 'martial-arts', 'plot', 'romance', 'sci-fi', 'short', 'softcore', 
  'sports', 'supernatural', 'vanilla',
  
  // Character Types
  'animal-girls', 'bunny-girl', 'cat-girl', 'fox-girl', 'demon', 'elf', 'furry',
  'futanari', 'gyaru', 'idol', 'magical-girls', 'maid', 'megane', 'milf', 
  'monster', 'monster-girl', 'nekomimi', 'nun', 'nurse', 'office-lady', 'orc',
  'police', 'princess', 'queen-bee', 'schoolgirl', 'succubus', 'teacher', 
  'female-teacher', 'doctor', 'female-doctor', 'trap', 'tsundere', 'twin-tail',
  'twins', 'ugly-bastard', 'vampire', 'widow', 'housewife',
  
  // Body Features
  'ahegao', 'big-boobs', 'big-ass', 'dark-skin', 'glasses', 'lactation',
  'large-breasts', 'pregnant', 'small-breasts', 'stockings', 'swimsuit',
  'pantyhose', 'shimapan',
  
  // Actions/Positions
  'anal', 'blowjob', 'boobjob', 'cowgirl', 'creampie', 'cunnilingus', 'deepthroat',
  'doggy-style', 'double-penetration', 'facial', 'facesitting', 'fingering',
  'footjob', 'gangbang', 'group-sex', 'handjob', 'masturbation', 'missionary',
  'oral', 'orgy', 'paizuri', 'pov', 'public-sex', 'reverse-cowgirl', 'rimjob',
  'squirting', 'threesome', 'titfuck', 'x-ray',
  
  // Fetishes/Themes
  'bdsm', 'blackmail', 'bondage', 'brainwashed', 'bukkake', 'cheating',
  'corruption', 'cosplay', 'cross-dressing', 'dildo', 'domination', 'drugs',
  'femdom', 'filmed', 'humiliation', 'incest', 'inflation', 'loli', 'mind-break',
  'mind-control', 'molestation', 'ntr', 'rape', 'reverse-rape', 'scat', 'shota',
  'slave', 'tentacle', 'toys', 'train-molestation', 'urination', 'virgin',
  'watersports', 'condom',
  
  // Technical/Format
  'censored', 'uncensored', 'dubbed', 'hd', 'subbed',
  
  // Orientation
  'harem', 'yaoi', 'yuri'
];

// ============================================================================
// SYNONYM GROUPS
// Maps alternative names to canonical genre names (90 points match)
// ============================================================================

const GENRE_SYNONYM_GROUPS = {
  // Animal-themed character genres
  'animal-girls': ['animal ears', 'animal-ears', 'kemonomimi', 'animal girl', 'kemono'],
  'cat-girl': ['catgirl', 'neko', 'cat-girl'],
  'nekomimi': ['neko-mimi', 'cat ears'],
  'fox-girl': ['foxgirl', 'kitsune', 'fox-girl'],
  'bunny-girl': ['rabbit girl', 'usagi', 'bunny-girl'],
  
  // Body type/feature genres
  'big-boobs': ['big boobs', 'big breasts', 'large breasts', 'oppai', 'busty', 'big tits', 'huge breasts'],
  'small-breasts': ['small boobs', 'flat chest', 'petite', 'tiny breasts', 'small tits'],
  'big-ass': ['big butt', 'thicc', 'thick'],
  
  // Action synonyms
  'blowjob': ['blow job', 'blow-job', 'fellatio', 'bj'],
  'handjob': ['hand job', 'hand-job', 'hj'],
  'footjob': ['foot job', 'foot-job'],
  'boobjob': ['boob job', 'boob-job', 'paizuri', 'tits fuck', 'titjob', 'titfuck', 'tit fuck'],
  'creampie': ['cream pie', 'cream-pie', 'internal cumshot', 'nakadashi', 'internal shot'],
  'double-penetration': ['dp', 'double-penetration', 'double penetration'],
  'oral': ['oral sex', 'oral-sex'],
  'rimjob': ['rim job', 'rim-job', 'analingus'],
  'doggy-style': ['doggy style', 'doggystyle', 'doggy'],
  'gangbang': ['gang bang', 'gang-bang'],
  'threesome': ['3p', 'three some', 'threeway', '3some', 'three-way'],
  
  // Relationship/role genres
  'schoolgirl': ['school girl', 'school-girl', 'school girls', 'jk', 'joshi kousei', 'highschool girl'],
  'teacher': ['sensei'],
  'female-teacher': ['woman teacher', 'lady teacher'],
  'nurse': ['nurses'],
  'office-lady': ['office ladies', 'ol', 'office worker'],
  'housewife': ['house wife', 'house-wife'],
  
  // Content themes
  'ntr': ['netorare', 'cuckold'],
  'cheating': ['affair', 'adultery', 'infidelity'],
  'incest': ['family', 'relative'],
  
  // Monster types  
  'tentacle': ['tentac', 'tentacles', 'tentacle monster'],
  
  // Format/technical
  'hd': ['high definition', '1080p', '720p', 'high quality'],
  
  // Others
  'futanari': ['futa', 'dickgirl', 'hermaphrodite'],
  'shota': ['shoutacon', 'shotacon', 'young boy'],
  'loli': ['lolicon', 'young girl'],
  'virgin': ['virgins', 'first time', 'defloration'],
  'toys': ['sex toys', 'sex-toys', 'vibrator', 'dildo'],
  'ugly-bastard': ['ugly bastard', 'ugly-bastard', 'old man', 'fat man', 'ojisan'],
  'mind-control': ['mind control', 'hypnosis', 'hypnotism'],
  'mind-break': ['mind break', 'mindbreak', 'broken'],
  'bdsm': ['sm', 's&m', 'sadomasochism'],
  'cross-dressing': ['crossdressing', 'crossdress', 'trap'],
  'train-molestation': ['train groping', 'chikan'],
  'watersports': ['golden shower', 'pee', 'piss'],
  'milf': ['mature', 'mother', 'mom', 'oba-san'],
  'monster-girl': ['monstergirl', 'monster musume'],
  'magical-girls': ['mahou shoujo', 'magical girl'],
  'gyaru': ['gal', 'kogal'],
  'tsundere': ['tsun'],
  'ahegao': ['fucked silly', 'orgasm face'],
  'pov': ['point of view', 'first person'],
  'vanilla': ['wholesome', 'romantic', 'sweet', 'love'],
  'filmed': ['recording', 'voyeur', 'hidden camera'],
  'reverse-rape': ['reverse rape', 'female dominance rape'],
  'public-sex': ['public sex', 'outdoor sex', 'exhibition'],
  'group-sex': ['group sex', 'multiple partners'],
  'condom': ['safe sex', 'protected'],
  'squirting': ['female ejaculation'],
  'facesitting': ['face sitting', 'face-sitting'],
  'deepthroat': ['deep throat', 'deep-throat', 'irrumatio'],
  'femdom': ['female domination', 'female dom', 'dominatrix'],
  'bukkake': ['cum bath', 'facial group'],
  'inflation': ['belly inflation', 'cum inflation'],
  'corruption': ['moral degradation', 'fall'],
  'brainwashed': ['brainwash', 'brain wash', 'reprogramming'],
  'molestation': ['groping', 'chikan', 'touching'],
  'humiliation': ['degradation', 'shame'],
  'blackmail': ['coercion', 'extortion', 'threatening']
};

// ============================================================================
// PARENT-CHILD HIERARCHIES (2 levels deep)
// Parent → [children] (70 points for parent-to-child match)
// Grandparent → Parent → [children] supported
// ============================================================================

const GENRE_HIERARCHIES = {
  // Level 1: Animal Girls is parent of specific animal types
  'animal-girls': {
    children: ['cat-girl', 'fox-girl', 'bunny-girl', 'nekomimi', 'dog-girl', 'wolf-girl'],
    // No grandchildren for these
  },
  
  // Level 1: Teacher hierarchy
  'teacher': {
    children: ['female-teacher', 'male-teacher'],
  },
  
  // Level 1: Doctor hierarchy  
  'doctor': {
    children: ['female-doctor', 'male-doctor', 'nurse'],
  },
  
  // Level 1: Medical (grandparent of nurse)
  'medical': {
    children: ['doctor', 'nurse'],
    // doctor has its own children (female-doctor, male-doctor)
  },
  
  // Level 1: Monster types
  'monster': {
    children: ['monster-girl', 'orc', 'tentacle', 'demon', 'vampire', 'succubus'],
  },
  
  // Level 1: BDSM umbrella
  'bdsm': {
    children: ['bondage', 'slave', 'domination', 'femdom', 'humiliation', 'discipline'],
  },
  
  // Level 1: Group sex umbrella
  'group-sex': {
    children: ['gangbang', 'orgy', 'threesome', 'bukkake'],
  },
  
  // Level 1: Incest umbrella (family relations)
  'incest': {
    children: ['sister', 'step-sister', 'step-mother', 'step-daughter', 'mother', 'aunt'],
  },
  
  // Level 1: School setting
  'school': {
    children: ['schoolgirl', 'teacher', 'female-teacher', 'school-uniform'],
  },
  
  // Level 1: Oral umbrella
  'oral': {
    children: ['blowjob', 'cunnilingus', 'deepthroat', 'facesitting', 'rimjob'],
  },
  
  // Level 1: Big breasts umbrella
  'big-boobs': {
    children: ['large-breasts', 'huge-breasts', 'oppai', 'boobjob', 'paizuri'],
  },
  
  // Level 1: Mind alteration
  'mind-control': {
    children: ['mind-break', 'brainwashed', 'hypnosis', 'corruption'],
  },
  
  // Level 1: Non-consent umbrella
  'non-consent': {
    children: ['rape', 'molestation', 'blackmail', 'drugged'],
  },
  
  // Level 1: Fetish wear
  'clothing': {
    children: ['stockings', 'pantyhose', 'swimsuit', 'cosplay', 'maid', 'nurse-uniform'],
  }
};

// ============================================================================
// EXPLICIT EXCLUSIONS
// These genre pairs should NEVER match each other (0 points)
// ============================================================================

const GENRE_EXCLUSIONS = {
  // Role exclusions - these are different professions
  'female-teacher': ['female-doctor', 'nurse', 'maid', 'office-lady', 'police'],
  'female-doctor': ['female-teacher', 'nurse', 'maid'],
  'teacher': ['doctor', 'nurse', 'maid'],
  'doctor': ['teacher', 'maid'],
  'nurse': ['teacher', 'maid', 'office-lady'],
  'maid': ['nurse', 'teacher', 'doctor', 'office-lady'],
  
  // Orientation exclusions - never confuse these
  'yaoi': ['yuri', 'harem'],
  'yuri': ['yaoi', 'harem'],
  
  // Size opposites - never confuse
  'big-boobs': ['small-breasts', 'flat-chest', 'petite'],
  'small-breasts': ['big-boobs', 'large-breasts', 'huge-breasts', 'oppai'],
  
  // Censoring opposites
  'censored': ['uncensored'],
  'uncensored': ['censored'],
  
  // Specific exclusions to prevent false positives
  '3d': ['3', 'third', '3rd'], // Prevent "3" in title matching "3D" genre
  
  // Consent-related - keep separate
  'vanilla': ['rape', 'ntr', 'blackmail', 'mind-break', 'non-consent'],
  'romance': ['rape', 'ntr', 'blackmail'],
  
  // Age-related - never confuse
  'milf': ['loli', 'schoolgirl'],
  'loli': ['milf', 'mature', 'housewife'],
  'shota': ['milf', 'mature'],
  
  // Relationship types - different concepts
  'ntr': ['vanilla', 'romance'],
  'cheating': ['virgin', 'first-time'],
  
  // Format exclusions
  'short': ['full', 'long', 'movie'],
};

// ============================================================================
// PROVIDER-SPECIFIC SLUG MAPPINGS
// Maps display genre names to URL slugs for each provider
// ============================================================================

const PROVIDER_SLUG_MAPS = {
  hentaimama: {
    'animal girls': 'animal-ears',
    'cat girl': 'nekomimi',
    'boob job': 'paizuri',
    'blow job': 'blowjob',
    'hand job': 'handjob',
    'foot job': 'footjob',
    'cream pie': 'creampie',
    'school girl': 'school-girl',
    'school girls': 'school-girl',
    'large breasts': 'big-boobs',
    'sex toys': 'toys',
    'double penetration': 'dp',
    'group sex': 'gangbang',
    'oral sex': 'blowjob',
    'rim job': 'rimjob',
    'cute & funny': 'cute-funny',
    'office ladies': 'office-lady',
    'female teacher': 'female-teacher',
    'female doctor': 'female-doctor',
    'step daughter': 'step-family',
    'step mother': 'step-family',
    'step sister': 'step-family',
    'ugly bastard': 'ugly-bastard',
    'mind break': 'mind-break',
    'mind control': 'mind-control',
    'public sex': 'public-sex',
    'reverse rape': 'reverse-rape',
    'dark skin': 'dark-skin',
    'big boobs': 'big-boobs',
    'big ass': 'big-ass',
    'monster girl': 'monster-girl',
    'magical girls': 'magical-girl',
    'doggy style': 'doggy-style',
    'train molestation': 'train-molestation',
  },
  
  hentaisea: {
    'animal girls': 'animal-ears',
    'big boobs': 'big-tits',
    'school girl': 'schoolgirl',
  },
  
  hentaitv: {
    'big boobs': 'big-boobs',
    'blow job': 'blowjob',
    'Blow Jow': 'blowjob', // Typo on their site
    'boob job': 'paizuri',
    'cream pie': 'creampie',
    'Cream Pie': 'creampie',
    'dark skin': 'dark-skin',
    'Doggy Style': 'doggy-style',
    'foot job': 'footjob',
    'hand job': 'handjob',
    'mind break': 'mind-break',
    'mind control': 'mind-control',
    'public sex': 'public-sex',
    'reverse rape': 'reverse-rape',
    'school girl': 'schoolgirl',
    'ugly bastard': 'ugly-bastard',
    'Oral': 'oral',
    'Short': 'short',
  }
};

// ============================================================================
// GENRE MATCHER CLASS
// ============================================================================

class GenreMatcher {
  constructor() {
    this.synonymGroups = GENRE_SYNONYM_GROUPS;
    this.hierarchies = GENRE_HIERARCHIES;
    this.exclusions = GENRE_EXCLUSIONS;
    this.providerSlugMaps = PROVIDER_SLUG_MAPS;
    this.canonicalGenres = new Set(CANONICAL_GENRES);
    
    // Build reverse lookup for synonyms (alias → canonical)
    this.synonymLookup = new Map();
    for (const [canonical, aliases] of Object.entries(this.synonymGroups)) {
      // Map the canonical name to itself
      this.synonymLookup.set(this.normalize(canonical), canonical);
      // Map all aliases to the canonical name
      for (const alias of aliases) {
        this.synonymLookup.set(this.normalize(alias), canonical);
      }
    }
    
    // Build parent lookup (child → parent)
    this.parentLookup = new Map();
    this.grandparentLookup = new Map();
    for (const [parent, config] of Object.entries(this.hierarchies)) {
      for (const child of config.children || []) {
        this.parentLookup.set(this.normalize(child), parent);
        
        // Check if this child has its own children (grandchildren of original parent)
        const childConfig = this.hierarchies[child];
        if (childConfig && childConfig.children) {
          for (const grandchild of childConfig.children) {
            this.grandparentLookup.set(this.normalize(grandchild), parent);
          }
        }
      }
    }
    
    logger.info(`[GenreMatcher] Initialized with ${this.synonymLookup.size} synonym mappings, ${Object.keys(this.hierarchies).length} hierarchies`);
  }
  
  /**
   * Normalize genre string for comparison
   * Removes all separators and special characters, lowercases
   */
  normalize(genre) {
    if (!genre) return '';
    return genre
      .toLowerCase()
      .trim()
      .replace(/[-_\s&]+/g, '') // Remove all separators
      .replace(/[^a-z0-9]/g, ''); // Keep only alphanumeric
  }
  
  /**
   * Get canonical form of a genre
   * Returns the normalized canonical name if found, otherwise the normalized input
   */
  getCanonical(genre) {
    const normalized = this.normalize(genre);
    return this.synonymLookup.get(normalized) || normalized;
  }
  
  /**
   * Convert display genre name to URL slug for a specific provider
   */
  getSlugForProvider(genre, provider = 'hentaimama') {
    const lowerGenre = genre.toLowerCase().trim();
    const providerMap = this.providerSlugMaps[provider] || {};
    
    // Check provider-specific mapping first
    if (providerMap[lowerGenre]) {
      return providerMap[lowerGenre];
    }
    
    // Check with original case (for HentaiTV which has mixed case)
    if (providerMap[genre]) {
      return providerMap[genre];
    }
    
    // Default: convert to kebab-case slug
    return lowerGenre
      .replace(/\s+/g, '-')
      .replace(/&/g, '-and-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  
  /**
   * Check if two genres are explicitly excluded from matching
   */
  isExcluded(genre1, genre2) {
    const canon1 = this.getCanonical(genre1);
    const canon2 = this.getCanonical(genre2);
    
    const exclusions1 = this.exclusions[canon1] || [];
    const exclusions2 = this.exclusions[canon2] || [];
    
    // Check both directions
    const excluded = exclusions1.some(e => this.normalize(e) === this.normalize(canon2)) ||
                     exclusions2.some(e => this.normalize(e) === this.normalize(canon1));
    
    return excluded;
  }
  
  /**
   * Calculate match score between a filter genre and a series genre
   * @param {string} filterGenre - The genre user is filtering by
   * @param {string} seriesGenre - A genre tag on the series
   * @returns {number} Score 0-100
   */
  calculateScore(filterGenre, seriesGenre) {
    if (!filterGenre || !seriesGenre) return 0;
    
    const normFilter = this.normalize(filterGenre);
    const normSeries = this.normalize(seriesGenre);
    
    // Empty check
    if (!normFilter || !normSeries) return 0;
    
    // Check exclusions first - these should never match
    if (this.isExcluded(filterGenre, seriesGenre)) {
      return 0;
    }
    
    // Exact match after normalization (100 points)
    if (normFilter === normSeries) {
      return 100;
    }
    
    // Synonym match - same canonical form (90 points)
    const canonFilter = this.getCanonical(filterGenre);
    const canonSeries = this.getCanonical(seriesGenre);
    
    if (canonFilter === canonSeries) {
      return 90;
    }
    
    // Parent-child relationship (70-80 points)
    // Case 1: User filters by parent, series has child (80 points - strong match)
    const childrenConfig = this.hierarchies[canonFilter];
    if (childrenConfig && childrenConfig.children) {
      const childCanonicals = childrenConfig.children.map(c => this.normalize(c));
      if (childCanonicals.includes(this.normalize(canonSeries))) {
        return 80;
      }
      
      // Check grandchildren (2 levels deep) - 70 points
      for (const child of childrenConfig.children) {
        const grandchildConfig = this.hierarchies[child];
        if (grandchildConfig && grandchildConfig.children) {
          const grandchildCanonicals = grandchildConfig.children.map(gc => this.normalize(gc));
          if (grandchildCanonicals.includes(this.normalize(canonSeries))) {
            return 70;
          }
        }
      }
    }
    
    // Case 2: User filters by child, series has parent (60 points - weaker match)
    const parentOfFilter = this.parentLookup.get(normFilter);
    if (parentOfFilter && this.normalize(parentOfFilter) === this.normalize(canonSeries)) {
      return 60;
    }
    
    // Case 3: Grandparent relationship (55 points - weakest hierarchical match)
    const grandparentOfFilter = this.grandparentLookup.get(normFilter);
    if (grandparentOfFilter && this.normalize(grandparentOfFilter) === this.normalize(canonSeries)) {
      return 55;
    }
    
    // No match
    return 0;
  }
  
  /**
   * Check if a series matches a filter genre
   * @param {string} filterGenre - Genre user is filtering by
   * @param {Array<string>} seriesGenres - All genres on the series
   * @param {number} threshold - Minimum score for match (default 70)
   * @returns {boolean}
   */
  matches(filterGenre, seriesGenres, threshold = 70) {
    if (!seriesGenres || !Array.isArray(seriesGenres) || seriesGenres.length === 0) {
      return false;
    }
    
    for (const seriesGenre of seriesGenres) {
      const score = this.calculateScore(filterGenre, seriesGenre);
      if (score >= threshold) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Get best match score for a series
   * @param {string} filterGenre - Genre user is filtering by
   * @param {Array<string>} seriesGenres - All genres on the series
   * @returns {number} Best score found (0-100)
   */
  getBestScore(filterGenre, seriesGenres) {
    if (!seriesGenres || !Array.isArray(seriesGenres)) return 0;
    
    let bestScore = 0;
    for (const seriesGenre of seriesGenres) {
      const score = this.calculateScore(filterGenre, seriesGenre);
      if (score > bestScore) {
        bestScore = score;
        if (bestScore === 100) break; // Can't do better than exact match
      }
    }
    
    return bestScore;
  }
  
  /**
   * Normalize a genre to its canonical form
   * Useful for aggregating/deduplicating genres from different providers
   */
  toCanonical(genre) {
    return this.getCanonical(genre);
  }
  
  /**
   * Normalize an array of genres to canonical forms, removing duplicates
   */
  normalizeGenres(genres) {
    if (!genres || !Array.isArray(genres)) return [];
    
    const seen = new Set();
    const result = [];
    
    for (const genre of genres) {
      const canonical = this.getCanonical(genre);
      if (!seen.has(canonical)) {
        seen.add(canonical);
        // Return the display-friendly version (capitalize first letters)
        result.push(this.toDisplayName(canonical));
      }
    }
    
    return result;
  }
  
  /**
   * Convert canonical/normalized genre to display-friendly format
   */
  toDisplayName(genre) {
    if (!genre) return '';
    return genre
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }
  
  /**
   * Check if a genre exists in our canonical set
   */
  isKnownGenre(genre) {
    const canonical = this.getCanonical(genre);
    return this.canonicalGenres.has(canonical);
  }
}

// Singleton instance
const genreMatcher = new GenreMatcher();

module.exports = { 
  GenreMatcher, 
  genreMatcher,
  CANONICAL_GENRES,
  GENRE_SYNONYM_GROUPS,
  GENRE_HIERARCHIES,
  GENRE_EXCLUSIONS,
  PROVIDER_SLUG_MAPS
};
