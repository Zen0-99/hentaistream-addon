const axios = require('axios');
const cheerio = require('cheerio');

async function checkGenrePage() {
  try {
    const response = await axios.get('https://hentaimama.io/genre/uncensored/');
    const $ = cheerio.load(response.data);
    
    console.log('=== GENRE PAGE STRUCTURE ===\n');
    
    console.log('Articles found:', $('article').length);
    console.log('Items found:', $('.item, .post, .tvshow').length);
    
    // Check first item
    const firstItem = $('article, .item, .tvshow').first();
    console.log('\nFirst Item HTML:');
    console.log(firstItem.html()?.substring(0, 500));
    
    // Check for series links
    console.log('\n\nSeries Links:');
    $('a[href*="/tvshows/"]').slice(0, 5).each((i, link) => {
      console.log(`  ${i + 1}. ${$(link).text().trim()}`);
      console.log(`     ${$(link).attr('href')}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkGenrePage();
