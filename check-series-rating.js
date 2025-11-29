const axios = require('axios');
const cheerio = require('cheerio');

async function checkSeriesRating() {
  try {
    console.log('Fetching HentaiMama series by rating...\n');
    
    const response = await axios.get('https://hentaimama.io/hentai-series/?filter=rating', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    console.log('=== FIRST 10 SERIES BY RATING ===\n');
    
    $('article').slice(0, 10).each((i, article) => {
      const $article = $(article);
      const title = $article.find('.title, h2, h3, a').first().text().trim() ||
                   $article.find('a').first().attr('title');
      const link = $article.find('a').first().attr('href');
      const year = $article.find('.year').text().trim();
      
      console.log(`${i + 1}. ${title}`);
      console.log(`   Year: ${year}`);
      console.log(`   Link: ${link}`);
      console.log('');
    });
    
    console.log('\n=== ARTICLE STRUCTURE ===\n');
    const firstArticle = $('article').first();
    console.log(firstArticle.html()?.substring(0, 800));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkSeriesRating();
