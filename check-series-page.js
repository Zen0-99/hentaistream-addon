const axios = require('axios');
const cheerio = require('cheerio');

async function checkSeriesPage() {
  try {
    console.log('Fetching series page for Seikon no Aria...\n');
    
    const response = await axios.get('https://hentaimama.io/tvshows/seikon-no-aria/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    console.log('=== SERIES PAGE IMAGES ===\n');
    
    // Check og:image (should be series cover)
    console.log('OG:IMAGE:');
    $('meta[property="og:image"]').each((i, meta) => {
      console.log(`  ${$(meta).attr('content')}`);
    });
    
    // Check for poster/featured image
    console.log('\nPOSTER/FEATURED IMAGE:');
    const poster = $('.poster img, .featured-image img, .sheader img').first();
    if (poster.length) {
      console.log(`  src: ${poster.attr('src')}`);
      console.log(`  data-src: ${poster.attr('data-src')}`);
      console.log(`  alt: ${poster.attr('alt')}`);
    }
    
    // Check all images
    console.log('\nALL IMAGES ON PAGE:');
    $('img').slice(0, 5).each((i, img) => {
      const $img = $(img);
      const src = $img.attr('data-src') || $img.attr('src');
      console.log(`  ${i + 1}. ${$img.attr('alt')}`);
      console.log(`     ${src}`);
      console.log(`     Class: ${$img.attr('class')}`);
      console.log('');
    });
    
    // Check for episodes list
    console.log('\n=== EPISODES ON SERIES PAGE ===\n');
    $('.se-c, .episodios, .episodes-list, article[class*="episode"]').each((i, ep) => {
      const $ep = $(ep);
      const link = $ep.find('a').first().attr('href');
      const title = $ep.find('a').first().text().trim() || $ep.text().trim().substring(0, 50);
      console.log(`Episode: ${title}`);
      console.log(`Link: ${link}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkSeriesPage();
