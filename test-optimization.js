const scraper = require('./src/scrapers/hentaimama');

async function testOptimization() {
  console.log('Testing catalog enrichment performance...\n');
  
  const start = Date.now();
  const catalog = await scraper.getCatalog(1);
  const duration = Date.now() - start;
  
  console.log(`\n⏱️  Total time: ${duration}ms`);
  console.log(`📦 Items returned: ${catalog.length}`);
  console.log(`\n✅ First 3 items:`);
  
  catalog.slice(0, 3).forEach((item, i) => {
    console.log(`\n${i + 1}. ${item.name}`);
    console.log(`   Genres: ${item.genres?.join(', ')}`);
    console.log(`   Description: ${item.description?.substring(0, 80)}...`);
    console.log(`   Has poster: ${item.poster ? '✓' : '✗'}`);
  });
}

testOptimization().catch(console.error);
