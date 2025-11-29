const scraper = require('./src/scrapers/hentaimama');

async function testSeriesGrouping() {
  const results = await scraper.getCatalog(1);
  
  console.log(`Found ${results.length} series\n`);
  
  results.slice(0, 5).forEach(series => {
    console.log(`Series: ${series.name}`);
    console.log(`ID: ${series.id}`);
    console.log(`Genres: ${series.genres ? series.genres.join(', ') : 'None'}`);
    console.log(`Description: ${series.description || 'None'}`);
    console.log(`Episodes: ${series.episodes.length}`);
    console.log(`Poster: ${series.poster ? 'YES' : 'NO'}`);
    console.log('---');
  });
}

testSeriesGrouping().catch(console.error);
