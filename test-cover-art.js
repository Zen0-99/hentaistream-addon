const hentaimamaScraper = require('./src/scrapers/hentaimama');

async function testCoverArt() {
  try {
    console.log('Testing HentaiMama cover art extraction...\n');
    
    // Test series: Seikon no Aria
    console.log('='.repeat(60));
    console.log('Testing: Seikon no Aria');
    console.log('='.repeat(60));
    
    const metadata = await hentaimamaScraper.getMetadata('hmm-seikon-no-aria');
    
    console.log('\nSERIES METADATA:');
    console.log(`  Name: ${metadata.name}`);
    console.log(`  Poster: ${metadata.poster}`);
    console.log(`  Is snapshot: ${metadata.poster?.includes('mp4_snapshot') ? 'YES ❌' : 'NO ✓'}`);
    console.log(`  Genres: ${metadata.genres.join(', ')}`);
    console.log(`  Description: ${metadata.description.substring(0, 100)}...`);
    
    console.log(`\nEPISODES (${metadata.episodes.length}):`);
    metadata.episodes.forEach(ep => {
      const isSnapshot = ep.poster?.includes('mp4_snapshot');
      console.log(`  Episode ${ep.number}:`);
      console.log(`    Slug: ${ep.slug}`);
      console.log(`    Poster: ${ep.poster || 'NONE'}`);
      console.log(`    Is snapshot: ${isSnapshot ? 'YES (expected for episodes)' : 'NO'}`);
    });
    
    // Check if series poster is different from episode posters
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION:');
    console.log('='.repeat(60));
    
    const seriesIsSnapshot = metadata.poster?.includes('mp4_snapshot');
    const allEpisodesHavePosters = metadata.episodes.every(ep => ep.poster);
    const episodePostersUnique = new Set(metadata.episodes.map(ep => ep.poster)).size === metadata.episodes.length;
    
    console.log(`✓ Series poster is proper cover art: ${!seriesIsSnapshot ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`✓ All episodes have posters: ${allEpisodesHavePosters ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`✓ Episode posters are unique: ${episodePostersUnique ? '✓ PASS' : '❌ FAIL'}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testCoverArt();
