const hentaimama = require('./src/scrapers/hentaimama');

async function test() {
  console.log('Testing HentaiMama scraper...\n');

  // Test 1: Get catalog
  console.log('1. Testing catalog...');
  const catalog = await hentaimama.getCatalog(1);
  console.log(`Found ${catalog.length} episodes`);
  if (catalog.length > 0) {
    console.log('First episode:', JSON.stringify(catalog[0], null, 2));
  }

  // Test 2: Get metadata
  if (catalog.length > 0) {
    console.log('\n2. Testing metadata...');
    const meta = await hentaimama.getMetadata(catalog[0].id);
    console.log('Metadata:', JSON.stringify(meta, null, 2));

    // Test 3: Get streams
    console.log('\n3. Testing streams...');
    const streams = await hentaimama.getStreams(catalog[0].id);
    console.log(`Found ${streams.length} streams`);
    if (streams.length > 0) {
      console.log('First stream:', JSON.stringify(streams[0], null, 2));
    }
  }
}

test().catch(console.error);
