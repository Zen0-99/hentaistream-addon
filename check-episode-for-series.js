const axios = require('axios');
const cheerio = require('cheerio');

async function checkEpisodePageForSeriesLink() {
  try {
    const response = await axios.get('https://hentaimama.io/episodes/netorareta-bakunyuu-tsuma-tachi-episode-1/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    console.log('Looking for series/tvshow links on episode page...\n');
    
    // Check for links to tvshows
    const tvshowLinks = [];
    $('a[href*="tvshows"]').each((i, link) => {
      tvshowLinks.push($(link).attr('href'));
    });
    
    console.log('TVShows links found:');
    tvshowLinks.slice(0, 5).forEach(link => console.log(`  ${link}`));
    
    // Check breadcrumbs
    console.log('\nBreadcrumbs:');
    $('.breadcrumb a, .bread-crumb a, nav a').each((i, link) => {
      console.log(`  ${$(link).text().trim()}: ${$(link).attr('href')}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkEpisodePageForSeriesLink();
