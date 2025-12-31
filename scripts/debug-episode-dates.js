#!/usr/bin/env node
/**
 * Debug script to test episode date extraction for all scrapers
 */

async function testHentaiSeaScraper() {
  console.log('\n=== TESTING HENTAISEA SCRAPER ===');
  
  // Scrapers export singleton instances, not classes
  const scraper = require('../src/scrapers/hentaisea');
  
  try {
    // Use correct prefix format: hse- not hse:
    const seriesId = 'hse-youkoso-sukebe-elf-no-mori-e';
    console.log('Fetching metadata for:', seriesId);
    
    const meta = await scraper.getMetadata(seriesId);
    
    if (meta) {
      console.log('Title:', meta.name);
      console.log('Year:', meta.year);
      console.log('Studio:', meta.studio);
      console.log('lastUpdated:', meta.lastUpdated);
      console.log('Episodes:', meta.episodes?.length || 0);
      
      if (meta.episodes?.length > 0) {
        console.log('\nFirst 3 episodes:');
        meta.episodes.slice(0, 3).forEach(ep => {
          console.log(`  Ep ${ep.number} - released: ${ep.released || 'NOT SET'}`);
        });
      }
    } else {
      console.log('No metadata returned');
    }
  } catch (e) {
    console.log('Error:', e.message, e.stack);
  }
}

async function testHentaiMamaScraper() {
  console.log('\n=== TESTING HENTAIMAMA SCRAPER ===');
  
  // Scrapers export singleton instances, not classes
  const scraper = require('../src/scrapers/hentaimama');
  
  try {
    // hmm prefix uses hmm-slug format when creating IDs 
    const seriesId = 'hmm-youkoso-sukebe-elf-no-mori-e';
    console.log('Fetching metadata for:', seriesId);
    console.log('Prefix:', scraper.prefix, '| Will strip to:', seriesId.replace(scraper.prefix, ''));
    
    const meta = await scraper.getMetadata(seriesId);
    
    if (meta) {
      console.log('Title:', meta.name);
      console.log('lastUpdated:', meta.lastUpdated);
      console.log('Episodes:', meta.episodes?.length || 0);
      
      if (meta.episodes?.length > 0) {
        console.log('\nFirst 3 episodes:');
        meta.episodes.slice(0, 3).forEach(ep => {
          console.log(`  Ep ${ep.number} - released: ${ep.released || 'NOT SET'}`);
        });
      }
    }
  } catch (e) {
    console.log('Error:', e.message, e.stack);
  }
}

async function testHentaiTVScraper() {
  console.log('\n=== TESTING HENTAITV SCRAPER ===');
  
  // Scrapers export singleton instances, not classes
  const scraper = require('../src/scrapers/hentaitv');
  
  try {
    // Use correct prefix format: htv- not htv:
    const seriesId = 'htv-youkoso-sukebe-elf-no-mori-e';
    console.log('Fetching metadata for:', seriesId);
    
    const meta = await scraper.getMetadata(seriesId);
    
    if (meta) {
      console.log('Title:', meta.name);
      console.log('lastUpdated:', meta.lastUpdated);
      console.log('Episodes:', meta.episodes?.length || 0);
      
      if (meta.episodes?.length > 0) {
        console.log('\nFirst 3 episodes:');
        meta.episodes.slice(0, 3).forEach(ep => {
          console.log(`  Ep ${ep.number} - released: ${ep.released || 'NOT SET'}`);
        });
      }
    }
  } catch (e) {
    console.log('Error:', e.message, e.stack);
  }
}

async function main() {
  await testHentaiMamaScraper();
  await testHentaiSeaScraper();
  await testHentaiTVScraper();
  
  console.log('\n=== SUMMARY ===');
  console.log('All scrapers should now extract episode release dates.');
  console.log('Run "node scripts/build-database.js" to rebuild the database.');
}

main().catch(console.error);
