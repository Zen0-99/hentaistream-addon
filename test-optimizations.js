const scraper = require('./src/scrapers/hentaimama');

async function testOptimizations() {
  console.log('Testing catalog and episode discovery optimizations...\n');
  
  console.time('Catalog Load');
  const catalog = await scraper.getCatalog(1);
  console.timeEnd('Catalog Load');
  console.log(`Got ${catalog.length} series\n`);
  
  console.log('Testing top 3 series:');
  for (let i = 0; i < 3; i++) {
    const series = catalog[i];
    console.log(`\n${i+1}. ${series.name} (${series.id})`);
    console.log(`   Genres: ${series.genres?.join(', ')}`);
    
    console.time(`   Metadata fetch`);
    try {
      const meta = await scraper.getMetadata(series.id);
      console.timeEnd(`   Metadata fetch`);
      console.log(`   Episodes found: ${meta.episodes.length}`);
      meta.episodes.forEach(ep => {
        console.log(`     - Episode ${ep.number}: ${ep.slug}`);
      });
    } catch (err) {
      console.timeEnd(`   Metadata fetch`);
      console.log(`   ERROR: ${err.message}`);
    }
  }
}

testOptimizations();
