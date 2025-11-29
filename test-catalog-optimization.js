const scraper = require('./src/scrapers/hentaimama');
const catalog = require('./src/addon/handlers/catalog');

async function testOptimization() {
  console.log('Testing Widow genre (small catalog)...\n');
  
  const result = await catalog({ 
    type: 'series', 
    id: 'hentaimama-all', 
    extra: { genre: 'Widow', skip: 0 } 
  });
  
  console.log(`\nResult: ${result.metas.length} items`);
  console.log('Items:', result.metas.map(m => m.name));
  
  // Test pagination
  console.log('\n\nTesting pagination (skip: 15)...');
  const result2 = await catalog({ 
    type: 'series', 
    id: 'hentaimama-all', 
    extra: { genre: 'Widow', skip: 15 } 
  });
  
  console.log(`Result: ${result2.metas.length} items`);
  console.log('Should return 0 items (end of catalog)');
}

testOptimization().catch(console.error);
