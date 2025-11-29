const catalogHandler = require('./src/addon/handlers/catalog');

async function test() {
  console.log('Testing Catalog Handler...\n');
  
  try {
    console.log('1. Testing catalog handler...');
    const result = await catalogHandler({
      type: 'series',
      id: 'hanime-all',
      extra: { skip: 0 }
    });
    
    console.log(`Found ${result.metas.length} items`);
    if (result.metas.length > 0) {
      console.log('First item:', JSON.stringify(result.metas[0], null, 2));
    }
  } catch (error) {
    console.error('Catalog error:', error.message);
    console.error(error.stack);
  }
}

test().then(() => {
  console.log('\nTest complete');
  process.exit(0);
}).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
