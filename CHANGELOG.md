# Changelog

All notable changes to this project are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. This file
starts from 2026-09-20 — earlier history lives in `git log` and
`HANDOFF.md`, not backfilled here.

## [Unreleased]

### Fixed

- **Real iPhone: manual reload of the real app consistently showed 0
  movies**, nothing visibly broken. Root cause still not confirmed —
  best working theory is a transient race with Supabase's session/token
  refresh on a cold client init, where a query can come back
  successfully empty (RLS matching zero rows) rather than erroring.
  Mitigation: an empty-but-successful movies/watchlist query right after
  load is now treated as suspicious and retried once, after re-checking
  the session. Self-healing regardless of the exact cause. See
  `HANDOFF.md` §6 — needs on-device retest, not closed out yet.

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
  the whole story — see the empty-query-retry fix under `[Unreleased]`.)
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
