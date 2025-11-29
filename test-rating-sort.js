const scraper = require('./src/scrapers/hentaimama');

async function testRatingSort() {
  console.log('Testing rating sort URL...\n');
  
  const items = await scraper.getCatalog(1, null, 'popular');
  
  console.log(`Got ${items.length} items sorted by rating`);
  console.log('\nTop 10:');
  items.slice(0, 10).forEach((item, i) => {
    console.log(`${i + 1}. ${item.name}`);
  });
}

testRatingSort().catch(console.error);
