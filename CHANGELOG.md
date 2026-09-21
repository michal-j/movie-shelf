# Changelog

All notable changes to this project are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. This file
starts from 2026-09-20 — earlier history lives in `git log` and
`HANDOFF.md`, not backfilled here.

## [Unreleased]

### Added

- Mobile hamburger menu combining Add movie/Add to watchlist and Sign
  out below 640px, freeing up room for the search bar.
- `tests/cardPreview.test.js`, `tests/mobileMenu.test.js`.

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

### Fixed

- Add-movie preview poster no longer stretches vertically to match the
  text column's height (a flex `align-items: stretch` bug, not just a
  mobile issue).
- Search bar placeholder text no longer overflows past the input's
  border on narrow screens.
- Movie cards: fixed a rare glitch where the detail drawer would flash
  open then immediately close (same root cause as the tap-to-preview
  change above, not confirmed independently reproduced).

## [2026-09-21]

### Added

- Responsive breakpoint pass (tablet + mobile) across the whole app, not
  just the pages already covered — see Fixed below for what it caught.
- `tests/gridColumns.test.js`: covers the new viewport-based cap on the
  "Per row" slider.

### Changed

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
- Topbar: the "Add movie"/"Add to watchlist" button no longer gets
  clipped off the right edge on narrow screens (the search bar wasn't
  shrinking to make room), which was also the reason modals could
  require horizontal scrolling to see in full — same root cause, not a
  separate modal bug.
- Toolbar: Sort/Filters/Columns (list view) now wrap onto their own line
  on narrow screens instead of overflowing the page.

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
