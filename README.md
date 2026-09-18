# Movie Shelf

A personal movie/disc collection tracker and watchlist, built as a small
vanilla JS app — no framework, no build step, no bundler.

**Live app:** https://movie-shelf-six.vercel.app (owner-only, requires sign-in)
**Public demo:** https://movie-shelf-six.vercel.app/demo.html (no login, sample data, changes stay in your browser)

## What it does

- Tracks a personal collection of owned movies (DVD/Blu-ray/4K/Digital),
  each with metadata pulled from [TMDB](https://www.themoviedb.org/) and
  [OMDb](https://www.omdbapi.com/) — cast, crew, genres, ratings, poster —
  plus per-copy details (edition, aspect ratio, audio/subtitle languages).
  A title with multiple owned copies (e.g. a DVD *and* a Blu-ray of the same
  film) is one row, not two.
- A separate, independent **Watchlist** for titles you don't own yet, with
  cached streaming availability for Poland (via TMDB's JustWatch-powered
  data) — posters are shown in color when a title is streaming somewhere
  and grayscale when it isn't.
- Add flow is search-driven: type a title (debounced live search) or paste
  an IMDb ID, pick the right result, and the app pulls in a full
  TMDB+OMDb-merged preview before you confirm. No manual data entry for new
  titles.
- Grid and list views, word-boundary search, sortable/resizable list
  columns, and a filter panel (decade, genre, country, format, watched
  status, streaming availability, and more).
- A public demo mode with a curated, frozen subset of the real data —
  fully client-side, no backend calls, changes persist only in your own
  browser's `localStorage`.

## Stack

- **Frontend:** vanilla HTML/CSS/JS — one shared `app.js` powers both the
  real app and the demo, branching on a `DEMO_MODE` flag.
- **Backend:** [Supabase](https://supabase.com/) (Postgres + Auth), with
  Row Level Security scoping every row to a single owner account.
- **APIs:** [TMDB](https://www.themoviedb.org/documentation/api) and
  [OMDb](http://www.omdbapi.com/) for movie/TV metadata, proxied through a
  couple of Vercel serverless functions so the API keys never reach the
  client and the free-tier quota can't be hit by anonymous traffic.
- **Hosting:** [Vercel](https://vercel.com/), git-connected — every push to
  `main` auto-deploys.

## Running locally

No build step, no dependencies to install for the frontend itself.

```bash
python3 scripts/serve.py
```

This serves the app at `http://localhost:4173` with caching disabled, so
edits to `app.js`/`styles.css`/etc. show up on refresh immediately. A plain
`python3 -m http.server` also works, but will cache `app.js` aggressively
between edits.

The real app (`index.html`) requires a Supabase project with a `movies` and
a `watchlist` table and a signed-in session — without that you'll be
redirected to the sign-in page. `demo.html` needs nothing and works fully
offline once loaded.

The two `/api` serverless functions (`movie-search`, `movie-lookup`,
`watch-providers`) require `TMDB_API_KEY` and `OMDB_API_KEY` environment
variables and only run on Vercel (locally, calls to `/api/*` will 404
against the plain static server above).

## Project layout

```
index.html, demo.html, login.html   — the three page shells
app.js                              — shared app logic for both real & demo
supabaseClient.js                   — Supabase client init (public anon key)
styles.css                          — single shared stylesheet, dark theme
api/                                — Vercel serverless functions (TMDB/OMDb proxies)
data/                               — frozen JSON snapshots used only by the demo
scripts/                            — local dev server + one-off data-pipeline scripts
```

## License

Personal project, no license file — not intended for reuse as-is.
