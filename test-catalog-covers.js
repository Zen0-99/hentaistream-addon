const hentaimamaScraper = require('./src/scrapers/hentaimama');

async function testCatalogCoverArt() {
  try {
    console.log('Testing catalog cover art...\n');
    
    const catalog = await hentaimamaScraper.getCatalog(1);
    
    console.log(`Found ${catalog.length} series in catalog\n`);
    console.log('='.repeat(80));
    
    // Check first 5 series
    catalog.slice(0, 5).forEach((series, index) => {
      const isSnapshot = series.poster?.includes('mp4_snapshot');
      
      console.log(`\n${index + 1}. ${series.name}`);
      console.log(`   ID: ${series.id}`);
      console.log(`   Poster: ${series.poster?.substring(series.poster?.lastIndexOf('/') + 1) || 'NONE'}`);
      console.log(`   Is snapshot: ${isSnapshot ? '❌ YES (WRONG)' : '✅ NO (CORRECT)'}`);
      console.log(`   Genres: ${series.genres?.join(', ') || 'none'}`);
      console.log(`   Description: ${series.description?.substring(0, 60)}...`);
      console.log(`   Episodes: ${series.episodes?.length || 0}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY:');
    console.log('='.repeat(80));
    
    const totalSeries = catalog.length;
    const withProperCovers = catalog.filter(s => s.poster && !s.poster.includes('mp4_snapshot')).length;
    const withSnapshots = catalog.filter(s => s.poster?.includes('mp4_snapshot')).length;
    const withGenres = catalog.filter(s => s.genres && s.genres.length > 1).length; // More than just "Hentai"
    const withDescriptions = catalog.filter(s => s.description && s.description.length > 30).length;
    
    console.log(`\n✓ Total series: ${totalSeries}`);
    console.log(`✓ With proper cover art: ${withProperCovers}/${totalSeries} (${Math.round(withProperCovers/totalSeries*100)}%)`);
    console.log(`✓ Still using snapshots: ${withSnapshots}/${totalSeries}`);
    console.log(`✓ With detailed genres: ${withGenres}/${totalSeries} (${Math.round(withGenres/totalSeries*100)}%)`);
    console.log(`✓ With descriptions: ${withDescriptions}/${totalSeries} (${Math.round(withDescriptions/totalSeries*100)}%)`);
    
    if (withProperCovers === totalSeries) {
      console.log('\n🎉 SUCCESS! All series have proper cover art!');
    } else if (withProperCovers > totalSeries * 0.8) {
      console.log('\n✅ GOOD! Most series have proper cover art.');
    } else {
      console.log('\n⚠️ Some series still using snapshots (may be unavailable series pages)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

testCatalogCoverArt();
