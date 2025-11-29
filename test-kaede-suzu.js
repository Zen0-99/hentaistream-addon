const hentaimamaScraper = require('./src/scrapers/hentaimama');

async function testKaedeSuzu() {
  try {
    console.log('Testing Kaede to Suzu series...\n');
    
    // This is the ID from the catalog
    const seriesId = 'hmm-kaede-suzu-animation';
    
    console.log(`Fetching metadata for: ${seriesId}`);
    const metadata = await hentaimamaScraper.getMetadata(seriesId);
    
    console.log('\nMETADATA RESULT:');
    console.log(`  Series ID: ${metadata.seriesId}`);
    console.log(`  Name: ${metadata.name}`);
    console.log(`  Episodes found: ${metadata.episodes.length}`);
    
    if (metadata.episodes.length > 0) {
      console.log('\nEPISODES:');
      metadata.episodes.forEach(ep => {
        console.log(`  Episode ${ep.number}: ${ep.slug}`);
      });
    }
    
  } catch (error) {
    console.error('\nERROR:');
    console.error(`  Message: ${error.message}`);
    console.error(`  Status: ${error.response?.status}`);
  }
}

testKaedeSuzu();
