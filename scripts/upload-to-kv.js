/**
 * Upload Database to Cloudflare KV
 * 
 * This script uploads the catalog.json to Cloudflare KV for edge serving.
 * KV reads are FREE and unlimited, perfect for serving the catalog to many users.
 * 
 * Prerequisites:
 * 1. Install wrangler: npm install -g wrangler
 * 2. Login to Cloudflare: wrangler login
 * 3. Create KV namespace: wrangler kv:namespace create "CATALOG_DB"
 * 4. Note the namespace ID and add to wrangler.toml
 * 
 * Usage:
 *   node scripts/upload-to-kv.js
 *   node scripts/upload-to-kv.js --dry-run   # Preview without uploading
 * 
 * KV Structure:
 *   "catalog" - Full array of series (JSON)
 *   "stats" - Database statistics
 *   "filterOptions" - Genre/studio options for filters
 *   "buildDate" - When the database was built
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

// Paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const CATALOG_GZ = path.join(DATA_DIR, 'catalog.json.gz');
const CATALOG_JSON = path.join(DATA_DIR, 'catalog.json');
const FILTER_OPTIONS = path.join(DATA_DIR, 'filter-options.json');

// Configuration - UPDATE THESE
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID || 'YOUR_NAMESPACE_ID_HERE';
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || 'YOUR_ACCOUNT_ID_HERE';

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');

async function main() {
  console.log('📤 Upload Database to Cloudflare KV');
  console.log('=====================================\n');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No actual uploads\n');
  }

  // Load the database
  console.log('Loading database...');
  let database;
  
  try {
    if (fs.existsSync(CATALOG_GZ)) {
      const compressed = fs.readFileSync(CATALOG_GZ);
      const raw = zlib.gunzipSync(compressed).toString('utf-8');
      database = JSON.parse(raw);
      console.log(`✅ Loaded from ${CATALOG_GZ}`);
    } else if (fs.existsSync(CATALOG_JSON)) {
      const raw = fs.readFileSync(CATALOG_JSON, 'utf-8');
      database = JSON.parse(raw);
      console.log(`✅ Loaded from ${CATALOG_JSON}`);
    } else {
      console.error('❌ No catalog file found! Run build-database.js first.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to load database:', error.message);
    process.exit(1);
  }

  // Extract catalog array
  const catalog = database.catalog || [];
  console.log(`📊 Catalog contains ${catalog.length} series\n`);

  // Calculate sizes
  const catalogJson = JSON.stringify(catalog);
  const catalogSize = Buffer.byteLength(catalogJson, 'utf8');
  console.log(`📦 Catalog size: ${(catalogSize / 1024 / 1024).toFixed(2)} MB`);

  // KV value limit is 25MB, so we should be fine for most catalogs
  if (catalogSize > 25 * 1024 * 1024) {
    console.error('❌ Catalog too large for single KV value (>25MB)');
    console.log('   Consider chunking the catalog.');
    process.exit(1);
  }

  // Prepare upload data
  const uploads = [
    {
      key: 'catalog',
      value: catalogJson,
      description: 'Full catalog array'
    },
    {
      key: 'stats',
      value: JSON.stringify({
        totalSeries: catalog.length,
        providers: database.stats?.byProvider || {},
        buildDate: database.buildDate
      }),
      description: 'Database statistics'
    },
    {
      key: 'buildDate',
      value: database.buildDate || new Date().toISOString(),
      description: 'Build timestamp'
    }
  ];

  // Load filter options if available
  if (fs.existsSync(FILTER_OPTIONS)) {
    try {
      const filterOptions = fs.readFileSync(FILTER_OPTIONS, 'utf-8');
      uploads.push({
        key: 'filterOptions',
        value: filterOptions,
        description: 'Genre/studio filter options'
      });
    } catch (e) {
      console.warn('⚠️ Could not load filter-options.json');
    }
  }

  // Upload to KV
  console.log('\n📤 Uploading to KV...\n');
  
  for (const upload of uploads) {
    const sizeKB = (Buffer.byteLength(upload.value, 'utf8') / 1024).toFixed(1);
    console.log(`  ${upload.key}: ${upload.description} (${sizeKB} KB)`);
    
    if (!dryRun) {
      try {
        // Write to temp file (wrangler reads from file for large values)
        const tempFile = path.join(DATA_DIR, `.kv-temp-${upload.key}.json`);
        fs.writeFileSync(tempFile, upload.value);
        
        // Use wrangler to upload
        const cmd = `wrangler kv:key put --namespace-id="${KV_NAMESPACE_ID}" "${upload.key}" --path="${tempFile}"`;
        
        if (verbose) {
          console.log(`     Running: ${cmd}`);
        }
        
        execSync(cmd, { stdio: verbose ? 'inherit' : 'pipe' });
        
        // Clean up temp file
        fs.unlinkSync(tempFile);
        
        console.log(`     ✅ Uploaded`);
      } catch (error) {
        console.error(`     ❌ Failed: ${error.message}`);
        
        if (error.message.includes('namespace-id')) {
          console.log('\n⚠️  KV Namespace not configured!');
          console.log('    1. Run: wrangler kv:namespace create "CATALOG_DB"');
          console.log('    2. Copy the namespace ID');
          console.log('    3. Set KV_NAMESPACE_ID env var or update this script');
        }
      }
    } else {
      console.log(`     [Dry run - would upload]`);
    }
  }

  // Summary
  console.log('\n=====================================');
  if (dryRun) {
    console.log('✅ Dry run complete. Use without --dry-run to upload.');
  } else {
    console.log('✅ Upload complete!');
    console.log('\nNext steps:');
    console.log('1. Deploy the edge worker: wrangler deploy cloudflare-workers/addon-edge.js');
    console.log('2. Update Stremio to use the new worker URL');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
