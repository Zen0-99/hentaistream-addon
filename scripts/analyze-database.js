#!/usr/bin/env node

/**
 * Analyze Database Script
 * 
 * Scans the database to:
 * 1. Count series per year (for year filter)
 * 2. Count series per studio (for studio filter)
 * 3. Generate valid options for manifest.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Configuration
const CONFIG = {
  dataDir: path.join(__dirname, '..', 'data'),
  catalogFile: 'catalog.json.gz',
  outputFile: 'filter-options.json',
  minSeriesForStudio: 1, // Minimum series count to include a studio
  maxStudioNameLength: 30, // Truncate long studio names
};

/**
 * Truncate long studio names
 */
function truncateStudioName(name, maxLength = CONFIG.maxStudioNameLength) {
  if (!name || name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + '...';
}

/**
 * Analyze database and generate filter options
 */
function analyzeDatabase() {
  console.log('═'.repeat(60));
  console.log('  📊 ANALYZING DATABASE');
  console.log('═'.repeat(60) + '\n');
  
  // Load database
  const catalogPath = path.join(CONFIG.dataDir, CONFIG.catalogFile);
  if (!fs.existsSync(catalogPath)) {
    console.error('❌ Database not found:', catalogPath);
    process.exit(1);
  }
  
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(catalogPath)));
  console.log(`📦 Loaded ${data.catalog.length} series\n`);
  
  // Count by year (aggregate all providers)
  const yearCounts = new Map();
  // Count by studio (case-insensitive aggregation)
  const studioCountsRaw = new Map();
  const studioCanonical = new Map(); // Lowercase -> canonical name
  // Count episodes with released dates
  let episodesTotal = 0;
  let episodesWithReleased = 0;
  
  for (const series of data.catalog) {
    // Year counting - normalize to number and use multiple sources
    let year = null;
    
    // Try explicit year field (normalize string to number)
    if (series.year) {
      year = typeof series.year === 'number' ? series.year : parseInt(String(series.year));
    }
    
    // Fallback to releaseInfo
    if (!year && series.releaseInfo) {
      const match = String(series.releaseInfo).match(/(\d{4})/);
      if (match) year = parseInt(match[1]);
    }
    
    // Fallback to lastUpdated date
    if (!year && series.lastUpdated) {
      year = new Date(series.lastUpdated).getFullYear();
    }
    
    // Only count valid years
    if (year && !isNaN(year) && year >= 1990 && year <= 2030) {
      yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    }
    
    // Studio counting (case-insensitive aggregation)
    if (series.studio) {
      const studioNorm = series.studio.trim();
      const studioLower = studioNorm.toLowerCase();
      
      // Keep the most "proper" capitalization (prefer Title Case)
      const current = studioCanonical.get(studioLower);
      if (!current || (studioNorm[0] === studioNorm[0].toUpperCase() && current[0] !== current[0].toUpperCase())) {
        studioCanonical.set(studioLower, studioNorm);
      }
      
      studioCountsRaw.set(studioLower, (studioCountsRaw.get(studioLower) || 0) + 1);
    }
    
    // Episode date counting
    if (series.episodes) {
      for (const ep of series.episodes) {
        episodesTotal++;
        if (ep.released) episodesWithReleased++;
      }
    }
  }
  
  // Build studio counts with canonical names
  const studioCounts = new Map();
  for (const [lower, count] of studioCountsRaw) {
    const canonicalName = studioCanonical.get(lower) || lower;
    // Truncate long names
    const displayName = truncateStudioName(canonicalName);
    studioCounts.set(displayName, count);
  }
  
  // Sort years descending
  const years = Array.from(yearCounts.entries())
    .sort((a, b) => b[0] - a[0])
    .filter(([year, count]) => count > 0);
  
  // Sort studios by count (descending) then alphabetically
  const studios = Array.from(studioCounts.entries())
    .filter(([studio, count]) => count >= CONFIG.minSeriesForStudio)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  
  console.log('─'.repeat(60));
  console.log('  📅 YEARS WITH CONTENT');
  console.log('─'.repeat(60));
  for (const [year, count] of years) {
    console.log(`   ${year}: ${count} series`);
  }
  
  console.log('\n─'.repeat(60));
  console.log('  🏢 TOP STUDIOS');
  console.log('─'.repeat(60));
  const topStudios = [...studios].sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [studio, count] of topStudios) {
    const displayName = truncateStudioName(studio);
    console.log(`   ${displayName}: ${count} series`);
  }
  
  console.log('\n─'.repeat(60));
  console.log('  📺 EPISODE DATES');
  console.log('─'.repeat(60));
  console.log(`   Total episodes: ${episodesTotal}`);
  console.log(`   With release date: ${episodesWithReleased} (${Math.round(episodesWithReleased/episodesTotal*100)}%)`);
  
  // Generate output for manifest.js
  const yearOptions = years.map(([year, count]) => `${year} (${count})`);
  const studioOptions = studios.map(([studio, count]) => {
    const displayName = truncateStudioName(studio);
    return `${displayName} (${count})`;
  });
  
  // Also generate clean versions (for actual filtering)
  const cleanYearOptions = years.map(([year]) => String(year));
  const cleanStudioOptions = studios.map(([studio]) => studio);
  
  const output = {
    years: {
      withCounts: yearOptions,
      clean: cleanYearOptions,
      raw: Object.fromEntries(years),
    },
    studios: {
      withCounts: studioOptions,
      clean: cleanStudioOptions,
      raw: Object.fromEntries(studios),
      total: studios.length,
    },
    episodeDates: {
      total: episodesTotal,
      withReleased: episodesWithReleased,
      percentage: Math.round(episodesWithReleased / episodesTotal * 100),
    },
    generatedAt: new Date().toISOString(),
  };
  
  // Save to file
  const outputPath = path.join(CONFIG.dataDir, CONFIG.outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved analysis to: ${outputPath}`);
  
  // Print JavaScript arrays for manifest.js
  console.log('\n═'.repeat(60));
  console.log('  📝 COPY TO MANIFEST.JS');
  console.log('═'.repeat(60));
  
  console.log('\n// YEAR_OPTIONS (with counts):');
  console.log('const YEAR_OPTIONS = [');
  console.log('  ' + yearOptions.map(y => `"${y}"`).join(',\n  '));
  console.log('];');
  
  console.log('\n// STUDIO_OPTIONS (with counts, truncated):');
  console.log('const STUDIO_OPTIONS = [');
  const studioChunks = [];
  for (let i = 0; i < studioOptions.length; i += 5) {
    studioChunks.push('  ' + studioOptions.slice(i, i + 5).map(s => `"${s.replace(/"/g, '\\"')}"`).join(', '));
  }
  console.log(studioChunks.join(',\n'));
  console.log('];');
  
  return output;
}

// Run
analyzeDatabase();
