const axios = require('axios');
const cheerio = require('cheerio');

async function checkRatingOrder() {
  console.log('=== /tvshows/?filter=rating ===\n');
  let response = await axios.get('https://hentaimama.io/tvshows/?filter=rating', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  let $ = cheerio.load(response.data);
  $('article').slice(0, 5).each((i, elem) => {
    const $elem = $(elem);
    const title = $elem.find('.data h3').text().trim() || 
                 $elem.find('a').first().text().trim();
    console.log(`${i + 1}. ${title}`);
  });
  
  console.log('\n=== /hentai-list/ (ALL-TIME) ===\n');
  response = await axios.get('https://hentaimama.io/hentai-list/', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  $ = cheerio.load(response.data);
  $('a[href*="/tvshows/"]').slice(0, 10).each((i, elem) => {
    const title = $(elem).text().trim();
    if (title && title.length > 3) {
      console.log(`${i + 1}. ${title}`);
    }
  });
}

checkRatingOrder().catch(console.error);
