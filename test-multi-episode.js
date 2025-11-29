const hentaimamaScraper = require('./src/scrapers/hentaimama');

async function testMultiEpisodeSeries() {
  try {
    console.log('Testing multi-episode series...\n');
    
    // First get catalog to find a multi-episode series
    const catalog = await hentaimamaScraper.getCatalog(1);
    const multiEpisodeSeries = catalog.find(s => s.episodes && s.episodes.length > 1);
    
    if (!multiEpisodeSeries) {
      console.log('No multi-episode series found in catalog');
      return;
    }
    
    console.log('='.repeat(60));
    console.log(`Testing: ${multiEpisodeSeries.name}`);
    console.log(`Episodes in catalog: ${multiEpisodeSeries.episodes.length}`);
    console.log('='.repeat(60));
    
    const metadata = await hentaimamaScraper.getMetadata(multiEpisodeSeries.id);
    
    console.log('\nSERIES COVER ART:');
    console.log(`  Poster: ${metadata.poster}`);
    console.log(`  Is video snapshot: ${metadata.poster?.includes('mp4_snapshot') ? 'YES ❌' : 'NO ✓'}`);
    
    console.log(`\nEPISODE THUMBNAILS (${metadata.episodes.length} episodes):`);
    metadata.episodes.forEach(ep => {
      console.log(`\n  Episode ${ep.number}:`);
      console.log(`    Thumbnail: ${ep.poster?.substring(ep.poster?.lastIndexOf('/') + 1)}`);
      console.log(`    Has poster: ${ep.poster ? '✓' : '❌'}`);
    });
    
    // Validation
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION RESULTS:');
    console.log('='.repeat(60));
    
    const seriesIsProperCover = !metadata.poster?.includes('mp4_snapshot');
    const allEpisodesHavePosters = metadata.episodes.every(ep => ep.poster);
    const uniquePosters = new Set(metadata.episodes.map(ep => ep.poster));
    const episodesHaveUniquePosters = uniquePosters.size === metadata.episodes.length;
    
    console.log(`\n✓ Series has proper cover art (not snapshot): ${seriesIsProperCover ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`✓ All episodes have thumbnails: ${allEpisodesHavePosters ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`✓ Each episode has unique thumbnail: ${episodesHaveUniquePosters ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`✓ Series poster ≠ episode thumbnails: ${!metadata.episodes.some(ep => ep.poster === metadata.poster) ? '✅ PASS' : '❌ FAIL'}`);
    
    if (seriesIsProperCover && allEpisodesHavePosters && episodesHaveUniquePosters) {
      console.log('\n🎉 ALL TESTS PASSED! Cover art system working correctly.');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

testMultiEpisodeSeries();
