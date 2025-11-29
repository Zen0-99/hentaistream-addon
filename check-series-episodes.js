const axios = require('axios');
const cheerio = require('cheerio');

async function checkSeriesPage() {
  const response = await axios.get('https://hentaimama.io/tvshows/gishi-wa-yan-mama-junyuu-chuu/', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  const $ = cheerio.load(response.data);
  
  console.log('=== EPISODE LINKS ===');
  $('a[href*="episodes"]').slice(0, 5).each((i, link) => {
    const $link = $(link);
    console.log(`\n${i + 1}. ${$link.attr('href')}`);
    console.log(`   Text: ${$link.text().trim().substring(0, 50)}`);
    
    const parent = $link.parent();
    console.log(`   Parent: <${parent[0].name} class="${parent.attr('class')}">`);
    
    const img = $link.find('img').first();
    if (img.length) {
      console.log(`   Image: ${img.attr('data-src') || img.attr('src')}`);
    }
  });
  
  console.log('\n\n=== EPISODE CONTAINERS ===');
  $('.se-c, .seasons, #seasons').each((i, container) => {
    console.log(`\nContainer ${i + 1}: <${container.name} class="${$(container).attr('class')}">`);
    const episodes = $(container).find('a[href*="episodes"]');
    console.log(`  Contains ${episodes.length} episode links`);
  });
}

checkSeriesPage().catch(err => console.error(err.message));
