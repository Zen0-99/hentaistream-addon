const hentaimamaScraper = require('./src/scrapers/hentaimama');

async function testActualCounts() {
  console.log('Testing ACTUAL series counts returned per page...\n');
  
  for (let page = 1; page <= 5; page++) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`PAGE ${page}`);
    console.log('='.repeat(60));
    
    const results = await hentaimamaScraper.getCatalog(page, null, 'popular');
    
    console.log(`✅ Returned: ${results.length} unique series`);
    console.log(`\nFirst 3 series:`);
    results.slice(0, 3).forEach((series, i) => {
      console.log(`  ${i + 1}. ${series.name} (${series.id})`);
      console.log(`     Episodes: ${series.episodes?.length || 0}`);
    });
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('CONCLUSION: How many ACTUAL unique series per page?');
  console.log('='.repeat(60));
}

testActualCounts().catch(console.error);
