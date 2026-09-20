# Changelog

All notable changes to this project are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. This file
starts from 2026-09-20 — earlier history lives in `git log` and
`HANDOFF.md`, not backfilled here.

## [Unreleased]

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
