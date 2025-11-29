const axios = require('axios');
const cheerio = require('cheerio');

async function debugCatalog() {
  const response = await axios.get('https://hentaimama.io/episodes');
  const $ = cheerio.load(response.data);
  
  console.log('First 3 articles:');
  $('article').slice(0, 3).each((i, elem) => {
    const $elem = $(elem);
    const link = $elem.find('a').first();
    
    console.log(`\n--- Article ${i + 1} ---`);
    console.log('Title attr:', link.attr('title'));
    console.log('Link text:', link.text().substring(0, 100));
    console.log('H2 text:', $elem.find('h2').text().trim());
    console.log('H3 text:', $elem.find('h3').text().trim());
    console.log('.entry-title:', $elem.find('.entry-title').text().trim());
    console.log('URL:', link.attr('href'));
  });
}

debugCatalog().catch(console.error);
