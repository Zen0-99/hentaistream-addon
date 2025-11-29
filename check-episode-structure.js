const axios = require('axios');
const cheerio = require('cheerio');

async function checkEpisodeStructure() {
  const response = await axios.get('https://hentaimama.io/tvshows/gishi-wa-yan-mama-junyuu-chuu/', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  const $ = cheerio.load(response.data);
  
  console.log('=== EPISODE CARDS ===\n');
  
  // Find articles that contain episodes
  $('article').each((i, article) => {
    const $article = $(article);
    const episodeLink = $article.find('a[href*="episodes"]').attr('href');
    
    if (episodeLink && episodeLink !== '#episodes') {
      console.log(`Article ${i + 1}:`);
      console.log(`  Link: ${episodeLink}`);
      
      const img = $article.find('img').first();
      console.log(`  Image: ${img.attr('data-src') || img.attr('src')}`);
      console.log(`  Alt: ${img.attr('alt')}`);
      console.log();
    }
  });
}

checkEpisodeStructure().catch(err => console.error(err.message));
