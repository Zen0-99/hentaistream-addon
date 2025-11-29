const scraper = require('./src/scrapers/hentaimama');

(async () => {
  console.log('Testing enrichment fallback for series without tvshows page...\n');
  
  const catalog = await scraper.getCatalog(1);
  
  console.log(`Total series: ${catalog.length}\n`);
  
  // Find series that might not have tvshows pages
  const testSeries = catalog.slice(0, 5);
  
  testSeries.forEach(series => {
    const hasCover = series.poster && !series.poster.includes('mp4_snapshot');
    const hasGenres = series.genres && series.genres.length > 1;
    const hasDesc = series.description && series.description.length > 50;
    
    console.log(`\n${series.name}:`);
    console.log(`  ID: ${series.id}`);
    console.log(`  Cover: ${hasCover ? '✓ PROPER COVER' : '❌ Snapshot or missing'}`);
    console.log(`  Genres: ${hasGenres ? '✓ ' + series.genres.join(', ') : '❌ Only "' + (series.genres?.[0] || 'none') + '"'}`);
    console.log(`  Description: ${hasDesc ? '✓ ' + series.description.substring(0, 60) + '...' : '❌ ' + series.description}`);
  });
})();
