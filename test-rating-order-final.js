const hentaimamaScraper = require('./src/scrapers/hentaimama');

async function testRatingOrder() {
  try {
    console.log('Testing rating order...\n');
    
    const catalog = await hentaimamaScraper.getCatalog(1, null, 'popular');
    
    console.log('=== TOP 10 BY RATING ===\n');
    catalog.slice(0, 10).forEach((series, i) => {
      console.log(`${i + 1}. ${series.name}`);
      console.log(`   ID: ${series.id}`);
      console.log(`   Genres: ${series.genres?.join(', ') || 'N/A'}`);
      console.log('');
    });
    
    console.log(`\nTotal series: ${catalog.length}`);
    
    // Check if first series is "Kaede to Suzu"
    const firstSeries = catalog[0];
    console.log('\n=== VALIDATION ===');
    console.log(`First series: ${firstSeries.name}`);
    console.log(`Expected: Kaede to Suzu (or similar)`);
    console.log(`Match: ${firstSeries.name.includes('Kaede') ? '✅ PASS' : '❌ FAIL'}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

testRatingOrder();
