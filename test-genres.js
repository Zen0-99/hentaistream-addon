const hentaimamaScraper = require('./src/scrapers/hentaimama');

async function testGenres() {
  try {
    console.log('Fetching HentaiMama genres...\n');
    
    const genres = await hentaimamaScraper.getGenres();
    
    console.log(`Found ${genres.length} genres:\n`);
    
    genres.slice(0, 20).forEach(genre => {
      console.log(`  - ${genre.name} (${genre.slug})`);
    });
    
    console.log(`\n... and ${genres.length - 20} more`);
    
    // Test genre catalog
    console.log('\n' + '='.repeat(60));
    console.log('Testing genre catalog: uncensored');
    console.log('='.repeat(60));
    
    const results = await hentaimamaScraper.getCatalog(1, 'uncensored');
    console.log(`\nFound ${results.length} series in Uncensored genre`);
    
    results.slice(0, 3).forEach(series => {
      console.log(`\n  ${series.name}`);
      console.log(`    Genres: ${series.genres?.join(', ')}`);
      console.log(`    Description: ${series.description?.substring(0, 60)}...`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

testGenres();
