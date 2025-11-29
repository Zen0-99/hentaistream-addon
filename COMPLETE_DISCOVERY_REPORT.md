# 🎯 COMPLETE DISCOVERY REPORT - HentaiMama Image Issue

## 📋 EXECUTIVE SUMMARY

**Issue**: User reported that all episodes in a series display the same thumbnail image, making them visually indistinguishable.

**Root Cause**: Episode-specific thumbnails are captured during catalog scraping but lost when building series metadata, causing all episodes to inherit the series poster.

**Solution**: Re-extract episode thumbnails during the metadata discovery phase and pass them through to the video entries.

**Impact**: Minimal - 2 small code changes fix the entire issue.

---

## 🔍 DISCOVERY FINDINGS

### **1. HentaiMama Website Structure**

#### Catalog Page (`/episodes`)
- Each episode card contains:
  - Series name in `<span class="serie">`
  - Episode-specific thumbnail in `<img data-src="...">`
  - Thumbnail is a **video snapshot** with timestamp in filename
  - Example: `video_1080p.mp4_snapshot_03.42_2025.11.27_02.51.12.jpg`

#### Episode Page (`/episodes/[slug]`)
- Multiple `<meta property="og:image">` tags with different snapshots
- Full genres in tag links (`<a rel="tag">`)
- Full description in `<meta property="og:description">`
- No separate "series cover art" - only video snapshots

**Key Insight**: HentaiMama does NOT have traditional "series cover art" - all images are video snapshots from specific episodes.

---

### **2. Current Scraper Behavior**

#### What's Working ✓
- Series grouping (episodes correctly grouped by series slug)
- Title extraction (series names parsed correctly)
- Thumbnail extraction in catalog (individual snapshots captured)
- Genre extraction from episode pages (full tags retrieved)
- Stream URL extraction (video playback works)

#### What's Broken ❌
- **Episode thumbnails lost**: Captured in `getCatalog()` but not preserved in `getMetadata()`
- **All episodes share one image**: Every episode uses series poster as thumbnail
- **Catalog metadata generic**: Shows "Hentai" instead of real genres (acceptable limitation)

---

### **3. Data Flow Analysis**

#### Current Flow (Broken)
```
getCatalog()
  ↓ Captures: { episode, poster: "snapshot_03.42.jpg" } ✓
  ↓
getMetadata() 
  ↓ Rebuilds: { episode } ← poster lost! ❌
  ↓
meta.js
  ↓ Maps: { thumbnail: seriesPoster } ← all episodes same! ❌
  ↓
Stremio
  ↓ Displays: All episodes with identical thumbnail ❌
```

#### Fixed Flow
```
getCatalog()
  ↓ Captures: { episode, poster: "snapshot_03.42.jpg" } ✓
  ↓
getMetadata()
  ↓ Re-extracts: { episode, poster: "snapshot_03.42.jpg" } ✓ NEW!
  ↓
meta.js
  ↓ Maps: { thumbnail: episodePoster || seriesPoster } ✓ NEW!
  ↓
Stremio
  ↓ Displays: Each episode with its own unique thumbnail ✓
```

---

## 🔧 SOLUTION DETAILS

### **Change 1: Extract Episode Posters in Metadata Discovery**

**File**: `src/scrapers/hentaimama.js`  
**Function**: `getMetadata()`  
**Location**: Lines ~230-260 (episode discovery loop)

**Current Code**:
```javascript
$catalog('article a[href*="episodes"]').each((i, elem) => {
  const href = $catalog(elem).attr('href');
  // ... extracts episode number and slug
  episodesMap.set(epNum, {
    number: epNum,
    slug: epSlug,
    id: `hmm-${epSlug}`,
    title: `Episode ${epNum}`
    // ❌ No poster field
  });
});
```

**Fix**:
```javascript
$catalog('article').each((i, elem) => {
  const $article = $catalog(elem);
  const href = $article.find('a[href*="episodes"]').attr('href');
  
  // ✓ NEW: Extract episode thumbnail
  let episodePoster = $article.find('img').first().attr('data-src') ||
                     $article.find('img').first().attr('src') ||
                     '';
  
  // Make absolute URL
  if (episodePoster && !episodePoster.startsWith('http')) {
    episodePoster = episodePoster.startsWith('//') 
      ? `https:${episodePoster}` 
      : `${this.baseUrl}${episodePoster}`;
  }
  
  episodesMap.set(epNum, {
    number: epNum,
    slug: epSlug,
    id: `hmm-${epSlug}`,
    title: `Episode ${epNum}`,
    poster: episodePoster || undefined  // ✓ NEW: Include poster
  });
});
```

**What Changed**:
- Now parses the full `<article>` element instead of just the link
- Extracts `data-src` attribute from the `<img>` tag
- Stores episode-specific poster in the episodes array
- Falls back to undefined if no image found

---

### **Change 2: Use Episode Posters in Video Entries**

**File**: `src/addon/handlers/meta.js`  
**Function**: `metaHandler()`  
**Location**: Lines ~32-38 (videos mapping)

**Current Code**:
```javascript
videos: (data.episodes || []).map(ep => ({
  id: `${ep.id}:1:${ep.number}`,
  title: ep.title || `Episode ${ep.number}`,
  season: 1,
  episode: ep.number,
  thumbnail: data.poster || undefined,  // ❌ All episodes get series poster
}))
```

**Fix**:
```javascript
videos: (data.episodes || []).map(ep => ({
  id: `${ep.id}:1:${ep.number}`,
  title: ep.title || `Episode ${ep.number}`,
  season: 1,
  episode: ep.number,
  thumbnail: ep.poster || data.poster || undefined,  // ✓ Use episode's poster first
}))
```

**What Changed**:
- Checks `ep.poster` first before falling back to `data.poster`
- Each episode now uses its own thumbnail if available
- Fallback ensures no broken images if thumbnail missing

---

## 📊 BEFORE vs AFTER

### **Catalog View** (Unchanged)
| Aspect | Before | After | Status |
|--------|--------|-------|--------|
| Series Poster | Episode 1 snapshot | Episode 1 snapshot | ✓ Same |
| Series Name | Correct | Correct | ✓ Same |
| Genres | "Hentai" (generic) | "Hentai" (generic) | ✓ Same |
| Episode Count | Shows count | Shows count | ✓ Same |

**Note**: Catalog remains unchanged - this is acceptable as fetching full metadata for every series would be too slow.

---

### **Detail View** (Fixed)
| Aspect | Before | After | Status |
|--------|--------|-------|--------|
| Series Poster | og:image from ep1 | og:image from ep1 | ✓ Same |
| Genres | Full tags | Full tags | ✓ Same |
| Description | Full text | Full text | ✓ Same |
| **Episode 1 Thumbnail** | Series poster | **Episode 1 snapshot** | ✅ FIXED |
| **Episode 2 Thumbnail** | Series poster | **Episode 2 snapshot** | ✅ FIXED |
| **Episode 3 Thumbnail** | Series poster | **Episode 3 snapshot** | ✅ FIXED |

---

## 🎯 USER COMPLAINTS ADDRESSED

### Original User Issues:
1. ✅ **"No proper titles"** - Fixed (series names displayed)
2. ✅ **"No thumbnails"** - Fixed (images extracted)
3. ✅ **"No metadata"** - Fixed (genres, description shown in detail view)
4. ✅ **"Episodes scattered"** - Fixed (grouped by series)
5. ✅ **"Each episode has same image"** - **FIXED BY THIS SOLUTION**
6. ⚠️ **"Cover image not correct"** - Partially addressed (using og:image, but it's still a video snapshot due to HentaiMama limitation)

---

## 📝 KNOWN LIMITATIONS

### **1. All Images Are Video Snapshots**
- **Reality**: HentaiMama doesn't provide dedicated "series cover art"
- **Impact**: Series posters and episode thumbnails are all video snapshots
- **Acceptable**: These are authentic to the source material

### **2. Catalog Shows Generic Genres**
- **Reality**: Full genres only available on individual episode pages
- **Impact**: Catalog shows "Hentai" for all series
- **Acceptable**: Full genres shown in detail view (on-demand)
- **Alternative**: Could fetch full metadata (too slow)

### **3. Series Cover May Not Be Representative**
- **Reality**: Using first `og:image` from episode 1 as series cover
- **Impact**: May not be the most representative frame
- **Acceptable**: Consistent across the series
- **Alternative**: Could analyze multiple frames (complex)

---

## 🔍 ARCHITECTURAL ALIGNMENT

### **With PROJECT_PLAN.md**
- ✅ **Self-contained**: No external APIs (all data from HentaiMama)
- ✅ **LRU caching**: Metadata cached (2h TTL)
- ✅ **Lightweight**: Minimal memory footprint
- ✅ **Stremio-native**: Uses addon SDK properly

### **With User Requirements**
- ✅ **"hentaimama itself should have ALL you need"** - No external APIs used
- ✅ **Proper series grouping** - Episodes grouped correctly
- ✅ **Distinct images per episode** - Each episode has unique thumbnail
- ✅ **Full metadata** - Genres, description, episode list

---

## ✅ VALIDATION STEPS

After implementing the fix:

1. **Test Catalog**:
   ```powershell
   node test-scraper.js
   ```
   - Verify series are grouped correctly
   - Check series posters are loaded

2. **Test Metadata**:
   - Pick a series with multiple episodes (e.g., `hmm-netorareta-bakunyuu-tsuma-tachi`)
   - Verify `episodes` array contains `poster` field for each episode
   - Check poster URLs are different for each episode

3. **Test Stremio Display**:
   - Open series detail view in Stremio
   - Scroll through episodes list
   - Verify each episode shows a different thumbnail

4. **Check Logs**:
   ```
   [INFO] Found 3 episodes for netorareta-bakunyuu-tsuma-tachi
   ```
   - Should show episode discovery
   - No errors about missing images

---

## 📚 DOCUMENTATION CREATED

1. **HENTAIMAMA_STRUCTURE_ANALYSIS.md**
   - Detailed HTML structure analysis
   - Explains image types and locations
   - Architectural recommendations

2. **IMAGE_ARCHITECTURE_DISCOVERY.md**
   - Complete data flow analysis
   - Root cause identification
   - Solution options comparison

3. **DATA_FLOW_VISUALIZATION.md**
   - Visual comparison of current vs expected behavior
   - Code change diffs
   - Validation checklist

4. **THIS FILE** (COMPLETE_DISCOVERY_REPORT.md)
   - Executive summary
   - Implementation guide
   - Testing procedures

---

## 🎯 NEXT STEPS

### For Implementation:
1. Apply Change 1 to `src/scrapers/hentaimama.js`
2. Apply Change 2 to `src/addon/handlers/meta.js`
3. Run tests to verify changes
4. Deploy and test in Stremio

### For Further Enhancement (Optional):
1. **Better Series Cover Selection**:
   - Could fetch ALL `og:image` tags and select "best" frame
   - Could use image analysis to find most representative frame
   - Could allow users to configure which frame to use

2. **Catalog Enrichment**:
   - Background job to fetch full metadata for popular series
   - Cache enriched catalog for better preview
   - Trade-off: complexity vs user experience

3. **Image Optimization**:
   - Could proxy images through addon for caching
   - Could resize thumbnails for faster loading
   - Trade-off: infrastructure vs simplicity

---

## ✨ CONCLUSION

**The Fix Is Simple**: 2 small code changes address the main user complaint.

**Why It Works**: By re-extracting episode thumbnails during metadata discovery and passing them through to video entries, each episode displays its own unique image.

**Limitations Accepted**: 
- Series covers are video snapshots (HentaiMama limitation)
- Catalog genres are generic (performance trade-off)

**Alignment**: Solution aligns with PROJECT_PLAN.md architecture and user's "no external APIs" requirement.

**Ready for Implementation**: All analysis complete, code changes identified, testing plan ready.

---

## 📞 CONTACT POINTS

Files to modify:
- `src/scrapers/hentaimama.js` (getMetadata function)
- `src/addon/handlers/meta.js` (metaHandler function)

Functions affected:
- `HentaiMamaScraper.getMetadata()` - Add poster extraction
- `metaHandler()` - Use episode posters

Testing files:
- `test-scraper.js` - Test catalog and metadata
- `test-metadata.js` - Test specific series

Documentation:
- All discovery documents in workspace root
- Reference PROJECT_PLAN.md for architecture
- Reference IMPLEMENTATION.md for component details
