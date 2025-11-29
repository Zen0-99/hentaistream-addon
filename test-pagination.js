const hentaimamaScraper = require('./src/scrapers/hentaimama');

async function testPagination() {
  console.log('Testing pagination with multiple pages...\n');
  
  // Test base catalog (popular/rated)
  console.log('='.repeat(60));
  console.log('TEST 1: Base catalog (popular sort)');
  console.log('='.repeat(60));
  
  let allItems = [];
  for (let page = 1; page <= 5; page++) {
    const items = await hentaimamaScraper.getCatalog(page, null, 'popular');
    console.log(`Page ${page}: ${items.length} items`);
    allItems = allItems.concat(items);
  }
  
  console.log(`\nTotal items from 5 pages: ${allItems.length}`);
  console.log(`Should be ~100-120 items for proper Stremio pagination\n`);
  
  // Test genre catalog
  console.log('='.repeat(60));
  console.log('TEST 2: Genre catalog (3D)');
  console.log('='.repeat(60));
  
  let genreItems = [];
  for (let page = 1; page <= 5; page++) {
    const items = await hentaimamaScraper.getCatalog(page, '3d');
    console.log(`Page ${page}: ${items.length} items`);
    genreItems = genreItems.concat(items);
    
    if (items.length === 0) {
      console.log('No more items available');
      break;
    }
  }
  
  console.log(`\nTotal 3D items: ${genreItems.length}`);
  
  // Show sample items
  console.log('\n' + '='.repeat(60));
  console.log('Sample items from popular catalog:');
  console.log('='.repeat(60));
  allItems.slice(0, 3).forEach((item, i) => {
    console.log(`\n${i + 1}. ${item.name}`);
    console.log(`   ID: ${item.id}`);
    console.log(`   Poster: ${item.poster?.substring(0, 60)}...`);
    console.log(`   Genres: ${item.genres?.join(', ')}`);
  });
}

testPagination().catch(console.error);
