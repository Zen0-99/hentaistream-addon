# 🔍 Data Flow Visualization - Current vs Expected

## 📊 CURRENT DATA FLOW (Broken State)

### **Step 1: Catalog Request**
```
User opens Stremio → Requests catalog
                     ↓
              hentaimama.getCatalog(page=1)
                     ↓
         Fetches https://hentaimama.io/episodes?page=1
                     ↓
         Parses HTML: article.post elements
                     ↓
    For each episode card:
    ├─ title: "Toga Captured Bakugo"
    ├─ episodeSlug: "toga-captured-bakugo-episode-1"
    ├─ poster: "https://.../snapshot_03.42.jpg" ✓ Episode 1 snapshot
    ├─ seriesSlug: "toga-captured-bakugo"
    └─ episodeNumber: 1
                     ↓
         Groups by seriesSlug → Map
                     ↓
    seriesMap.set("toga-captured-bakugo", {
      id: "hmm-toga-captured-bakugo",
      name: "Toga Captured Bakugo",
      poster: "https://.../snapshot_03.42.jpg", ← Episode 1's snapshot
      genres: ["Hentai"],
      episodes: [
        { number: 1, slug: "...-episode-1", poster: "snapshot_03.42.jpg" },
        { number: 2, slug: "...-episode-2", poster: "snapshot_05.21.jpg" }, ← Different!
        { number: 3, slug: "...-episode-3", poster: "snapshot_02.15.jpg" }  ← Different!
      ]
    })
                     ↓
         Returns array of series objects
                     ↓
    Stremio Catalog Display:
    ┌────────────────────────┐
    │ [Episode 1 snapshot]   │ ← Same image for all episodes
    │ Toga Captured Bakugo   │
    │ Genres: Hentai         │ ← Generic
    │ 3 episodes available   │
    └────────────────────────┘
```

---

### **Step 2: Detail View Request**
```
User clicks series → Requests metadata
                     ↓
         hentaimama.getMetadata("hmm-toga-captured-bakugo")
                     ↓
    Derives: seriesSlug = "toga-captured-bakugo"
    Constructs: episodeSlug = "toga-captured-bakugo-episode-1"
                     ↓
         Fetches https://hentaimama.io/episodes/toga-captured-bakugo-episode-1
                     ↓
    Parses Episode 1 page:
    ├─ og:image: "https://.../snapshot_00.55.jpg" ← Different snapshot from ep1
    ├─ title: "Toga Captured Bakugo Episode 1"
    ├─ genres: ["Cosplay", "Large Breasts", "NTR"]
    └─ description: "Full description text..."
                     ↓
    Discovers related episodes:
    ├─ Searches catalog pages 1-3
    └─ Finds links matching seriesSlug
                     ↓
    Builds episodes array:
    episodesMap = {
      1: { number: 1, slug: "...-episode-1", title: "Episode 1" },  ← NO POSTER!
      2: { number: 2, slug: "...-episode-2", title: "Episode 2" },  ← NO POSTER!
      3: { number: 3, slug: "...-episode-3", title: "Episode 3" }   ← NO POSTER!
    }
                     ↓
         Returns metadata object:
    {
      name: "Toga Captured Bakugo",
      poster: "https://.../snapshot_00.55.jpg", ← Series cover (og:image)
      genres: ["Cosplay", "Large Breasts", "NTR"],
      description: "Full description...",
      episodes: [
        { number: 1, slug: "...", title: "Episode 1" },  ← No poster
        { number: 2, slug: "...", title: "Episode 2" },  ← No poster
        { number: 3, slug: "...", title: "Episode 3" }   ← No poster
      ]
    }
                     ↓
         meta.js transforms to Stremio format:
    {
      id: "hmm-toga-captured-bakugo",
      name: "Toga Captured Bakugo",
      poster: "https://.../snapshot_00.55.jpg",
      genres: ["Cosplay", "Large Breasts", "NTR"],
      videos: [
        { episode: 1, thumbnail: "snapshot_00.55.jpg" },  ← Series poster
        { episode: 2, thumbnail: "snapshot_00.55.jpg" },  ← Same!
        { episode: 3, thumbnail: "snapshot_00.55.jpg" }   ← Same!
      ]
    }
                     ↓
    Stremio Detail Display:
    ┌──────────────────────────────────┐
    │ [Episode 1 og:image snapshot]    │
    │ Toga Captured Bakugo             │
    │                                  │
    │ Genres: Cosplay, Large Breasts..│ ✓ Full genres now
    │ Description: Full text...        │ ✓ Full description
    │                                  │
    │ Episodes:                        │
    │ ┌─────────────────────┐          │
    │ │ [snapshot_00.55]    │ Episode 1│ ← Same
    │ └─────────────────────┘          │
    │ ┌─────────────────────┐          │
    │ │ [snapshot_00.55]    │ Episode 2│ ← Same! ❌
    │ └─────────────────────┘          │
    │ ┌─────────────────────┐          │
    │ │ [snapshot_00.55]    │ Episode 3│ ← Same! ❌
    │ └─────────────────────┘          │
    └──────────────────────────────────┘
```

**THE PROBLEM:** Episodes 2 and 3 have their own unique snapshots in the catalog, but we're not preserving them!

---

## ✅ EXPECTED DATA FLOW (Fixed State)

### **Step 1: Catalog Request** (Same)
```
User opens Stremio → getCatalog()
                     ↓
    Series: {
      poster: "snapshot_03.42.jpg", ← Episode 1 snapshot (acceptable)
      episodes: [
        { number: 1, poster: "snapshot_03.42.jpg" },
        { number: 2, poster: "snapshot_05.21.jpg" },
        { number: 3, poster: "snapshot_02.15.jpg" }
      ]
    }
```

---

### **Step 2: Detail View Request** (FIXED)
```
User clicks series → getMetadata()
                     ↓
    Fetches Episode 1 page:
    ├─ og:image: "snapshot_00.55.jpg" ← Series cover
    ├─ genres: ["Cosplay", ...]
    └─ description: "..."
                     ↓
    Discovers episodes from catalog:
    ├─ Searches catalog pages
    └─ For EACH matching article:
         ├─ Extract href → episodeSlug
         └─ Extract img data-src → poster ✓ NEW!
                     ↓
    Builds episodes array WITH posters:
    [
      { number: 1, slug: "...-episode-1", poster: "snapshot_03.42.jpg" }, ✓
      { number: 2, slug: "...-episode-2", poster: "snapshot_05.21.jpg" }, ✓
      { number: 3, slug: "...-episode-3", poster: "snapshot_02.15.jpg" }  ✓
    ]
                     ↓
         Returns metadata WITH episode posters:
    {
      poster: "snapshot_00.55.jpg", ← Series cover (og:image)
      episodes: [
        { number: 1, poster: "snapshot_03.42.jpg" }, ✓
        { number: 2, poster: "snapshot_05.21.jpg" }, ✓
        { number: 3, poster: "snapshot_02.15.jpg" }  ✓
      ]
    }
                     ↓
         meta.js uses INDIVIDUAL posters:
    videos: episodes.map(ep => ({
      episode: ep.number,
      thumbnail: ep.poster || data.poster ✓ NEW!
    }))
                     ↓
    Stremio Detail Display:
    ┌──────────────────────────────────┐
    │ [Series Cover: snapshot_00.55]   │ ← og:image
    │ Toga Captured Bakugo             │
    │                                  │
    │ Genres: Cosplay, Large Breasts..│ ✓
    │ Description: Full text...        │ ✓
    │                                  │
    │ Episodes:                        │
    │ ┌─────────────────────┐          │
    │ │ [snapshot_03.42]    │ Episode 1│ ← Episode 1's snapshot ✓
    │ └─────────────────────┘          │
    │ ┌─────────────────────┐          │
    │ │ [snapshot_05.21]    │ Episode 2│ ← Episode 2's snapshot ✓
    │ └─────────────────────┘          │
    │ ┌─────────────────────┐          │
    │ │ [snapshot_02.15]    │ Episode 3│ ← Episode 3's snapshot ✓
    │ └─────────────────────┘          │
    └──────────────────────────────────┘
```

**THE FIX:** Each episode now displays its own unique thumbnail!

---

## 🔍 KEY DIFFERENCES

| Component | Current Behavior | Expected Behavior |
|-----------|-----------------|-------------------|
| **Catalog Series Poster** | Episode 1 catalog snapshot | Episode 1 catalog snapshot ✓ (Same) |
| **Catalog Genres** | "Hentai" (generic) | "Hentai" (generic) ✓ (Acceptable) |
| **Detail Series Poster** | Episode 1 og:image | Episode 1 og:image ✓ (Same) |
| **Detail Genres** | Full genres from episode | Full genres from episode ✓ (Same) |
| **Episode 1 Thumbnail** | Series poster | Episode 1's own snapshot ✓ (Fixed) |
| **Episode 2 Thumbnail** | Series poster ❌ | Episode 2's own snapshot ✓ (Fixed) |
| **Episode 3 Thumbnail** | Series poster ❌ | Episode 3's own snapshot ✓ (Fixed) |

---

## 📝 CODE CHANGES REQUIRED

### **1. In `hentaimama.js` → `getMetadata()`**

**Current Code (Lines ~230-260):**
```javascript
$catalog('article a[href*="episodes"]').each((i, elem) => {
  const href = $catalog(elem).attr('href');
  if (href && href.includes(seriesSlug)) {
    const epSlugMatch = href.match(/episodes\/([\w-]+)/);
    if (epSlugMatch) {
      const epSlug = epSlugMatch[1];
      const epNumMatch = epSlug.match(/-episode-(\d+)$/);
      if (epNumMatch) {
        const epNum = parseInt(epNumMatch[1]);
        if (!episodesMap.has(epNum)) {
          episodesMap.set(epNum, {
            number: epNum,
            slug: epSlug,
            id: `hmm-${epSlug}`,
            title: `Episode ${epNum}`
            // ❌ Missing: poster field
          });
        }
      }
    }
  }
});
```

**Fixed Code:**
```javascript
$catalog('article').each((i, elem) => {
  const $article = $catalog(elem);
  const href = $article.find('a[href*="episodes"]').attr('href');
  
  if (href && href.includes(seriesSlug)) {
    const epSlugMatch = href.match(/episodes\/([\w-]+)/);
    if (epSlugMatch) {
      const epSlug = epSlugMatch[1];
      const epNumMatch = epSlug.match(/-episode-(\d+)$/);
      
      if (epNumMatch) {
        const epNum = parseInt(epNumMatch[1]);
        
        // ✓ NEW: Extract episode-specific thumbnail
        let episodePoster = $article.find('img').first().attr('data-src') ||
                           $article.find('img').first().attr('src') ||
                           '';
        
        // Clean up poster URL
        if (episodePoster && !episodePoster.startsWith('http')) {
          episodePoster = episodePoster.startsWith('//') 
            ? `https:${episodePoster}` 
            : `${this.baseUrl}${episodePoster}`;
        }
        
        if (!episodesMap.has(epNum)) {
          episodesMap.set(epNum, {
            number: epNum,
            slug: epSlug,
            id: `hmm-${epSlug}`,
            title: `Episode ${epNum}`,
            poster: episodePoster || undefined  // ✓ NEW: Include poster
          });
        }
      }
    }
  }
});
```

---

### **2. In `meta.js` → `metaHandler()`**

**Current Code (Lines ~32-38):**
```javascript
videos: (data.episodes || []).map(ep => ({
  id: `${ep.id}:1:${ep.number}`,
  title: ep.title || `Episode ${ep.number}`,
  season: 1,
  episode: ep.number,
  thumbnail: data.poster || undefined,  // ❌ All episodes get series poster
}))
```

**Fixed Code:**
```javascript
videos: (data.episodes || []).map(ep => ({
  id: `${ep.id}:1:${ep.number}`,
  title: ep.title || `Episode ${ep.number}`,
  season: 1,
  episode: ep.number,
  thumbnail: ep.poster || data.poster || undefined,  // ✓ Use episode's own poster
}))
```

---

## 🎯 VALIDATION CHECKLIST

After implementing these changes, verify:

- [ ] **Catalog View**: Series poster shows Episode 1's snapshot (unchanged)
- [ ] **Catalog View**: Genres show "Hentai" (acceptable limitation)
- [ ] **Detail View**: Series poster shows Episode 1's og:image (unchanged)
- [ ] **Detail View**: Full genres displayed (unchanged)
- [ ] **Episode List**: Episode 1 has its own thumbnail (FIXED)
- [ ] **Episode List**: Episode 2 has its own thumbnail (FIXED)
- [ ] **Episode List**: Episode 3 has its own thumbnail (FIXED)
- [ ] **Episode List**: Each thumbnail is different (FIXED)

---

## 🔍 TESTING COMMANDS

```powershell
# Test catalog
node test-scraper.js

# Test metadata for a specific series
# (After identifying a series ID from catalog)
```

Example series to test:
- `hmm-toga-captured-bakugo`
- `hmm-netorareta-bakunyuu-tsuma-tachi`

Verify that:
1. Each episode in the videos array has a unique thumbnail URL
2. Thumbnail URLs contain different timestamps/snapshots
3. No episode uses the series poster unless its own thumbnail is missing

---

## 📊 VISUAL COMPARISON

### **Before (Current - Broken)**
```
Series Detail View:
┌────────────────────┐
│  [Series Poster]   │
│                    │
│  Episodes:         │
│  ┌──────┐          │
│  │[IMG] │ Ep 1     │ ← Same image
│  ├──────┤          │
│  │[IMG] │ Ep 2     │ ← Same image
│  ├──────┤          │
│  │[IMG] │ Ep 3     │ ← Same image
│  └──────┘          │
└────────────────────┘
```

### **After (Fixed)**
```
Series Detail View:
┌────────────────────┐
│  [Series Poster]   │
│                    │
│  Episodes:         │
│  ┌──────┐          │
│  │[IMG1]│ Ep 1     │ ← Unique
│  ├──────┤          │
│  │[IMG2]│ Ep 2     │ ← Unique
│  ├──────┤          │
│  │[IMG3]│ Ep 3     │ ← Unique
│  └──────┘          │
└────────────────────┘
```

---

## ✅ SUMMARY

The fix is **simple and targeted**:

1. **Root Cause**: Episode thumbnails captured in catalog but lost during metadata building
2. **Solution**: Re-extract episode thumbnails when discovering episodes from catalog
3. **Changes**: 2 code blocks (one in `getMetadata()`, one in `meta.js`)
4. **Result**: Each episode displays its own unique snapshot

This aligns with the user's requirement: "each episode has the same image - they don't!"
