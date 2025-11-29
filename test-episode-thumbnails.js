const scraper = require('./src/scrapers/hentaimama');

async function testEpisodeThumbnails() {
  try {
    console.log('Testing catalog enrichment and episode thumbnails...\n');
    
    const catalog = await scraper.getCatalog(1);
    
    const firstSeries = catalog[0];
    console.log(`First series: ${firstSeries.name}`);
    console.log(`  Genres: ${firstSeries.genres.join(', ')}`);
    console.log(`  Description: ${firstSeries.description}`);
    console.log();
    
    console.log(`Testing metadata for: ${firstSeries.name}`);
    const meta = await scraper.getMetadata(firstSeries.id);
    
    console.log(`  Found ${meta.episodes.length} episodes`);
    console.log(`  Series poster: ${meta.poster}`);
    console.log();
    
    console.log('Episode thumbnails:');
    meta.episodes.forEach(ep => {
      const hasThumb = ep.poster && ep.poster !== meta.poster;
      console.log(`  Episode ${ep.number}: ${hasThumb ? '✓ Unique thumbnail' : '❌ No unique thumbnail'}`);
      if (ep.poster) {
        console.log(`    ${ep.poster.substring(ep.poster.lastIndexOf('/') + 1)}`);
      }
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testEpisodeThumbnails();
