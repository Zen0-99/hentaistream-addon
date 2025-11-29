const axios = require('axios');
const cheerio = require('cheerio');

async function checkSeriesLinks() {
  try {
    const response = await axios.get('https://hentaimama.io/episodes');
    const $ = cheerio.load(response.data);
    
    console.log('Checking for series links in episode cards...\n');
    
    $('article').slice(0, 5).each((i, article) => {
      const $article = $(article);
      
      const episodeLink = $article.find('a[href*="episodes"]').attr('href');
      const episodeSlug = episodeLink?.match(/episodes\/([\w-]+)/)?.[1];
      const seriesSlug = episodeSlug?.replace(/-episode-\d+$/, '');
      
      console.log(`Article ${i + 1}:`);
      console.log(`  Episode link: ${episodeLink}`);
      console.log(`  Episode slug: ${episodeSlug}`);
      console.log(`  Derived series slug: ${seriesSlug}`);
      
      // Check if there's a direct link to series page
      const allLinks = [];
      $article.find('a').each((j, link) => {
        const href = $(link).attr('href');
        if (href && href.includes('tvshows')) {
          allLinks.push(href);
        }
      });
      
      if (allLinks.length > 0) {
        console.log(`  ✓ Found tvshows links: ${allLinks.join(', ')}`);
      } else {
        console.log(`  ✗ No tvshows links found`);
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkSeriesLinks();
