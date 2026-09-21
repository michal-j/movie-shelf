# Movie Shelf — Handoff (current state, 2026-09-20)

This replaces the original migration-planning HANDOFF.md — that migration is
done. This doc describes the app **as it actually is right now**, for a fresh
Claude Code session with no memory of how it got here. Read this whole file
before touching code.

The user's own words on UI polish, still true: they want a sleek, modern,
uncluttered app. Every feature was driven by concrete feedback (screenshots,
"this looks busy", "make it consistent with X") — match that bar.

---

## 1. What this app is

A personal movie/disc collection tracker: 557 movies (as of this writing),
each with metadata (cast, ratings, genres, etc.) and one or more owned
physical/digital **copies** (a DVD and a Blu-ray of the same film are one
movie row with `copies.length === 2`, not two rows). Single owner, real
auth, deployed and live.

**Live URLs:**
- Real app (owner-only, Supabase-backed): `https://movie-shelf-six.vercel.app`
- Public demo (client-side only, no login): `https://movie-shelf-six.vercel.app/demo.html`
- A second, orphaned Vercel project (`movie-shelf-jcbk1.vercel.app`) exists
  from an early manual-deploy mistake, is gated by Vercel's own login, and
  is dead weight — harmless to ignore, the user couldn't find a delete
  option in the dashboard.

**Repo:** `github.com/michal-j/movie-shelf` (public). Git-connected to
Vercel — every push to `main` auto-deploys to production.

---

## 2. Architecture

Vanilla HTML/CSS/JS, **no build step, no framework, no bundler.** Deployed
to Vercel as a static site plus a couple of serverless functions under
`/api`.

```
index.html          — real app shell (loads supabaseClient.js + app.js)
demo.html            — public demo shell (loads app.js directly, sets a
                        window flag before it loads, no Supabase scripts)
login.html / login.js — email/password sign-in page for the real app
app.js               — SHARED by both index.html and demo.html (~1300 lines).
                        Branches on DEMO_MODE (window.MOVIE_SHELF_DEMO,
                        set by demo.html). This is the most important
                        architectural fact in this file — see §3.
supabaseClient.js    — creates window.supabaseClient (URL + publishable
                        anon key, both safe to be public — RLS does the
                        real access control, see §5)
styles.css           — one shared stylesheet for everything, dark theme
favicon.svg
api/movie-search.js  — Vercel serverless fn: TMDB-only live title search
api/movie-lookup.js  — Vercel serverless fn: full TMDB+OMDb merge for one
                        movie, by imdbId / tmdbId / title+year
data/movies.json     — historical full export, NOT used by the running
                        app anymore (kept for reference / re-running the
                        pipeline scripts). 545 rows, frozen.
data/movies-demo.json — static 32-movie curated subset for the public demo.
                        Frozen snapshot, NOT connected to Supabase in any
                        way — see §3 for why this can go stale.
data/watchlist-demo.json — same idea, for the demo's Watchlist tab: 14
                        titles curated from the real watchlist (7
                        streamable/7 not, plus one TV entry), frozen.
scripts/*.py         — one-off data-pipeline scripts that originally built
                        data/movies.json from the user's My Movies XML +
                        CSV exports. Not part of the running app. Useful
                        as reference if the pipeline needs re-running.
.claude/launch.json  — local dev server config (see §7 for a sandbox gotcha)
```

**Run locally:** `python3 scripts/serve.py` → `http://localhost:4173`
(sets `Cache-Control: no-store` so edits show up immediately; a plain
`python3 -m http.server` also works but will cache `app.js` aggressively).

---

## 3. The single most important thing: `app.js` is shared

`demo.js` **does not exist** — it was deleted. Both `index.html` (real app)
and `demo.html` (public demo) load the exact same `app.js`. It reads
`window.MOVIE_SHELF_DEMO` (set to `true` by an inline `<script>` in
demo.html, right before app.js loads) into a `DEMO_MODE` constant near the
top of the file, and branches on it in exactly these places — nowhere else:

- **`init()`**: real mode checks a Supabase session (redirects to `/login`
  if none) and queries the `movies` table; demo mode loads
  `data/movies-demo.json` once, or a previously-saved localStorage blob
  (`movieShelf.demoMovies`) if one exists from a prior visit.
  **`index.html` hides `<body>` by default** (inline `<style>` in its
  `<head>`) and `init()` only sets `document.body.style.visibility =
  "visible"` once the session check confirms a session — added
  2026-09-20 after a real bug: without it, a signed-out visitor to `/`
  briefly saw the full (empty) app shell before being bounced to
  `/login`, since the static HTML painted before the async session check
  resolved. `demo.html` has no such gate (nothing to hide behind), so
  `DEMO_MODE` never needs to reveal anything.
- **Every write** (`toggleWatched`, edit-form submit, delete): real mode
  does a Supabase call; demo mode mutates `state.allMovies` directly and
  calls `saveDemoMovies()`, which just writes the whole array back to that
  one localStorage key. That's the entirety of demo's "backend" — no
  base/override/custom/deleted merge complexity, unlike the original
  prototype this app started from.
- **Add-movie button**: real mode wires a click handler that opens the
  add flow. Demo mode does NOT attach a click handler at all, and instead
  adds a `.btn-inert` CSS class + `title` tooltip + `aria-disabled="true"`.
  Deliberately **not** the native `disabled` attribute — disabled buttons
  don't fire hover/title tooltips in most browsers, which is a real bug we
  hit and fixed (see `.btn-inert` in styles.css for the explanation).
- **Sign-out button**: guarded by `el("sign-out-btn")` existing at all —
  demo.html simply doesn't have that button in its markup, no DEMO_MODE
  check needed there.

**Why this matters for you:** any change to rendering, filtering, sorting,
the detail drawer, the edit-existing-movie form, toasts, or styling
automatically applies to both the real app and the demo, because it's
the same code. You should almost never need to touch demo.html except for
its header/banner markup — don't reintroduce a second JS file.

**The one thing that can't be unified:** the Add-movie *search/lookup* flow
(§4) calls `/api/movie-search` and `/api/movie-lookup`, both of which
require a real Supabase session (checked server-side) so the OMDb quota
can't be hit by anonymous traffic. That's why demo's Add-movie is disabled
outright rather than getting a parallel manual-entry implementation — it
was a deliberate simplification the user explicitly asked for, not a
missing feature.

**Known limitation of this design:** `data/movies-demo.json` is a frozen
snapshot, generated once, with zero connection to Supabase (by design — the
demo makes zero backend calls, full stop). If you edit a movie's copies in
the real app, the demo will keep showing the old snapshot forever unless
someone manually regenerates that JSON file from current Supabase data.
The user knows this and said it's not important to fix.

---

## 4. Feature inventory

Everything from the original prototype (grid/list view, sort, word-boundary
search, filters, the sliding detail drawer, multi-copy support, watched
toggle) is unchanged in behavior — see git history before commit `5041321`
if you need the deep rationale for any of those. What's been added/changed
since the Supabase migration:

- **Data layer**: Supabase Postgres (`movies` table, JSONB for array
  fields) instead of a static JSON file + localStorage. See §5.
- **Auth**: single owner account, Supabase email/password. Real app
  redirects to `/login` if no session (see the anti-flash note above §4).
- **Add-movie flow** (real app only): type a title → live search-as-you-
  type against TMDB (debounced ~350ms, up to 5 results with poster/year) →
  click one (or paste an IMDb ID directly, which skips straight to a
  single result) → a **read-only preview** loads (full TMDB+OMDb merge:
  poster, ratings, overview, cast, director — styled like the detail
  drawer) → pick a format from a dropdown (the only manual field) → "Add
  to shelf". No more manual title/year/genre typing for new movies.
- **Duplicate-copy detection**: if the selected movie's IMDb ID already
  matches something on the shelf, the preview shows "You already own
  this — DVD, Blu-ray" and the confirm button relabels to "Add Digital
  copy" (or whichever format is picked) — confirming appends to the
  *existing* row's `copies[]` instead of creating a duplicate movie. This
  was added reactively after a real duplicate ("The Abyss") slipped
  through before the feature existed; that specific duplicate was merged
  by hand via SQL, this feature prevents new ones.
- **"Multiple copies" filter**: a single boolean toggle chip in the filter
  panel (not a multi-option group — it's binary, so it didn't need one).
- **Filter panel layout (reworked 2026-09-20)**: `.filter-panel-inner` is an
  explicit 4-column × 2-row CSS grid (`styles.css`), not flex-wrap or
  auto-placed grid. Every `.filter-group-*` class gets a hardcoded
  `grid-column`/`grid-row` — deliberately, for two reasons: (1) Country and
  Streaming service can grow very long (expand-to-show-all), and auto-flow
  would stretch every group sharing their row to match, which is exactly
  the bug that motivated this rework; (2) filters shared between tabs
  (Decade/Genre/Country) need to land in the identical cell in both views,
  which isn't guaranteed once a different number of groups are hidden per
  tab. Current layout:
  - Row 1: Watched status, Decade, Format, Copies (Personal collection) /
    Streaming available, Decade, Streaming service — spans 2 columns —
    (Watchlist). Watched status/Streaming available share column 1;
    Format/Copies' cells are reused by Streaming service's 2-column span,
    since collection-only and watchlist-only groups never show together.
  - Row 2 (both tabs): Genre (spans 2 cols), Country (spans 2 cols).
  - Visibility per tab is still `data-view="collection"|"watchlist"` on
    each `.filter-group`, toggled by `applyFilterPanelView()` in app.js —
    unchanged mechanism, just now also determines which group "owns" a
    shared grid cell.
  - Below 640px the grid collapses to a single stacked column (see the
    `@media (max-width: 640px)` override) — every explicit
    `grid-column`/`grid-row` gets reset to flow naturally.
  - **Gotcha**: CSS Grid geometry (pixel positions, which row stretches)
    can't be verified by the automated test suite (§9) — jsdom doesn't run
    a layout engine. Changes here still need a real-browser check, and
    specifically re-test with a *long* expanded chip list (Country or
    Streaming service, "Show all" clicked) — that's what exposed the
    original auto-flow bug, a short/collapsed list won't reveal it.
  - The filter panel also now closes on outside-click and Escape (`app.js`,
    same `document`-level listener pattern as the columns menu), not just
    the "Filters" toggle button.
- **Tablet/mobile pass (2026-09-21)**: the app had only ever been
  eyeballed at desktop width plus the login page and filter panel
  specifically. A deliberate breakpoint audit (login, both tabs, grid +
  list view, filter panel, detail drawer, edit/add modals, at ~768px and
  ~390px) turned up several real overflow bugs, all fixed:
  - `.search-wrap` (topbar) didn't shrink below its `<input>`'s intrinsic
    min-width, so the Add-movie/Add-to-watchlist button got clipped off
    the right edge on narrow screens — and made the whole page (including
    any open modal) require horizontal scrolling to see in full, since
    `document.body`'s width was genuinely wider than the viewport. Fixed
    with `min-width: 0` on `.search-wrap` — the standard fix for a flex
    item not shrinking past its content's intrinsic size.
  - `.toolbar-left`/`.toolbar-right` (Sort/Filters/Columns and
    counter/Per-row/view-toggle) didn't wrap internally — the existing
    900px breakpoint only wraps them onto separate lines *relative to each
    other*, not their own children. Worst in list view, where the extra
    "Columns" button pushed it over. Fixed with `flex-wrap: wrap` added to
    both unconditionally (harmless — only engages when there isn't room).
  - The "Per row" grid-columns slider (`grid-cols-slider`, min 4/max 8)
    let you pick more columns than the viewport could show at a
    comfortable poster size — `minmax(0, 180px)` tracks will shrink all
    the way to near-zero to fit N columns into whatever width is
    available, with no lower bound. `maxGridColsForViewport()` in app.js
    now caps the slider's `max` (and clamps a too-large saved value) to
    whatever fits at `GRID_COLS_MIN_POSTER_PX` (150px) per column,
    recomputed on load and on a debounced `resize` listener. The control
    is also hidden entirely below 640px (`#grid-cols-control` in the
    existing mobile media query), where the grid's column count is fixed
    by CSS (`auto-fill, minmax(120px, 1fr)`) and the slider did nothing.
  - Detail drawer width went from `min(460px, 92vw)` to `min(460px, 85vw)`
    — on a phone it was nearly edge-to-edge, leaving too little visible
    backdrop to comfortably tap outside it to close.
  - The Add-movie panel's `.form-actions` row (Format select + Cancel +
    Add-to-shelf, `display:flex; justify-content:space-between`, no wrap)
    crammed all three into one row on narrow screens. Added
    `flex-wrap: wrap` there too.
  - **Not changed**: list view's many fixed-width columns still need
    horizontal scrolling on tablet/mobile to see every column — but that
    scroll is contained within `.movie-list` itself (`overflow-x: auto`),
    it doesn't leak into the page. Left as-is; making list view itself
    responsive (hiding columns, a card-based layout, etc.) is a real
    design decision, not a bug fix — raise it with the user first if it
    comes up again.
- **Round 2 of the mobile pass (2026-09-21), from real iPhone testing**
  (the previous round was emulator-only): the first round didn't cover
  actual touch behavior, real device quirks, or the add-movie flow (it's
  inert in demo — see below). Found and fixed:
  - **Tap-to-preview on touch devices**: movie cards used to rely purely
    on `.movie-card:hover .card-overlay` plus WebKit's native "first tap
    simulates hover, second tap fires the click" behavior. In practice
    this was inconsistent — some cards opened the drawer on the first
    tap, others needed a second, and it's implicated in a separate
    glitch (drawer flashes open then immediately closes, then a second
    tap opens it with no animation) that couldn't be reliably
    reproduced. Replaced with explicit state: `bindCardOpen()` in app.js
    tracks a `previewCard`/`.preview-active` class per card — first tap
    on touch (`TOUCH_DEVICE`, from `matchMedia("(hover: none)")`) always
    just reveals the overlay, a second tap on the *same*, already-active
    card opens the drawer, tapping a *different* card moves the preview
    instead of opening anything, and tapping outside any card (or
    closing the drawer) clears it. Desktop mouse/keyboard is unaffected
    — real `:hover` already previews there, so a click always opens
    directly. This should also resolve the flash-open-then-close glitch,
    since `openDetailModal()` is now only ever called from a deliberate
    second tap rather than racing with WebKit's native hover-click
    handling — but since that glitch was never reproduced outside a real
    device, treat this as "very likely fixed, please confirm" rather
    than verified.
  - **Topbar/search input min-width**: `.search-wrap input` needed its
    own `min-width: 0` (not just `.search-wrap`, see round 1) — without
    it the `<input>`'s own intrinsic minimum width overflowed its
    already-shrunk parent, which visually showed as the search
    placeholder text spilling out past the input's rounded border.
  - **Add-movie preview poster stretch**: `.movie-preview-poster` (a
    fixed 90px-wide, `aspect-ratio: 2/3` portrait thumbnail) sat in a
    `display: flex` row next to the text column. Flex's default
    `align-items: stretch` was stretching the poster to match however
    tall the text column got (long overview + cast list), and
    `object-fit: cover` then zoomed/cropped the poster image to fill
    that unnaturally tall box instead of a normal poster crop. Fixed
    with `align-self: flex-start` on the poster (applies at every
    breakpoint — this was a real bug regardless of screen size, just
    most visible on a phone where the narrower text column wraps into
    more lines). Below 640px goes further: the portrait poster is
    replaced by a full-width **landscape** hero image
    (`.movie-preview-hero`, `aspect-ratio: 16/9`, using
    `data.backdropUrl` — the same TMDB backdrop the detail drawer's
    `.detail-hero` already uses — falling back to `posterUrl` then a
    `gradientFor()` color if neither exists), stacked above the text
    instead of squeezed beside it.
  - **Mobile hamburger menu**: "Add movie"/"Add to watchlist" (full
    label) plus the icon-only Sign out button left too little room for
    the search bar on a phone. Below 640px both are hidden and replaced
    by a single `#mobile-menu-btn` (hamburger icon) that opens a small
    dropdown (`#mobile-menu`) with both actions — `#mobile-add-btn`
    (label kept in sync with the active tab, same as
    `#add-movie-btn-label`) and `#mobile-sign-out-btn` (index.html
    only — no session to sign out of in the demo, so `demo.html` doesn't
    get this item at all). Both proxy to the *same* demo-inert-check /
    click-handler logic as the original buttons, not a separate
    reimplementation. Standard outside-click-to-close, same pattern as
    the columns menu and filter panel.
- **Edit-existing-movie**: still the original manual form (title, year,
  genres, director, cast, description as comma-separated text fields,
  IMDb ID, format). Explicitly not reworked yet — see §6.
- **Watchlist** (added 2026-09-15): a second, fully independent list — a
  "Personal collection" / "Watchlist" tab row sits between the header and
  the sort/filter toolbar. Backed by its own Supabase table
  `public.watchlist` (see §5), not by a flag on `movies` — owning a copy of
  something never removes it from the watchlist. Adding works the same TMDB
  search-as-you-type flow as Add-movie, minus the format step (watchlist
  items have no copies), but it's **movie-only today**: the search box only
  resolves TMDB movies. TV shows currently only get into the watchlist via
  a manual/bulk import (see §5) — extending the live search to also find TV
  shows is deferred, see §6. Adding a title that's already in the watchlist
  (matched by IMDb ID) disables the confirm button with a "This is already
  in your watchlist." notice instead of creating a duplicate row.
  Each watchlist item caches TMDB/JustWatch streaming availability for
  Poland: grid posters go grayscale+dimmed when nothing's streaming, list
  view gets a resizable "Streaming" column (in the Columns menu like any
  other optional column), the detail drawer gets a "Where to watch (PL)"
  section. Every provider icon on a given title links to the *same* URL —
  TMDB's API has no per-provider deep link, only one link per
  title/country. Removing an item is a press-again-to-confirm button in the
  drawer — the same pattern the collection's Delete button (in the Edit
  modal) now also uses, after `window.confirm()` turned out to be silently
  suppressed in some embedded/automated browser contexts and made both
  look broken during testing.
  A TV row's Credits section shows "Creator" instead of "Director" (keyed
  off `media_type === 'tv'`; collection rows have no `media_type` column at
  all, so this only ever fires for watchlist TV entries).
  **Demo mode supports the Watchlist tab too** (added 2026-09-16) —
  `demo.html` mirrors `index.html`'s markup, backed by a frozen
  `data/watchlist-demo.json` (14 titles, a 7/7 streamable split plus one TV
  entry) with its own localStorage key (`movieShelf.demoWatchlist`). Add is
  still fully inert in demo either way (no session, no live TMDB calls) —
  same reasoning as Add-movie.

---

## 5. Data model & backend

**Supabase project:** `movie-shelf` (id `ybfxyrzkdexjjptuzzuy`), org JCBK,
region eu-west-1, free tier. One table, `public.movies`:

```sql
id text primary key,   -- e.g. "csv-12-angry-men-1957" (legacy imports) or
                        -- "custom-<random>" (added via the app)
imdb_id, imdb_link, title, original_title, original_language, format,
edition, aspect_ratio text,
tmdb_id, year, imdb_votes, metascore, runtime_minutes, collection_number integer,
imdb_rating numeric,
genres, countries, director, writers, cast_members, studios,
audio_languages, subtitle_languages, copies jsonb (not null default '[]'),
has_extras, watched boolean,
description text,
poster_url, backdrop_url text,
date_added timestamptz,
created_at, updated_at timestamptz
```

`copies` shape (one entry per owned disc/edition):
```json
{
  "format": "DVD", "formatDetail": "DVD-9", "edition": "...",
  "distributor": "...", "aspectRatio": "...",
  "audioLanguages": [...], "subtitleLanguages": [...],
  "extras": "...", "polishLicensedRelease": false, "notes": null,
  "source": "csv" | "my-movies+csv" | "manual"
}
```
Top-level `format`/etc. are a convenience "best copy" snapshot — NOT
authoritative once `copies.length > 1`; the UI already knows to read
`copies` in that case.

**RLS:** enabled, one policy, scoped to the specific owner's `auth.uid()`
(a hardcoded UUID in the policy, checked via `auth.uid() = '<uuid>'`) — NOT
"any authenticated user". This was a deliberate hardening: the original
policy trusted any authenticated user, which would only have been safe as
long as Supabase self-serve signup stayed off; scoping to the exact UID
makes it correct regardless of that toggle. If you ever need the owner's
UID again: `select id from auth.users;` (there's exactly one row).

**`app.js`'s `SELECT_COLUMNS`/`CAMEL_TO_DB_COLUMN`** maps snake_case DB
columns to the camelCase shape the rest of the file (and originally the
static JSON prototype) uses — e.g. `cast:cast_members` in the select alias.
If you add a DB column, it needs an entry in both places to round-trip.

**Current data state:** 557 movies, 424 watched. 2 movies (Mortal Kombat:
Conquest / Final Battle) intentionally have no IMDb/TMDB entry — Polish DVD
releases of TV content, user said leave as-is, don't "fix" this. ~47 movies
have no Metascore — legitimately absent on OMDb for those titles, not a
data gap. Everything else was backfilled from OMDb already.

**`public.watchlist`** (added 2026-09-15): same RLS pattern as `movies`
(same hardcoded owner UUID), same TMDB-shaped columns minus everything
copy/ownership-specific (`format`, `copies`, `watched`, etc.), plus:
```sql
media_type text not null default 'movie',  -- 'movie' | 'tv', check constraint
streaming_pl jsonb not null default '[]',  -- [{id, name, logoPath}, ...]
streaming_link text,                        -- one link per title/country
streaming_fetched_at timestamptz
```
`media_type` exists so `api/watch-providers.js` and the client's refresh
logic call the right TMDB endpoint family (`/movie/...` vs `/tv/...`) —
added after a bulk import initially skipped two TV shows (*Lonesome Dove*,
*Rose Red*) because the lookup only checked TMDB's `movie_results`. **Any
future TMDB lookup/import code must check `tv_results` too and never skip
a title just because it's not a movie** — ask before giving up on one that
truly has no TMDB entry either way.
`app.js`'s `SELECT_COLUMNS_WATCHLIST`/`CAMEL_TO_DB_COLUMN_WATCHLIST` mirror
the pattern above for this table.

111 movies were bulk-imported into the watchlist from IMDb-export CSVs the
user dropped in `watchlist_exports/` (untracked, not part of the repo —
don't expect that folder to still exist later), plus the 2 TV shows added
by hand afterward.

---

## 6. Known deferred work / backlog (explicitly "later, not now")

Done since this doc was last written (2026-09-20): filter panel grid
alignment and click-outside/Escape-to-close (both below) — see §4's filter
panel note and §9 for what replaced them. Login page was also reworked into
a two-card (sign in / demo) layout, restyled with the app's own dark palette
— see §4/login.html.

Still deferred, in roughly the order the user raised them:

1. **Broader toast coverage**: toasts exist for add/edit/delete-movie and
   the duplicate-copy flow, but not everything — e.g. toggling watched
   status shows no success toast (only a failure one), clearing filters
   shows none. Needs the user to pin down exactly which actions should get
   one before building. Not started.
2. **Reworking the Edit-existing-movie flow**: still the old manual form.
   The user wants to conceptualize a proper add/edit UI for per-copy
   format data (edition, distributor, aspect ratio, etc. — currently only
   settable by the original CSV import, not through the app UI at all) and
   said explicitly to defer touching Edit until that's designed. Don't
   redesign Edit without that conversation happening first.
3. **`data/movies-demo.json` going stale** (§3) — known, not important per
   the user, no action needed unless asked.
4. **TV show search in the Add-to-watchlist flow**: the live search box
   only resolves TMDB movies today (see §4). TV shows currently only enter
   the watchlist via manual/bulk import. Extending the search-as-you-type
   flow (and its preview/confirm UI) to also find and add TV shows is
   deferred. Not started.

**⚠️ Open, unresolved bug report (2026-09-21) — needs investigation, not
a "later" item, just not diagnosable from code alone:** on a real
iPhone, Personal collection briefly showed 0 movies for a minute or two
("as if it lost connection with the DB"), then recovered on its own with
no action taken. Only happened once so far and couldn't be reproduced.
Nothing in `init()` re-fetches movies after the initial page load — no
polling, no retry — so "resolved itself" without a page reload is hard
to explain from the client code alone. Best guess, unconfirmed: iOS
backgrounding the tab for a while, then either (a) Safari silently
reloading the page fresh on foreground (common under memory pressure)
and that first fetch racing a not-yet-ready Supabase session, or
(b) Supabase's background token refresh leaving a brief window where a
query runs with no valid `auth.uid()`, which the RLS policy (§5) would
turn into a *successful* empty result (`data: [], error: null`), not an
error — so nothing would show in `console.error` either. If this
happens again, useful info to capture: was the phone/tab backgrounded
right before it happened, was the network flaky at the time (wifi ↔
cellular handoff, etc.), and does reloading the page fix it immediately
(supports the "stale session on reload" theory) or does it take the
same minute-or-two either way (points more at token refresh timing).

---

## 7. Environment / secrets / deployment gotchas

- **⚠️ Never add `"type": "module"` to the root `package.json`** without
  accounting for `/api/*`. This broke Add-movie/Add-to-watchlist in
  production for real (not caught until the next session, because demo
  mode never calls these endpoints — see §9's known gap): the three
  `/api/*` serverless functions use CommonJS (`module.exports = ...`),
  and `"type": "module"` at the project root makes Node — and therefore
  Vercel's function runtime — parse every `.js` file in the project as
  an ES module by default, `/api/*` included. `module` isn't defined in
  ES module scope, so every request to those functions started throwing
  on invocation, and Vercel's generic crash page ("A server error has
  occurred…", not JSON) got returned to the client instead — which is
  why the browser-side error was a `JSON.parse`/"Unexpected token"
  message, not anything that looked like an API or auth problem. The
  test suite (the reason `"type": "module"` got added) does not need it
  — Vitest transforms `import`/`export` in test files regardless; only
  `vitest.config.mjs`'s own extension matters for that, which is why
  it's `.mjs` rather than `.js`. If test tooling ever genuinely needs
  `"type": "module"` for something, scope it with a nested
  `tests/package.json`, not the root one.
- **Clean URLs** (added 2026-09-20): `vercel.json` sets `"cleanUrls": true`,
  so `/login` and `/demo` serve `login.html`/`demo.html` in production
  (and Vercel 308-redirects the `.html` version to the clean one). Every
  internal link/redirect (`login.html`'s demo CTA, app.js's three
  `/login` redirects) was updated to use the clean path directly rather
  than relying on that redirect hop. The files on disk are still named
  `login.html`/`demo.html`/`index.html` — only the URLs changed.
  `scripts/serve.py` was taught to fall back to `<path>.html` for an
  extensionless request too, so this is actually testable against the
  local dev server, not just by trusting `vercel.json` and checking on a
  real deployment.
- **Vercel env vars**: `TMDB_API_KEY` and `OMDB_API_KEY`, set for all
  environments in the Vercel dashboard (Project Settings → Environment
  Variables). Required by both `/api` functions. **Gotcha we hit for
  real**: adding/changing an env var does NOT retroactively apply to an
  already-built deployment — a *preview* deployment built before the var
  was added will keep failing with "Server is missing TMDB_API_KEY" until
  you trigger a genuinely fresh build for that branch (the Vercel
  dashboard has a "redeploy" option that specifically rebuilds with
  current env vars — that's what fixed it last time, an empty commit also
  works). If a preview seems to be missing a key that's definitely set on
  the project, this is almost certainly why.
- **Supabase anon/publishable key** in `supabaseClient.js` is meant to be
  public — RLS is the actual security boundary, not key secrecy.
- **`preview_start` (the harness's Browser-pane dev-server launcher) fails
  in this sandbox** with `python3: can't open file '.../scripts/serve.py':
  Operation not permitted`. Confirmed cause (2026-09-20): the project lives
  under `~/Documents`, one of macOS's TCC-protected folders — the Browser
  pane's own subprocess launcher hasn't been granted consent to read into
  it, even though the harness's Bash tool has. It's an OS permission gap
  specific to that one launcher, not a code bug, and the user declining
  Full Disk Access for the app is a reasonable call, not something to keep
  pushing on. Workaround (works every time): launch
  `python3 scripts/serve.py` yourself as a plain background Bash command
  (or have the user run it in their own terminal — `npm run dev` does NOT
  work here; `package.json` exists only for the test suite (§9), it defines
  no dev-server script), then either use the browser tools' `navigate`
  against `http://localhost:4173` directly, or have the user open Chrome
  to it themselves.
- **git push works directly from this sandbox** via the user's existing
  `osxkeychain` credential helper — no need to hand pushes back to the
  user unless something's actually broken.
- **Branching**: the user knows git branches but hasn't used them in years
  and likes using them to validate riskier changes via Vercel's automatic
  per-branch preview deployments before merging to `main` (which
  auto-deploys to production). For small, easily-verified changes, direct
  commits to `main` are fine and is what's mostly happened — use judgment
  on which a given change warrants, same as any other risk call.

---

## 8. Things learned the hard way (read before repeating them)

- **Supabase bulk SQL via the MCP `execute_sql` tool**: batch generated SQL
  to roughly 12–20 rows / under ~30KB per call when rows contain long text
  fields — both the Read tool (25000-token cap) and Bash (~85KB output cap)
  truncate larger single reads, which will silently corrupt a batch if you
  don't notice.
- **`COALESCE` on a `jsonb not null default '[]'` column never fires** —
  such a column is never actually SQL `NULL`, it's an empty array, and
  `COALESCE(col, fallback)` only substitutes on true `NULL`. A "fill only
  if missing" backfill against such a column needs
  `case when col = '[]'::jsonb then fallback else col end` instead. This
  silently no-opped an entire backfill batch before it was caught — always
  spot-check one row after a "fill gaps" batch before trusting it worked.
- **Delegating small tasks to a background Agent can cost more time than
  doing them directly** — worked great for the original 545-row Supabase
  import (genuinely large, mechanical, worth keeping out of the main
  context), but a 10-file Vercel deploy delegated the same way hit repeated
  session rate-limit interruptions and silently dropped files on its first
  attempt. Reserve delegation for jobs large enough that inlining the data
  would meaningfully bloat context; do small, easily-verified things
  directly.
- **Test layout/width changes against the real constrained width and real
  full data, not a wide viewport and the demo's shortened dataset** — both
  mistakes independently hid the same filter-panel overflow bug, since
  both made the row look roomier than it actually is on the real app.
  The page's content column is capped at `--content-max: 1180px`
  regardless of browser window width.
- **(2026-09-20) Explicit CSS Grid placement needs an explicit row for
  every child, including ones that "obviously" go first** — pinning the
  filter groups to explicit `grid-column`/`grid-row` (see §4) but leaving
  the `.filter-panel-header` on auto-placement pushed it to the *bottom*
  of the panel: auto-placement only fills a row that still has a fully
  free span for it, and both explicit rows were already full. Once one
  grid child in a container gets explicit placement, audit whether any
  sibling relying on auto-placement still lands where you expect.
- **(2026-09-20) Vitest/Vite dynamic `import()` can't take a template
  literal with a runtime variable** (e.g. `` import(`../app.js?t=${n}`) ``)
  — Vite's static analysis rejects it at runtime with "Unknown variable
  dynamic import", even though plain Node ESM allows it. To re-execute the
  same script fresh in multiple tests in one file (needed here since
  app.js/login.js run their whole boot sequence as an IIFE on import, with
  no exports to call again), use `vi.resetModules()` before a *static*
  `import("../app.js")` string instead of cache-busting the path.

---

## 9. Automated tests (added 2026-09-20)

There was no test suite before this. `package.json` + `vitest.config.mjs`
exist solely for this — they don't add a build step to the app itself,
which is still plain `<script>` tags with zero bundling.

- **Run them**: `npm install` once, then `npm test` (or `npm run
  test:watch`).
- **`tests/TEST_CASES.md`** (added 2026-09-21): human-readable companion,
  one entry per `it(...)` (same name, same file) with plain-English
  steps/expected result and the fixture data table it's testing against.
  Keep it in sync when the automated cases change — it exists so someone
  can see what's covered, or manually walk through a case, without
  reading test code.
- **Approach**: Vitest + jsdom, booting the *real* `app.js` / `login.js`
  against the *real* `demo.html` / `login.html` / `index.html` markup
  (read from disk, scripts stripped, executed manually — see
  `tests/helpers/bootApp.js`, `bootLogin.js`, `bootRealApp.js`) rather
  than re-implementing filtering/rendering logic as separately-tested
  pure functions. `DEMO_MODE` tests stub `fetch` to serve small,
  hand-written fixtures (`tests/fixtures/`) instead of the real (and
  slowly-changing) demo JSON, so tests don't churn every time someone
  curates the demo dataset. The real (non-demo) `index.html` path is
  exercised too, via `bootRealApp.js`'s fake `window.supabaseClient`
  (`.auth.getSession`/`.onAuthStateChange`, `.from(table).select().order()`)
  — no real network or Supabase project involved either way.
- **Coverage**: filter panel open/close (button, outside-click, Escape),
  which filter groups show per tab (this is what would have caught the
  Decade-deleted-instead-of-moved mistake, see §8 and
  `filterPanel.test.js`'s regression test), Personal collection filtering
  (search/watched/format/copies/genre/country/decade, combined filters,
  Clear all, sorting), Watchlist filtering (genre/country/decade/streaming
  available/streaming service, Clear all), the login page's structure and
  its sign-in success/error handling, the real app's auth gate
  (`authGate.test.js` — the app shell stays hidden with no session, and
  is revealed once one's confirmed; this is the regression test for the
  flash-of-the-app-before-redirecting-to-login bug, see §4), the
  viewport-based cap on the "Per row" slider (`gridColumns.test.js`), the
  tap-to-preview-then-open behavior on touch devices
  (`cardPreview.test.js`), and the mobile hamburger menu
  (`mobileMenu.test.js`, both `DEMO_MODE` and real-app boots).
- **Known gap**: CSS Grid geometry (§4's filter panel layout) isn't
  covered — jsdom doesn't run a real layout engine, so column positions
  and row-stretching can only be verified in an actual browser. Also not
  covered: the add-movie search/lookup flow, duplicate-copy merging, and
  anything requiring a real Supabase call — all would need mocking
  `window.supabaseClient` and the `/api/*` endpoints, which nothing here
  does yet. **This gap is exactly how the `"type": "module"` regression
  (§7) shipped without being caught**: Add-movie is inert in `DEMO_MODE`
  (no real endpoint to hit), so no manual or automated check ever
  exercised `/api/*` after that change — it was only found by testing
  the real deployment directly. If `/api/*` gets covered by tests later,
  it also closes this hole.
- `tests/gridColumns.test.js` (added 2026-09-21): the "Per row" slider's
  viewport-based max (see §2/§4) — capped on a narrow window, clamps a
  saved value down to fit, and opens back up on a wide one. Exercises
  `window.innerWidth` directly since jsdom gives every element
  `clientWidth: 0` (no real layout) and `maxGridColsForViewport()` falls
  back to `window.innerWidth` in that case.
