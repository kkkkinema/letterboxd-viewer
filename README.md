# Letterboxd Viewer — Editorial Film Journal

A 100% static, privacy-safe **Editorial Film Journal** synced automatically from your Letterboxd RSS feed and enriched with TMDB posters, widescreen backdrops, directors, runtimes, and genres. Forked and expanded from Michael Lamb's original `letterboxd-viewer`.

## Features

- **Editorial Magazine Design:** Dark obsidian & warm paper light themes, auto-advancing hero review carousel, poster grid & chronological diary views, rich search & filter drawer, and mobile touch gestures.
- **6 Editorial Share Card Styles:** Export `4:5` cards or `9:16` Instagram Stories directly from any film modal (**Folio · Affiche · Index · Matte · Noir · 35mm**) with automatic font scaling and justified typography.
- **Zero Image Bloat + Non-Destructive RSS Sync:** Posters and widescreen stills stream directly from TMDB's CDN. Every 6 hours, GitHub Actions updates new logs and review edits without ever touching your custom posters.
- **Local Poster Picker Studio (`poster-picker.cmd`):** Pick alternate TMDB art/textless/Criterion posters locally with favorites-first sorting and save them safely to `data/poster-overrides.json`.
- **Installable PWA:** Offline reading shell, capped TMDB poster cache, swipe-down modal dismiss, and a standalone mobile bottom bar.

---

## 5-Minute Setup (Free on GitHub Pages or Cloudflare Pages)

### 1. Fork this repository
Click **Fork** (or import into a **private** repo if you want to host free on Cloudflare Pages or Vercel).

### 2. Add 2 GitHub Actions Secrets
Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret Name | Value |
| :--- | :--- |
| `LETTERBOXD_RSS_URL` | `https://letterboxd.com/your-username/rss/` |
| `TMDB_API_KEY` | Your free [TMDB API key](https://www.themoviedb.org/settings/api) (v3 key or v4 Bearer token) |

### 3. Enable GitHub Pages (or connect Cloudflare Pages)
- **GitHub Pages:** Go to **Settings → Pages → Source: GitHub Actions**.
- **Cloudflare Pages (great for private repos):** Connect your repo with Build command:
  ```bash
  sed -i "s/__SW_VERSION__/$(printf '%s' "$CF_PAGES_COMMIT_SHA" | cut -c1-7)/g" sw.js
  ```
  and Build output directory `.`.

### 4. Sync Your Films
Go to the **Actions** tab → **RSS Feed Update** → **Run workflow**.  
*(Want your entire multi-year Letterboxd history? Export your data from Letterboxd settings and run `python scripts/import_export.py your-export.zip --fresh`, then `python scripts/enrich_metadata.py`.)*

### 5. Customize Your Branding
Update the title/copy in `index.html`, `about.html`, `manifest.json`, and `assets/js/share-cards.js` to make it yours.

---

## Optional: Customizing Posters Locally

1. Create a local `.env` file (gitignored) with `TMDB_API_KEY=your_key`.
2. Run `python scripts/poster_picker.py` (or double-click `poster-picker.cmd` on Windows).
3. Browse alternate TMDB posters, click to save to `data/poster-overrides.json`, and push when ready.

---

## License
MIT — see [LICENSE.md](LICENSE.md).
