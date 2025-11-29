const scraper = require('./src/scrapers/hentaimama');

async function testMetadata() {
  const metadata = await scraper.getMetadata('hmm-netorareta-bakunyuu-tsuma-tachi');
  
  console.log('Series:', metadata.name);
  console.log('Description:', metadata.description.substring(0, 100) + '...');
  console.log('Genres:', metadata.genres.join(', '));
  console.log('Episodes found:', metadata.episodes.length);
  metadata.episodes.forEach(ep => {
    console.log(`  - Episode ${ep.number}: ${ep.title} (${ep.id})`);
  });
}

testMetadata().catch(console.error);
