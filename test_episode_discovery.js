/**
 * Test episode discovery for series with multiple episodes
 * Tests that all episodes are found, not just episode 1
 */

const scraper = require('./src/scrapers/hentaimama');

async function testEpisodeDiscovery() {
  console.log('='.repeat(60));
  console.log('Testing Episode Discovery');
  console.log('='.repeat(60));
  
  // Test cases - series known to have multiple episodes
  const testCases = [
    'hmm-nagachichi-nagai-san-the-animation', // Should have at least 2 episodes
    'hmm-honey-blonde-2',  // Test RAW detection as well
  ];
  
  for (const seriesId of testCases) {
    console.log(`\n📺 Testing: ${seriesId}`);
    console.log('-'.repeat(50));
    
    try {
      const metadata = await scraper.getMetadata(seriesId);
      
      if (metadata) {
        console.log(`✅ Title: ${metadata.name}`);
        console.log(`   Episodes found: ${metadata.episodes?.length || 0}`);
        
        if (metadata.episodes && metadata.episodes.length > 0) {
          console.log('\n   Episode list:');
          for (const ep of metadata.episodes) {
            const rawStatus = ep.isRaw ? ' [RAW]' : ' [SUB]';
            const date = ep.released ? ` (${ep.released.split('T')[0]})` : '';
            console.log(`   - Episode ${ep.number}: ${ep.title || 'Untitled'}${rawStatus}${date}`);
          }
        } else {
          console.log('   ⚠️ No episodes found!');
        }
      } else {
        console.log('❌ No metadata returned');
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    console.log('');
  }
  
  // Also test the monthly releases
  console.log('\n' + '='.repeat(60));
  console.log('Testing Monthly Releases');
  console.log('='.repeat(60));
  
  try {
    const monthlyEpisodes = await scraper.getMonthlyReleases(1);
    console.log(`\n📅 Found ${monthlyEpisodes.length} episodes on monthly page:`);
    
    // Group by series
    const seriesMap = new Map();
    for (const ep of monthlyEpisodes) {
      if (!seriesMap.has(ep.seriesSlug)) {
        seriesMap.set(ep.seriesSlug, []);
      }
      seriesMap.get(ep.seriesSlug).push(ep);
    }
    
    console.log(`   Grouped into ${seriesMap.size} series:`);
    for (const [slug, episodes] of seriesMap) {
      const epNumbers = episodes.map(e => e.episodeNumber).sort((a, b) => a - b);
      const rawStatus = episodes.some(e => e.isRaw) ? ' [RAW]' : '';
      console.log(`   • ${slug}: Episodes ${epNumbers.join(', ')}${rawStatus}`);
    }
  } catch (error) {
    console.log(`❌ Error fetching monthly releases: ${error.message}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Test complete');
  console.log('='.repeat(60));
}

testEpisodeDiscovery().catch(console.error);
