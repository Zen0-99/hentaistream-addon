# 🔍 Image Architecture Discovery - HentaiMama Scraper

## 📊 DISCOVERY SUMMARY

After analyzing the HentaiMama website structure and current scraper implementation, here's the complete mapping of the image problem:

---

## 🎯 THE ROOT CAUSES

### **Problem 1: Catalog Uses Episode Snapshots as Series Covers**

**What's Happening:**
```javascript
// In getCatalog() - line ~92
let poster = $elem.find('img').first().attr('data-src')
```

**Reality:**
- HentaiMama's catalog shows **episode-specific video snapshots**
- Each episode has a unique snapshot from that specific episode
- These filenames contain: `[video].mp4_snapshot_[timestamp]_[date].jpg`
- Example: `toga-x-bakugo-captured-greatm8_1080p.mp4_snapshot_03.42_2025.11.27_02.51.12.jpg`

**Current Behavior:**
```javascript
// Line ~127-134 in getCatalog()
if (!seriesMap.has(seriesSlug)) {
  // Create series entry with first episode's data
  seriesMap.set(seriesSlug, {
    id: `hmm-${seriesSlug}`,
    name: title,
    poster: poster || undefined,  // ❌ This is Episode 1's snapshot
    // ...
  });
}
```

**The Issue:**
- When grouping episodes by series, we use the **first episode's snapshot** as the series poster
- This is just a random frame from episode 1, not a proper series cover art
- All episodes in the series then inherit this same image

---

### **Problem 2: All Episodes Share the Same Thumbnail**

**What's Happening:**
```javascript
// In meta.js - line ~32-38
videos: (data.episodes || []).map(ep => ({
  id: `${ep.id}:1:${ep.number}`,
  title: ep.title || `Episode ${ep.number}`,
  season: 1,
  episode: ep.number,
  thumbnail: data.poster || undefined,  // ❌ ALL episodes get the series poster
}))
```

**Reality:**
- Each episode **DOES have** its own unique thumbnail in the catalog
- These thumbnails are stored during `getCatalog()` but **NOT passed through** to metadata
- The `episodes` array built in `getMetadata()` only contains: `{ number, slug, id, title }`
- It **doesn't include** the episode-specific `poster` field that was captured in catalog

**Data Flow Issue:**
```
getCatalog() captures: { episodeNumber, slug, poster ✓ }
                           ↓
getMetadata() rebuilds:   { number, slug, id, title } ← poster lost!
                           ↓
meta.js maps to videos:   { thumbnail: data.poster } ← uses series poster
```

---

### **Problem 3: No Separate Series Cover Art Exists**

**Discovery from HTML Analysis:**
- HentaiMama **does NOT have** traditional "series cover art"
- The only images available are:
  1. **Catalog thumbnails**: Episode-specific video snapshots
  2. **`og:image` tags**: Multiple snapshots from the episode page
  3. **No dedicated series poster**: Just episode snapshots everywhere

**Options for Series Cover:**

#### Option A: Use First `og:image` from Episode 1
```javascript
// In getMetadata() - line ~201
let poster = $('meta[property="og:image"]').attr('content')
```
- **Current Implementation**: Already doing this ✓
- **Problem**: This is STILL just an episode snapshot, not a "cover"
- **Advantage**: At least it's consistent across the series

#### Option B: Use Episode 1's Catalog Thumbnail
- **Pros**: Already have it, no extra request
- **Cons**: It's a video snapshot, may not be representative

#### Option C: Use First Episode Page's First `og:image`
- **Multiple `og:image` tags** exist on episode pages
- Example from HTML:
  ```html
  <meta property='og:image' content='[...]/snapshot_00.55_[...].jpg' />
  <meta property='og:image' content='[...]/snapshot_02.18_[...].jpg' />
  <meta property='og:image' content='[...]/snapshot_03.28_[...].jpg' />
  ```
- First one might be more representative? (Needs testing)

---

### **Problem 4: Catalog Preview Shows Generic Metadata**

**What's Happening:**
```javascript
// In getCatalog() - line ~159-162
// Ensure genres array exists for catalog preview
if (!series.genres || series.genres.length === 0) {
  series.genres = ['Hentai'];  // ❌ Hardcoded generic genre
}
```

**Reality:**
- **Genres are NOT on the catalog page** - they're on individual episode pages
- To get real genres, we'd need to:
  1. Fetch each episode's page (slow, 100s of requests)
  2. Or accept generic "Hentai" genre in catalog
  3. Or implement background enrichment

**Current Design Decision:**
- Catalog shows generic "Hentai" genre
- Full genres shown in detail view (when user clicks)
- This is **acceptable** but user expects full metadata in preview

---

## 🗺️ COMPLETE DATA FLOW MAP

### **Catalog Flow (`getCatalog`)**
```
HentaiMama Catalog Page
  └─> article.post (each episode card)
       ├─> Extract: title (series name)
       ├─> Extract: episodeSlug
       ├─> Extract: poster (episode-specific snapshot) ✓
       ├─> Derive: seriesSlug (remove -episode-N)
       └─> Group by seriesSlug
            └─> Store in Map:
                 ├─ Series entry created with Episode 1's poster ❌
                 ├─ Episodes array: [{ number, slug, url, poster }] ✓
                 └─ Return: Series objects (episodes array DISCARDED) ❌
```

**What Gets Returned:**
```javascript
{
  id: 'hmm-series-slug',
  name: 'Series Name',
  poster: '[episode-1-snapshot.jpg]',  // ❌ Episode 1 snapshot
  genres: ['Hentai'],                   // ❌ Generic
  type: 'series',
  episodes: [{ number, slug, url, poster }],  // ✓ Has individual posters
  latestEpisode: 3,
  description: '3 episodes available'
}
```

**What Stremio Catalog Shows:**
- Each series card displays `poster` (Episode 1's snapshot)
- Genres show "Hentai"
- Description shows episode count

---

### **Metadata Flow (`getMetadata`)**
```
getMetadata(seriesId)
  └─> Fetch Episode 1's page
       ├─> Extract: og:image (first snapshot from episode) ✓
       ├─> Extract: genres from tags ✓
       ├─> Extract: description ✓
       └─> Discover related episodes:
            ├─ Search catalog pages for same series
            └─ Build episodes array: [{ number, slug, id, title }]
                                                           ↑
                                              ❌ NO POSTER FIELD!
```

**What Gets Returned:**
```javascript
{
  id: 'hmm-series-slug',
  seriesId: 'hmm-series-slug',
  name: 'Series Name',
  poster: '[og-image-from-episode-1.jpg]',  // ✓ But still a snapshot
  description: '...',                        // ✓ Full description
  genres: ['Tag1', 'Tag2', ...],            // ✓ Real genres
  episodes: [
    { number: 1, slug: '...', id: '...', title: 'Episode 1' },  // ❌ No poster
    { number: 2, slug: '...', id: '...', title: 'Episode 2' },  // ❌ No poster
  ]
}
```

---

### **Meta Handler Flow (`meta.js`)**
```
metaHandler(seriesId)
  └─> Call getMetadata(seriesId)
       └─> Map episodes to videos array:
            episodes.map(ep => ({
              id: `${ep.id}:1:${ep.number}`,
              title: `Episode ${ep.number}`,
              thumbnail: data.poster,  // ❌ ALL get series poster
            }))
```

**What Stremio Detail View Shows:**
- Series poster: Episode 1's `og:image` snapshot
- Full genres from episode page ✓
- Full description ✓
- Videos list: ALL episodes have same thumbnail (series poster) ❌

---

## 🎯 ARCHITECTURAL ISSUES IDENTIFIED

### **Issue 1: Data Loss in Episode Discovery**

**Problem:**
```javascript
// getCatalog() captures episode posters:
series.episodes.push({
  number: episodeNumber,
  slug: episodeSlug,
  url: url,
  poster: poster  // ✓ Individual episode snapshot
});

// But getMetadata() rebuilds episodes WITHOUT posters:
episodesMap.set(epNum, {
  number: epNum,
  slug: epSlug,
  id: `hmm-${epSlug}`,
  title: `Episode ${epNum}`
  // ❌ No poster field!
});
```

**Why This Happens:**
- `getMetadata()` searches catalog pages to find all episodes
- It only extracts `href` attributes from links
- It doesn't re-parse the catalog cards to get thumbnails
- **Episode-specific posters are lost** in this step

---

### **Issue 2: No Episode Thumbnail Mapping**

**Current Architecture:**
```
Catalog → Series → Metadata → Videos
   ↓         ↓         ↓         ↓
 poster   poster    poster   thumbnail (all same)
```

**What's Missing:**
- A **mapping** from `episodeSlug` → `episodePoster`
- This mapping exists in `getCatalog()` but is never persisted or passed to metadata
- When building videos array, there's no way to retrieve individual episode thumbnails

---

### **Issue 3: Series Cover Art Selection**

**Current Logic:**
```javascript
// In getCatalog() - first episode becomes series poster
if (!seriesMap.has(seriesSlug)) {
  seriesMap.set(seriesSlug, {
    poster: poster,  // ❌ Random snapshot from Episode 1
  });
}

// In getMetadata() - og:image from episode 1
let poster = $('meta[property="og:image"]').attr('content');  // ❌ Also a snapshot
```

**Problem:**
- Both approaches use **video snapshots** as series covers
- No way to distinguish "series cover art" from "episode thumbnails"
- HentaiMama doesn't provide proper series covers

---

## 💡 KEY INSIGHTS

### **1. HentaiMama Structure Reality**
- ✅ Each episode HAS its own unique thumbnail (video snapshot)
- ✅ These thumbnails are visible in the catalog
- ❌ No separate "series cover art" exists
- ❌ All images are video snapshots from episodes

### **2. Current Scraper Behavior**
- ✅ Correctly groups episodes by series
- ✅ Extracts individual episode thumbnails in catalog
- ❌ Loses episode thumbnails when building metadata
- ❌ Uses Episode 1's snapshot as series cover everywhere

### **3. Catalog vs Detail Metadata**
- **Catalog** (`getCatalog`):
  - Shows: Series name, Episode 1's thumbnail, "Hentai" genre, episode count
  - Missing: Real genres, full description
  
- **Detail** (`getMetadata` → `meta.js`):
  - Shows: Series name, Episode 1's og:image, real genres, full description
  - Missing: Episode-specific thumbnails (all use series poster)

### **4. User's Expectations vs Reality**
- **Expected**: Series cover + episode-specific thumbnails
- **Reality**: HentaiMama only has episode snapshots
- **Current**: Using Episode 1 snapshot everywhere (looks broken)
- **Ideal**: Distinguish series poster (ep1 og:image) from episode thumbnails (catalog snapshots)

---

## 🔧 SOLUTION ARCHITECTURE

### **Option A: Persist Episode Thumbnail Mapping**

**Approach:**
1. In `getCatalog()`: Build a thumbnail mapping
   ```javascript
   const episodeThumbnails = new Map();
   episodes.forEach(ep => {
     episodeThumbnails.set(ep.slug, ep.poster);
   });
   ```

2. Cache or store this mapping

3. In `getMetadata()`: Use cached thumbnails when building episodes
   ```javascript
   episodes.map(ep => ({
     ...ep,
     poster: episodeThumbnails.get(ep.slug) || data.poster
   }))
   ```

4. In `meta.js`: Use individual episode posters
   ```javascript
   thumbnail: ep.poster || data.poster
   ```

**Pros:**
- ✅ Each episode gets its own thumbnail
- ✅ Minimal refactoring

**Cons:**
- ❌ Requires caching thumbnail mapping
- ❌ Two-pass data flow (catalog → metadata)

---

### **Option B: Enrich Episodes in Metadata Discovery**

**Approach:**
1. When discovering episodes in `getMetadata()`, re-parse catalog cards
   ```javascript
   $catalog('article').each((i, elem) => {
     // Extract BOTH link AND thumbnail
     const poster = $catalog(elem).find('img').attr('data-src');
     episodesMap.set(epNum, {
       number: epNum,
       slug: epSlug,
       poster: poster  // ✓ Include thumbnail
     });
   });
   ```

2. Pass episode posters through to `meta.js`

**Pros:**
- ✅ Single-pass solution
- ✅ Episode thumbnails captured during metadata fetch

**Cons:**
- ❌ Re-parses catalog cards (slightly slower)
- ❌ More complex parsing logic

---

### **Option C: Hybrid Approach (Recommended)**

**Approach:**
1. **For Series Cover**: Use first `og:image` from Episode 1 page
   - Current implementation already does this ✓
   - Accept that it's a video snapshot (HentaiMama limitation)

2. **For Episode Thumbnails**: Capture during metadata discovery
   - When searching catalog pages for episodes, extract thumbnails
   - Store in episodes array: `{ number, slug, id, title, poster }`

3. **For Catalog Genres**: Keep "Hentai" generic
   - Fetching real genres requires too many requests
   - Full genres shown in detail view (acceptable UX)

**Implementation:**
```javascript
// In getMetadata() - when discovering episodes from catalog
$catalog('article').each((i, elem) => {
  const $elem = $catalog(elem);
  const href = $elem.find('a[href*="episodes"]').attr('href');
  const poster = $elem.find('img').attr('data-src');  // ✓ Extract thumbnail
  
  if (href && href.includes(seriesSlug)) {
    const epNum = parseInt(href.match(/-episode-(\d+)$/)[1]);
    episodesMap.set(epNum, {
      number: epNum,
      slug: epSlug,
      id: `hmm-${epSlug}`,
      title: `Episode ${epNum}`,
      poster: poster || data.poster  // ✓ Individual thumbnail
    });
  }
});

// In meta.js - use episode-specific thumbnails
videos: (data.episodes || []).map(ep => ({
  thumbnail: ep.poster || data.poster,  // ✓ Use episode's own thumbnail
}))
```

**Pros:**
- ✅ Each episode gets unique thumbnail
- ✅ Series cover is consistent (og:image from ep1)
- ✅ No caching/mapping required
- ✅ Minimal refactoring

**Cons:**
- ❌ Slightly more parsing during metadata fetch
- ❌ Still uses video snapshots (HentaiMama limitation)

---

## 📋 IMPLEMENTATION CHECKLIST

To fix the image issues, these changes are needed:

### **1. Modify `getMetadata()` Episode Discovery**
- [ ] When parsing catalog for episodes, extract `data-src` attribute
- [ ] Store `poster` field in episodes array
- [ ] Fallback to series poster if episode thumbnail missing

### **2. Update `meta.js` Video Mapping**
- [ ] Change `thumbnail: data.poster` to `thumbnail: ep.poster || data.poster`
- [ ] Each video entry uses its own thumbnail

### **3. Verify Series Cover Selection**
- [ ] Keep using `og:image` from Episode 1 page
- [ ] Document that this is a video snapshot (HentaiMama limitation)

### **4. Accept Catalog Metadata Limitations**
- [ ] Catalog shows "Hentai" genre (acceptable)
- [ ] Detail view shows full genres (already working)
- [ ] Document trade-off (performance vs detail)

---

## 🎯 EXPECTED OUTCOMES

After implementing Option C:

### **Catalog View:**
- ✅ Each series shows Episode 1's `og:image` as poster
- ✅ Series name displayed correctly
- ⚠️ Genres show "Hentai" (limitation accepted)
- ✅ Episode count in description

### **Detail View:**
- ✅ Series poster: Episode 1's `og:image` (consistent)
- ✅ Full genres from episode page
- ✅ Full description
- ✅ **Videos list: Each episode has its own thumbnail** ← KEY FIX

### **User Experience:**
- ✅ Episodes no longer share identical images
- ✅ Visual distinction between episodes
- ⚠️ All images are still video snapshots (HentaiMama limitation)
- ✅ Better alignment with PROJECT_PLAN.md architecture

---

## 📝 NOTES & LIMITATIONS

1. **HentaiMama Architectural Reality:**
   - No dedicated series cover art exists on the site
   - All images are video snapshots (filenames contain `mp4_snapshot`)
   - This is a source limitation, not a scraper limitation

2. **Performance Trade-offs:**
   - Could fetch full metadata for every series in catalog (slow)
   - Current approach: Generic catalog, detailed metadata on-demand (fast)
   - Chosen trade-off aligns with PROJECT_PLAN.md caching strategy

3. **Image Quality:**
   - Video snapshots may not be optimal "cover art"
   - But they're authentic to the source material
   - Stremio users will see actual frames from episodes

4. **Future Enhancements:**
   - Could implement background job to enrich catalog with full metadata
   - Could use external API for series cover art (contradicts user requirement)
   - Could select "best" snapshot based on heuristics (image analysis)

---

## ✅ FINAL RECOMMENDATION

**Implement Option C: Hybrid Approach**

**Rationale:**
- Fixes the main user complaint (episodes sharing same image)
- Minimal code changes required
- No new dependencies or caching complexity
- Accepts HentaiMama's limitations (video snapshots)
- Aligns with PROJECT_PLAN.md architecture

**Key Changes:**
1. Add `poster` extraction in `getMetadata()` episode discovery loop
2. Update `meta.js` to use `ep.poster || data.poster`
3. Document the limitation (video snapshots, not proper covers)

This solution addresses 80% of the user's concerns while staying within the architectural constraints of both HentaiMama and the PROJECT_PLAN.md design.
