/**
 * Test yt-dlp stream extraction for HAnime
 */

const YtDlpScraper = require('./src/scrapers/ytdlp');

async function testYtDlp() {
  console.log('Testing yt-dlp with HAnime...\n');
  
  const scraper = new YtDlpScraper();
  
  // Check if yt-dlp is available
  console.log('Checking yt-dlp availability...');
  const available = await scraper.checkAvailable();
  console.log(`yt-dlp available: ${available}\n`);
  
  if (!available) {
    console.error('yt-dlp is not installed!');
    console.log('\nTo install yt-dlp:');
    console.log('  npm install -g yt-dlp');
    console.log('  OR download from: https://github.com/yt-dlp/yt-dlp/releases');
    return;
  }
  
  // Test URL - use a known HAnime episode
  const testUrl = 'https://hanime.tv/videos/hentai/sora-no-iro-mizu-no-iro-1';
  
  console.log(`Extracting streams from: ${testUrl}`);
  console.log('This may take 10-30 seconds...\n');
  
  try {
    const streams = await scraper.getStreams(testUrl);
    
    if (streams.length === 0) {
      console.log('❌ No streams found');
      console.log('\nPossible reasons:');
      console.log('  - HAnime requires authentication');
      console.log('  - Video is protected/DRM');
      console.log('  - yt-dlp needs plugin for HAnime');
      console.log('\nTrying to get metadata instead...\n');
      
      const metadata = await scraper.getMetadata(testUrl);
      if (metadata) {
        console.log('✅ Metadata extracted:');
        console.log(`  Title: ${metadata.title}`);
        console.log(`  Duration: ${metadata.duration}s`);
        console.log(`  Views: ${metadata.viewCount}`);
      }
    } else {
      console.log(`✅ Found ${streams.length} streams:\n`);
      
      streams.forEach((stream, index) => {
        console.log(`Stream ${index + 1}:`);
        console.log(`  Quality: ${stream.quality}`);
        console.log(`  Resolution: ${stream.width}x${stream.height}`);
        console.log(`  Protocol: ${stream.protocol}`);
        console.log(`  Extension: ${stream.extension}`);
        console.log(`  URL: ${stream.url.substring(0, 100)}...`);
        console.log('');
      });
      
      console.log('✅ SUCCESS: yt-dlp can extract streams from HAnime!');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\nThis is expected if:');
    console.log('  - HAnime requires special plugin');
    console.log('  - Site has changed structure');
    console.log('  - Authentication required');
  }
}

testYtDlp().catch(console.error);
