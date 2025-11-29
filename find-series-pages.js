const axios = require('axios');
const cheerio = require('cheerio');

async function findSeriesPages() {
  try {
    console.log('Looking for series/show pages (not episodes)...\n');
    
    const response = await axios.get('https://hentaimama.io', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Look for navigation menu
    console.log('=== SITE NAVIGATION ===');
    $('nav a, .menu a, header a').each((i, link) => {
      const $link = $(link);
      const href = $link.attr('href');
      const text = $link.text().trim();
      if (href && text) {
        console.log(`${text}: ${href}`);
      }
    });
    
    // Check if there are links to "series" or "shows" pages
    console.log('\n=== SEARCHING FOR SERIES/SHOWS LINKS ===');
    $('a[href*="series"], a[href*="show"], a[href*="anime"]').each((i, link) => {
      console.log($(link).attr('href'));
    });
    
    // Try checking the episodes page for series links
    console.log('\n=== CHECKING EPISODE CARDS FOR SERIES LINKS ===');
    const episodesResponse = await axios.get('https://hentaimama.io/episodes', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ep = cheerio.load(episodesResponse.data);
    
    // Check if there are links to series pages (not episode pages)
    const firstArticle = $ep('article').first();
    console.log('\nFirst Article All Links:');
    firstArticle.find('a').each((i, link) => {
      const href = $ep(link).attr('href');
      const text = $ep(link).text().trim();
      console.log(`  ${i + 1}. ${text}`);
      console.log(`     ${href}`);
    });
    
    // Check if .serie span might be clickable or linked
    const serieSpan = firstArticle.find('.serie');
    console.log('\n.serie span parent:', serieSpan.parent()[0]?.name);
    console.log('.serie span HTML:', serieSpan.parent().html());
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

findSeriesPages();
