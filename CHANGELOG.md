# Changelog

All notable changes to this project are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Entries
from 2026-09-20 onward were written as the work happened; entries before
that date (2026-09-15 through 2026-09-18) were backfilled from `git log`
and `HANDOFF.md` on 2026-09-22 and are coarser — grouped by day rather
than by individual session.

## [Unreleased]

## [2026-09-21]

### Added

- Mobile hamburger menu combining Add movie/Add to watchlist and Sign
  out below 640px, freeing up room for the search bar.
- Responsive breakpoint pass (tablet + mobile) across the whole app, not
  just the pages already covered — see Fixed below for what it caught.
- `tests/cardPreview.test.js`, `tests/mobileMenu.test.js`,
  `tests/gridColumns.test.js`, `tests/streamingRefreshThrottle.test.js`,
  `tests/emptyResultRetry.test.js`.

### Changed

- Movie cards on touch devices now require a deliberate second tap to
  open the detail drawer — the first tap previews the card's overlay
  (title/meta/scores), a second tap on that same card opens it, and
  tapping a different card moves the preview instead. Desktop
  mouse/keyboard is unaffected. Replaces relying on WebKit's native
  (and inconsistent) "first tap simulates hover" behavior.
- Add-movie preview goes to a stacked landscape layout (using the TMDB
  backdrop image) below 640px, instead of a narrow portrait thumbnail
  squeezed beside a long text column.
- The "Per row" grid-columns slider's maximum now scales down with the
  available width (recomputed on window resize too), instead of always
  allowing up to 8 columns regardless of how little room there is — that
  used to shrink posters far enough that card text and the hover overlay
  stopped fitting. The control itself is hidden below 640px, where the
  grid's column count is fixed by CSS anyway and the slider had no effect.
- Detail drawer is slightly narrower on phones (`92vw` → `85vw` of its
  `min(460px, …)` cap), leaving more backdrop visible to tap outside it
  and close it.
- The Add-movie panel's Format field and Cancel/Add-to-shelf buttons now
  wrap onto their own lines on narrow screens instead of being forced
  into one cramped row.

### Fixed

- **Add movie/Add to watchlist was completely broken in production**
  (`Unexpected token 'A', "A server e"... is not valid JSON`). Caused by
  `"type": "module"` in the root `package.json` (added for the test
  suite two entries up) silently changing how Vercel parses the
  CommonJS `/api/*` serverless functions, which then crashed on every
  request. Removed; the test suite doesn't need it. See `HANDOFF.md` §8
  — this must not be re-added without accounting for `/api`.
- **Severe, reproducible mobile unresponsiveness (black screen for
  minutes at a time)** — contributing factor: refreshing cached
  streaming availability for stale watchlist items fired one `fetch` +
  one Supabase write per item, completely unthrottled, on every
  real-app load. Now capped at 20 items/load, concurrency-limited to 4,
  oldest-stale-first, with debounced re-rendering. (Turned out not to be
  the whole story — see the next entry.)
- **Real iPhone: manual reload of the real app consistently showed 0
  movies**, nothing visibly broken — confirmed fixed after an on-device
  retest. Root cause was never directly confirmed; best working theory
  is a transient race with Supabase's session/token refresh on a cold
  client init, where a query can come back successfully empty (RLS
  matching zero rows) rather than erroring. Mitigation: an
  empty-but-successful movies/watchlist query right after load is now
  treated as suspicious and retried once, after re-checking the
  session — self-healing regardless of the exact cause. See
  `HANDOFF.md` §8.
- Movie cards on touch devices needed a 3rd tap to open the drawer
  (regression from the tap-to-preview change above): the original
  `:hover` CSS rules were still active on touch devices alongside the
  new tap-to-preview state, so WebKit's native hover-tap quirk and the
  deliberate two-tap logic were stacking. Both `:hover` rules are now
  scoped to `@media (hover: hover)` (real pointer devices only). Also
  fixed the flash-open-then-close drawer glitch, which was still
  reproducible before this.
- Add-movie/Edit modal: Cancel/Save (or Cancel/Add to shelf) buttons no
  longer hidden behind mobile Chrome's bottom toolbar — `overflow-y:
  auto` alone doesn't help when the toolbar covers part of the visible
  viewport without the layout viewport shrinking to match.
- Topbar: the "Add movie"/"Add to watchlist" button no longer gets
  clipped off the right edge on narrow screens (the search bar wasn't
  shrinking to make room), which was also the reason modals could
  require horizontal scrolling to see in full — same root cause, not a
  separate modal bug.
- Toolbar: Sort/Filters/Columns (list view) now wrap onto their own line
  on narrow screens instead of overflowing the page.
- Add-movie preview poster no longer stretches vertically to match the
  text column's height (a flex `align-items: stretch` bug, not just a
  mobile issue).
- Search bar placeholder text no longer overflows past the input's
  border on narrow screens.

## [2026-09-20]

### Added

- Automated test suite (Vitest + jsdom) covering the filter panel,
  Personal collection and Watchlist filtering, and the login page. Run
  with `npm install && npm test`. See `HANDOFF.md` §9.

### Changed

- Real app and login page now use clean URLs (`/login`, `/demo`) instead
  of `.html` extensions, via `vercel.json`'s `cleanUrls`. Internal links
  and redirects updated to point at the clean paths directly.
- Login page (`login.html`) rebuilt as a two-card layout (Sign in / Try
  the demo), restyled with the app's own dark palette instead of the
  layout it was modeled after.
- Filter panel (`styles.css`, `index.html`, `demo.html`) reworked from a
  flex-wrap layout to an explicit CSS Grid so filter groups line up into
  consistent columns regardless of tab or content length, and filters
  shared between Personal collection and Watchlist (Decade, Genre,
  Country) always land in the same grid cell. See `HANDOFF.md` §4.
- Personal collection's filter row order: Decade and Format swapped.
- Watchlist's filter row: Decade and Streaming service swapped, and
  Streaming service now spans two grid columns.
- Filter panel now closes on outside-click or Escape, not just the
  "Filters" toggle button.
- Increased the filter panel's column gap for more breathing room between
  groups.

### Fixed

- Filter panel: a long expanded chip list (Country, Streaming service) no
  longer stretches every other group sharing its row.
- Real app: a signed-out visitor no longer sees a flash of the (empty)
  app shell before being redirected to the login page — `index.html`
  hides itself until a session is confirmed.

## [2026-09-18]

### Added

- `README.md`: public-facing overview of the app (what it does, live and
  demo links, stack, how to run it locally, project layout). `HANDOFF.md`
  remains the detailed internal doc for future work sessions.

## [2026-09-16]

### Added

- `media_type` column (`movie`/`tv`) on `public.watchlist`, so the
  streaming-provider refresh calls TMDB's `/tv/...` endpoints instead of
  `/movie/...` for TV rows. Added after a bulk watchlist import initially
  skipped two TV shows (*Lonesome Dove*, *Rose Red*) because the lookup
  only checked TMDB's `movie_results`.
- Watchlist duplicate prevention: adding a title already in the
  watchlist (matched by IMDb ID) disables the confirm button with a
  notice instead of silently allowing a second copy.
- Watchlist tab in demo mode, backed by a frozen
  `data/watchlist-demo.json` (14 titles, a 7/7 streamable split plus one
  TV entry) with its own localStorage-backed remove flow, mirroring the
  collection demo.
- Detail drawer's Credits section shows "Creator" instead of "Director"
  for watchlist entries with `media_type: 'tv'`.

### Changed

- Collection's Delete button now uses the same press-again-to-confirm
  pattern as the Watchlist's Remove button, instead of
  `window.confirm()` — same suppression bug fixed there the day before.

## [2026-09-15]

### Added

- Initial prototype: vanilla HTML/CSS/JS movie collection app,
  localStorage-only, 545 movies — grid/list view, sort, word-boundary
  search, filters, sliding detail drawer, multi-copy support, watched
  toggle.
- Supabase-backed real app: `movies` table replaces the
  localStorage/static-JSON data layer, gated behind a Supabase
  email/password auth session (`login.html`/`login.js`).
- Public client-side demo (`demo.html`/`demo.js`, later merged into
  `app.js` — see Changed below): no login, zero Supabase calls, a
  curated subset of the collection (trimmed from 65 to 32 movies for a
  leaner deploy payload).
- `api/movie-lookup.js`: Vercel serverless function merging TMDB
  (poster, backdrop, original title/language, studios, cast with
  character names) and OMDb (rating, votes, Metascore, runtime, genres,
  countries, plot, director, writers) by IMDb ID or title+year, gated
  behind a valid Supabase session so the OMDb quota can't be hit
  anonymously.
- `api/movie-search.js`: live TMDB title search (up to 5 results with
  poster/year), powering a reworked Add-movie flow — type a title →
  pick a search result (or paste an IMDb ID directly) → read-only
  preview → pick a format → add. Replaces the old flow, which silently
  added the first TMDB guess for a typed title.
- Duplicate-copy detection in Add-movie: adding a movie whose IMDb ID
  already matches something on the shelf shows which formats are
  already owned and appends the new format to that row's `copies[]`
  instead of creating a duplicate movie.
- "Multiple copies" filter chip.
- Watchlist tab: a second, independent list backed by its own Supabase
  table (`public.watchlist`), so owning a copy never affects whether a
  title is still on the watchlist. Caches TMDB/JustWatch streaming
  availability for Poland per item — grid posters go grayscale/dimmed
  when nothing's streaming, list view gets a "Streaming" column, the
  detail drawer gets a "Where to watch (PL)" section — plus new
  streaming-availability and streaming-service filters.

### Changed

- Merged `demo.js` into `app.js` (a single file branching on
  `DEMO_MODE`) so the demo can no longer drift from the real app —
  every change to rendering, filtering, sorting, or styling now applies
  to both automatically instead of needing to be manually ported.
- Add-movie/Add-to-watchlist buttons in demo mode switched from the
  native `disabled` attribute to a `.btn-inert` class + `aria-disabled`
  — disabled buttons don't fire hover/title tooltips in most browsers,
  so the explanatory tooltip wasn't showing.
- Rewrote `HANDOFF.md` to describe the app as it actually is after the
  Supabase migration, replacing the original migration-planning doc.
- Watchlist: Remove now uses a press-again-to-confirm button in the
  detail drawer instead of `window.confirm()`, which turned out to be
  silently suppressed in some embedded/automated browser contexts and
  made Remove look broken. Dropped the redundant hover-X remove
  controls on grid cards and list rows.
- Watchlist's Streaming list column is now a normal resizable/optional
  column (shows in the Columns menu) instead of a fixed, locked one.

### Fixed

- Escaped URLs (`backdropUrl`/`posterUrl`/`imdbLink`) interpolated
  unescaped into HTML attributes via `innerHTML` — defense in depth;
  not exploitable with the data sources in place at the time, but a
  real risk once the TMDB/OMDb lookup feature started writing more
  external data into those same fields. Also tightened Supabase RLS to
  the specific owner's `auth.uid()` instead of "any authenticated
  user".
- Copies filter initially bloated the filter panel into an extra row —
  caught after testing against the demo's shorter decade list at a
  wider-than-real viewport, which hid the overflow against the real
  app's actual decade range. Fixed by reordering the chip to sit after
  Decade instead of before it.
- "Add to shelf" button had no `:disabled` styling and looked clickable
  while still inactive.
