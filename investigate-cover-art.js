const axios = require('axios');
const cheerio = require('cheerio');

async function investigateCoverArt() {
  try {
    console.log('Fetching HentaiMama catalog...\n');
    const response = await axios.get('https://hentaimama.io/episodes', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Get first 3 articles to compare
    $('article').slice(0, 3).each((index, article) => {
      const $article = $(article);
      console.log(`\n${'='.repeat(60)}`);
      console.log(`ARTICLE ${index + 1}`);
      console.log('='.repeat(60));
      
      // Get series name
      const seriesName = $article.find('.serie').text().trim() || 
                        $article.find('a').first().text().trim();
      console.log(`Series: ${seriesName}`);
      
      // Get link
      const link = $article.find('a[href*="episodes"]').attr('href');
      console.log(`Link: ${link}`);
      
      // Check ALL images and their attributes
      console.log('\nIMAGES FOUND:');
      $article.find('img').each((imgIndex, img) => {
        const $img = $(img);
        console.log(`\n  Image #${imgIndex + 1}:`);
        console.log(`    src: ${$img.attr('src')}`);
        console.log(`    data-src: ${$img.attr('data-src')}`);
        console.log(`    data-lazy-src: ${$img.attr('data-lazy-src')}`);
        console.log(`    srcset: ${$img.attr('srcset')}`);
        console.log(`    data-srcset: ${$img.attr('data-srcset')}`);
        console.log(`    class: ${$img.attr('class')}`);
        console.log(`    alt: ${$img.attr('alt')}`);
        
        // Check parent elements
        const parent = $img.parent();
        console.log(`    Parent: ${parent[0]?.name} (class: ${parent.attr('class')})`);
      });
      
      // Check for background images in style attributes
      console.log('\nBACKGROUND IMAGES:');
      $article.find('[style*="background"]').each((i, elem) => {
        console.log(`  ${$(elem)[0].name}: ${$(elem).attr('style')}`);
      });
      
      // Look for poster div structure
      console.log('\nPOSTER DIV STRUCTURE:');
      const posterDiv = $article.find('.poster');
      if (posterDiv.length) {
        console.log(posterDiv.html()?.substring(0, 800));
      }
    });
    
    // Now fetch an episode page to see og:image
    console.log('\n\n' + '='.repeat(60));
    console.log('CHECKING EPISODE PAGE FOR OG:IMAGE');
    console.log('='.repeat(60));
    
    const firstLink = $('article a[href*="episodes"]').first().attr('href');
    if (firstLink) {
      const episodeUrl = firstLink.startsWith('http') ? firstLink : `https://hentaimama.io${firstLink}`;
      console.log(`Fetching: ${episodeUrl}\n`);
      
      const epResponse = await axios.get(episodeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const $ep = cheerio.load(epResponse.data);
      
      console.log('ALL OG:IMAGE TAGS:');
      $ep('meta[property="og:image"]').each((i, meta) => {
        console.log(`  ${i + 1}: ${$ep(meta).attr('content')}`);
      });
      
      console.log('\nALL META IMAGES:');
      $ep('meta[name*="image"], meta[property*="image"]').each((i, meta) => {
        const $meta = $ep(meta);
        console.log(`  ${$meta.attr('name') || $meta.attr('property')}: ${$meta.attr('content')}`);
      });
      
      console.log('\nFEATURED IMAGE / THUMBNAIL:');
      const featuredImg = $ep('.featured-image img, .thumbnail img, .entry-thumbnail img').first();
      if (featuredImg.length) {
        console.log(`  src: ${featuredImg.attr('src')}`);
        console.log(`  data-src: ${featuredImg.attr('data-src')}`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

investigateCoverArt();
