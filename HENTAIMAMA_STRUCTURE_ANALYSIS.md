## 🔍 HentaiMama Structure Analysis Report

Based on exploration of the actual HentaiMama website, here are the findings:

### 1. **CATALOG PAGE STRUCTURE** (https://hentaimama.io/episodes)

#### Episode Cards
Each `<article>` contains:
```html
<div class="poster">
    <img data-src="[EPISODE_THUMBNAIL_URL]" alt="[Series Name] Episode [X]">
    <div class="season_m">
        <a href="/episodes/[episode-slug]/">
            <span class="b">[Series Name]</span>
            <span class="c">Episode [X]</span>
        </a>
    </div>
    <span class="serie">[Series Name]</span>
</div>
```

#### Key Observations:
- **Episode Thumbnail**: `data-src` attribute contains the EPISODE-SPECIFIC screenshot
  - Example: `toga-x-bakugo-captured-greatm8_1080p.mp4_snapshot_03.42_2025.11.27_02.51.12.jpg`
  - These are **video snapshots**, NOT series cover art
  - Located in: `/wp-content/uploads/YYYY/MM/[filename].jpg`

- **Series Name**: Available in TWO places:
  - `<span class="b">` - Main series name (without episode number)
  - `<span class="serie">` - Also contains series name

- **Episode Number**: 
  - `<span class="c">` - Contains "Episode X"

---

### 2. **EPISODE PAGE STRUCTURE** (Individual episode URLs)

From the HTML response (even though it returned 500, we got the HTML):

#### Multiple OG Images (Series Cover Art)
```html
<meta property='og:image' content='https://hentaimama.io/wp-content/uploads/2025/11/toga-x-bakugo-captured-greatm8_1080p.mp4_snapshot_00.55_2025.11.27_02.50.49.jpg' />
<meta property='og:image' content='https://hentaimama.io/wp-content/uploads/2025/11/toga-x-bakugo-captured-greatm8_1080p.mp4_snapshot_02.18_2025.11.27_02.51.03.jpg' />
<meta property='og:image' content='https://hentaimama.io/wp-content/uploads/2025/11/toga-x-bakugo-captured-greatm8_1080p.mp4_snapshot_03.28_2025.11.27_02.50.41.jpg' />
```

**Important**: There are **multiple `og:image` tags** - these are likely:
1. First one: Could be used as series cover
2. Others: Additional screenshots from the episode

#### Full Title Pattern
```html
<meta property="og:title" content="Toga Captured Bakugo Episode 1" />
<title>Stream Toga Captured Bakugo Episode 1 with English subbed for free online – Hentaimama</title>
```

---

### 3. **THE CORE PROBLEM**

Based on your screenshots and the HTML structure:

#### Issue 1: **Catalog Thumbnails vs Series Cover Art**
- **Current**: We're showing episode-specific video snapshots in catalog
- **Expected**: Should show a consistent SERIES cover art (not episode snapshots)
- **Reality**: HentaiMama doesn't have separate "series cover art" - they only have episode screenshots
- **Solution Options**:
  1. Use the **first `og:image`** from episode 1 as the series cover
  2. Try to find a pattern for "cover" images vs "snapshot" images
  3. Use episode 1's thumbnail consistently for all episodes in a series

#### Issue 2: **Episode-Specific Thumbnails**
- **Current**: All episodes of a series show the same image (probably episode 1)
- **Expected**: Each episode should show its own thumbnail
- **Reality**: Each episode HAS its own thumbnail in the catalog
- **Problem**: We're grouping by series and only keeping one thumbnail
- **Solution**: When fetching metadata, we need to fetch EACH episode's thumbnail separately

#### Issue 3: **Series Metadata in Catalog Preview**
- **Current**: Catalog shows "Hentai" as the only genre
- **Expected**: Should show actual genres from the episode page
- **Reality**: Genres are NOT on the catalog page - they're on individual episode pages
- **Problem**: We'd need to fetch each episode's page to get genres (slow)
- **Solution Options**:
  1. Only show full genres in the detail view (when user clicks)
  2. Implement background fetching to enrich catalog over time
  3. Accept that catalog won't have detailed genres

---

### 4. **RECOMMENDED ARCHITECTURE CHANGES**

#### For Catalog (`getCatalog`)
1. **Group by series** (current ✓)
2. **Use first episode's thumbnail** as series poster temporarily
3. **Don't fetch individual episode pages** (too slow)
4. **Keep genres as "Hentai"** for now (can't get them without fetching each page)

#### For Series Metadata (`getMetadata`)
1. **Fetch episode 1's page** to get:
   - First `og:image` as **series cover art**
   - Full genres from tags
   - Description
2. **Find all related episodes** on that page
3. **For EACH episode**, store its **catalog thumbnail URL** (from the catalog)
4. **Build videos array** with:
   - Each episode's specific thumbnail
   - Episode number
   - Episode-specific ID

#### For Video Thumbnails in Stremio
- Each `video` object needs its own `thumbnail` property
- We need to map: episode slug → catalog thumbnail URL
- Store this mapping when building the catalog

---

### 5. **THE SERIES COVER IMAGE PROBLEM**

HentaiMama doesn't have traditional "series cover art". Options:

**Option A**: Use first `og:image` from episode 1
- Pros: Consistent per series, better quality
- Cons: Requires fetching episode page

**Option B**: Use episode 1's catalog thumbnail
- Pros: Already have it, no extra request
- Cons: It's a video snapshot, not a proper cover

**Option C**: Look for a pattern in image URLs
- Some sites have: `[series]-cover.jpg` vs `[series]-snapshot-XX.jpg`
- Need to test if HentaiMama follows this

---

### 6. **IMPLEMENTATION STRATEGY**

1. **Enhance `getCatalog()`**:
   - When grouping, store ALL episode thumbnails in an object
   - Structure: `{ episodeSlug: thumbnailURL }`

2. **Enhance `getMetadata()`**:
   - Fetch episode 1's page
   - Extract first `og:image` as series poster
   - Build episode list with individual thumbnails from catalog data

3. **Update handlers**:
   - Catalog handler: Pass episode thumbnail mapping to metadata
   - Meta handler: Use individual thumbnails for each video entry

4. **Add caching**:
   - Cache the episode thumbnail mapping
   - Cache series metadata separately from episodes

---

## ✅ CONCLUSIONS

1. **Series cover art**: Use first `og:image` from episode 1 page
2. **Episode thumbnails**: Store from catalog, use in video entries
3. **Catalog genres**: Accept "Hentai" only (or fetch on-demand later)
4. **Detail view genres**: Fetch from episode 1 page (already doing this)

This explains why your current implementation shows:
- Same image for all episodes (using episode 1 thumbnail for everything)
- Generic "Hentai" genre (no genres on catalog page)
- Different metadata between catalog and detail (catalog has less info)
