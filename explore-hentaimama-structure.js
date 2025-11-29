const axios = require('axios');
const cheerio = require('cheerio');

async function exploreHentaiMamaStructure() {
  console.log('=== EXPLORING HENTAIMAMA STRUCTURE ===\n');
  
  // 1. Explore catalog page structure
  console.log('1. CATALOG PAGE STRUCTURE');
  console.log('URL: https://hentaimama.io/episodes\n');
  
  const catalogResponse = await axios.get('https://hentaimama.io/episodes');
  const $catalog = cheerio.load(catalogResponse.data);
  
  const firstArticle = $catalog('article').first();
  console.log('First article HTML snippet:');
  console.log(firstArticle.html().substring(0, 800));
  console.log('\n---\n');
  
  // Extract all image sources from first article
  console.log('Images in first article:');
  firstArticle.find('img').each((i, img) => {
    const $img = $catalog(img);
    console.log(`  Image ${i + 1}:`);
    console.log(`    src: ${$img.attr('src')}`);
    console.log(`    data-src: ${$img.attr('data-src')}`);
    console.log(`    alt: ${$img.attr('alt')}`);
    console.log(`    class: ${$img.attr('class')}`);
  });
  console.log('\n---\n');
  
  // 2. Explore individual episode page
  const firstLink = firstArticle.find('a[href*="episodes"]').first().attr('href');
  console.log(`2. EPISODE PAGE STRUCTURE`);
  console.log(`URL: ${firstLink}\n`);
  
  const episodeResponse = await axios.get(firstLink);
  const $episode = cheerio.load(episodeResponse.data);
  
  // Check for series information
  console.log('Page title:', $episode('h1').first().text().trim());
  console.log('Meta og:image:', $episode('meta[property="og:image"]').attr('content'));
  console.log('Meta og:title:', $episode('meta[property="og:title"]').attr('content'));
  console.log('\n---\n');
  
  // Look for series/franchise information
  console.log('Looking for series/franchise links:');
  $episode('a[href*="hentai"], a[href*="series"], .series-link, .franchise').each((i, elem) => {
    const $link = $episode(elem);
    console.log(`  Link ${i + 1}:`);
    console.log(`    Text: ${$link.text().trim()}`);
    console.log(`    Href: ${$link.attr('href')}`);
    console.log(`    Class: ${$link.attr('class')}`);
  });
  console.log('\n---\n');
  
  // Look for episode thumbnails in the page
  console.log('All images on episode page:');
  $episode('img').slice(0, 5).each((i, img) => {
    const $img = $episode(img);
    const src = $img.attr('data-src') || $img.attr('src');
    if (src && !src.includes('data:image') && src.length > 20) {
      console.log(`  Image ${i + 1}:`);
      console.log(`    URL: ${src}`);
      console.log(`    Alt: ${$img.attr('alt')}`);
      console.log(`    Parent: ${$img.parent().prop('tagName')}`);
    }
  });
  console.log('\n---\n');
  
  // Look for related/other episodes
  console.log('Looking for related episodes:');
  $episode('a[href*="episode"]').slice(0, 10).each((i, elem) => {
    const $link = $episode(elem);
    const href = $link.attr('href');
    if (href && href.includes('episodes/')) {
      console.log(`  Episode link ${i + 1}:`);
      console.log(`    Text: ${$link.text().trim().substring(0, 50)}`);
      console.log(`    Href: ${href}`);
      
      // Check if there's an image in this link
      const img = $link.find('img').first();
      if (img.length > 0) {
        console.log(`    Has thumbnail: ${img.attr('data-src') || img.attr('src')}`);
      }
    }
  });
  console.log('\n---\n');
  
  // 3. Check if there's a series/hentai page
  console.log('3. CHECKING FOR SERIES PAGE');
  
  // Try to find series page by looking at breadcrumbs or navigation
  const breadcrumbs = $episode('.breadcrumb, .breadcrumbs, nav[aria-label="breadcrumb"]');
  if (breadcrumbs.length > 0) {
    console.log('Breadcrumbs found:');
    breadcrumbs.find('a').each((i, link) => {
      console.log(`  ${$episode(link).text().trim()} -> ${$episode(link).attr('href')}`);
    });
  } else {
    console.log('No breadcrumbs found');
  }
  
  // Look for series name in the page
  console.log('\nLooking for series/hentai name patterns:');
  const titleText = $episode('h1').first().text();
  console.log(`Full title: ${titleText}`);
  
  // Check if there's a pattern like "Series Name - Episode X" or "Series Name Episode X"
  const patterns = [
    /(.+?)\s*-\s*Episode\s*\d+/i,
    /(.+?)\s*Episode\s*\d+/i,
    /(.+?)\s*Ep\.\s*\d+/i,
    /(.+?)\s*\d+$/
  ];
  
  patterns.forEach(pattern => {
    const match = titleText.match(pattern);
    if (match) {
      console.log(`  Pattern matched: "${pattern}" -> Series: "${match[1].trim()}"`);
    }
  });
}

exploreHentaiMamaStructure().catch(console.error);
