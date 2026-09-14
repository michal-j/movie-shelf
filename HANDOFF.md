# Movie Shelf — Handoff: Prototype → Live App

This document exists to brief a **fresh Claude Code session** that has no memory
of the conversation that built this prototype. Read this whole file before
touching code. The prototype (vanilla HTML/CSS/JS, local-only) is functionally
complete and polished; the task now is turning it into a deployed, database-backed
real app while reusing as much of the existing frontend as possible.

The user's own words, verbatim, on the eventual UI polish philosophy: they want a
sleek, modern, uncluttered app — every feature added so far was driven by
concrete feedback (screenshots with red arrows pointing at bugs, "this looks
busy", "make it consistent with X"), so match that bar, don't regress it.

---

## 1. What exists today

A static prototype, no build step, no backend, no framework:

```
index.html          — single page, all markup (header, toolbar, filter panel, grid/list, two modals)
app.js               — ~1000 lines vanilla JS, IIFE, no imports/bundler
styles.css           — hand-written CSS, dark theme, CSS custom properties for theming
favicon.svg          — filmstrip icon matching the header logo
data/movies.json     — 545 movies, the entire dataset (see §3 for shape)
watched_status.md    — real watched-status export from the user's own browser's
                       localStorage, 423 entries, pre-validated against
                       data/movies.json (see §8). Migration input, not app code.
scripts/*.py         — one-off data-pipeline scripts used to BUILD data/movies.json (see §4).
                       Not part of the running app. Keep for reference / re-runs, but they
                       are not meant to ship or run in production.
.claude/launch.json  — local dev server config (see §5 for why it's non-standard)
```

Run locally: `python3 scripts/serve.py` → http://localhost:4173
(A plain `python3 -m http.server` also works, but `serve.py` adds
`Cache-Control: no-store` — without it, browsers aggressively cache `app.js`
and you'll edit code and see nothing change. This does NOT matter once deployed
behind Vercel, which sets its own correct caching, but keep it for local dev.)

**There is no git repo yet.** `.DS_Store` exists and should be gitignored.
`movies_export_from_my_movies_2.xml` (11MB) and the `.csv` source file are the
original data sources used to build `data/movies.json` — they're not needed by
the running app and probably shouldn't be committed (or commit them but exclude
from the Vercel build).

### All state currently lives in `localStorage`, client-side only

```
movieShelf.watched        { [movieId]: true }              — which movies are watched
movieShelf.customMovies   [ movie, ... ]                     — movies added via "Add movie"
movieShelf.deletedIds     [ movieId, ... ]                    — base movies the user deleted
movieShelf.overrides      { [movieId]: partialMoviePatch }    — edits to base movies
movieShelf.viewMode       "grid" | "list"
movieShelf.listColumns    { visible: {...}, widths: {...} }
movieShelf.gridCols       4-8 (grid columns per row)
```

`app.js`'s `allMovies()` merges `data/movies.json` + overrides + customMovies
- deletedIds on every render. **This four-way-merge complexity exists ONLY
because the base dataset is a static file that can't be edited in place.**
Once there's a real database, this whole layer should collapse to one
`movies` table you read/write directly — see §7, this is a real simplification
opportunity, not just a nice-to-have.

---

## 2. Feature inventory (so you don't have to re-derive scope)

- **Grid view**: poster cards, adjustable columns-per-row (4–8, slider, persisted),
  cards capped at 180px so they don't stretch huge — extra space becomes
  side margins, not bigger posters. Hover reveals title/year/runtime/format-or-copy-count/genre
  and a Metascore+IMDb rating badge pair (moved off the poster face on request —
  it looked "busy"; now hover-only).
- **List view**: sortable-feeling table with **user-resizable, show/hide-able
  columns** (Title/Poster/Watched are locked; Original Title, Genre, Year,
  Runtime, IMDb Rating, Metascore, Format, Director are toggleable via a
  "Columns" menu). Column widths + visibility persist. Sticky header (this
  required giving `.movie-list` its own bounded scroll pane — `position:sticky`
  breaks under any ancestor with non-`visible` overflow, a real bug fixed
  mid-project). Resize-handle borders are always faintly visible, not
  hover-only, so users discover they're draggable.
- **Sort**: title, year, rating, Metascore, runtime, date added. Title sort
  strips leading articles ("The", "A", "Der", "Le", "El", "Il", etc., plus
  French/Italian elisions like `L'Auberge`) so "Das Boot" sorts under B, not D.
- **Search**: word-boundary matching (not raw substring) across title,
  original title, director, cast. Raw substring made "ace" match every movie
  with a "Spacey"/"Wallace" in the cast — fixed to `\bquery` regex matching.
- **Filters**: watched status, format, decade, genre, country — multi-select
  chips, AND across categories, OR within a category. Country filter
  collapses to 4 rows (matches Genre's height) with a "Show all" toggle,
  since there are 40+ countries.
- **Detail view**: a **right-side sliding drawer** (not a centered modal — this
  was an explicit redesign), shows poster, title + original title, year/runtime/
  format-or-copies/Metascore/IMDb rating pills, genres, country, overview, cast
  (with character names), director/writers, and a **"Your copies" section** —
  one card per physically-owned copy (format, edition, distributor, aspect
  ratio, audio/subtitle languages, extras, Polish-license flag, notes).
- **Multi-copy support**: a movie can have 2+ owned physical copies (e.g. a
  DVD and a Blu-ray of the same film). `movie.copies` is an array; the UI
  shows "N copies owned" / "N× copies" instead of a single format wherever
  that would otherwise duplicate info — this took a couple of bug-fix rounds,
  see the array-of-copies note in §3.
- **Watched status**: an eye icon. Blue when watched. **Indicator-only** in
  grid/list (not clickable there — this was explicitly requested after
  initially making it clickable everywhere); the only way to toggle it is the
  "Mark as watched" button inside the detail drawer.
- **Add/Edit/Delete movie**: a form modal (stays centered, unlike the detail
  drawer — deliberately not converted). Currently fully manual-entry. **The
  user wants this replaced with a real TMDB/OMDb title-or-IMDb-ID lookup that
  auto-fills everything, keeping only format/edition/per-copy fields as manual
  input — explicitly deferred, not built yet. Do this after the DB migration.**
- **Home button**: the "Movie Shelf" logo/wordmark is a button that resets
  search + all filters (not a page navigation).
- **Ratings**: IMDb rating (gold pill/star) and **Metascore** (green/yellow/red,
  solid-fill on grid cards for contrast against bright posters; outline-style
  pill in the drawer to match the IMDb pill's weight). Sortable by both.
- **Responsive**: centered `max-width: 1180px` content column (topbar, toolbar,
  filter panel) on wide screens instead of full-bleed edge-to-edge; toolbar
  wraps to two rows below ~900px instead of overflowing.
- **Favicon**: matches the header brand mark.

## 3. Data model (`data/movies.json`, one JSON array, 545 objects)

Top-level fields present across the dataset:

```
id, imdbId, imdbLink, tmdbId, title, originalTitle, originalLanguage, year,
imdbRating, imdbVotes, metascore, runtimeMinutes, genres[], countries[],
director[], writers[], cast[{name, role}], studios[], format, edition,
aspectRatio, audioLanguages[], subtitleLanguages[], hasExtras, description,
posterUrl, backdropUrl, dateAdded, collectionNumber, copies[]
```

`copies[]` — one entry per physically owned disc/edition:
```json
{
  "format": "DVD",
  "formatDetail": "DVD-9",
  "edition": "książkowe",
  "distributor": "Warner Bros",
  "aspectRatio": "2.20:1",
  "audioLanguages": ["eng", "spa"],
  "subtitleLanguages": ["eng", "pol", "multi"],
  "extras": "zwiastun",
  "polishLicensedRelease": false,
  "notes": null,
  "source": "csv"
}
```
Top-level `format` is a derived "best format across copies" convenience value
used by the simple filter chips — it is NOT authoritative when `copies.length > 1`;
the UI already knows to prefer `copies` for display in that case.

**Known data gaps to carry over, not bugs to "fix" during migration:**
- 88 of 545 movies are missing `countries` — OMDb's free-tier daily quota
  (1,000 req/day) was exhausted mid-backfill. Trivial script re-run once the
  quota resets (`scripts/enrich_omdb.py`, already supports incremental re-runs).
- "Mortal Kombat: Conquest" and "Mortal Kombat: Final Battle" have thin/no
  cast and no `tmdbId` — they're Polish DVD releases of TV content with no
  real movie-database entry. User explicitly said to leave them as-is.

## 4. Data pipeline scripts (`scripts/`, Python, not part of the running app)

Run in roughly this historical order; useful as reference for what data came
from where and how to re-run/extend later (e.g. once the countries backfill
quota resets):

- `parse_movies.py` — original My Movies XML export → `data/movies.json`
- `fetch_posters.py` — early poster-only TMDB pass (superseded by fetch_cast.py/enrich_tmdb.py)
- `merge_csv.py` — merges a second CSV collection export in, handles multi-copy
  detection, dedupes by IMDb ID (with a documented King-Kong-1933-vs-2005 gotcha
  around blind title matching — read the comments if extending this)
- `fix_titles.py` — makes TMDB's English title authoritative, drops Polish
  titles, flags "title happens to equal original title in a non-English
  language" cases (e.g. genuinely "Das Boot")
- `enrich_tmdb.py` — TMDB as source of truth for year/runtime/poster/rating
- `enrich_omdb.py` — OMDb (i.e. real IMDb data) as source of truth for rating/
  runtime/genre/country/plot/director/writers, subject to the 1000/day quota
- `fetch_cast.py` — TMDB full credits (with character names) for every movie,
  including a TV-credits-endpoint special case for "Band of Brothers" (it's a
  TV series on TMDB, not a movie — `/tv/{id}/credits`, not `/movie/{id}/credits`)
- `serve.py` — local dev server, see §1

All of these expect `TMDB_API_KEY` / `OMDB_API_KEY` env vars. **These keys were
pasted into chat during the prototype session and used for one-off local
script runs — they are NOT currently embedded in any shipped file.** For the
live app, get fresh keys and store them as Vercel environment variables; do
not commit them.

## 5. A sandbox gotcha you will probably hit again

`preview_start` (the harness's dev-server launcher) fails in this environment
with `PermissionError` / `getcwd: cannot access parent directories` no matter
what — it's a sandboxing quirk of this specific machine/session, not a bug in
any script. The workaround that worked: launch the server as a **plain
background Bash command** (`python3 scripts/serve.py &` or similar via the
Bash tool's `run_in_background`), then use the browser tools' `navigate`
against `http://localhost:4173` directly instead of `preview_start`. If this
still applies in the new session, don't burn time debugging `preview_start`
itself — just use that workaround again immediately.

## 6. Decisions made for the live version (confirmed with the user)

- **Hosting: Vercel**, free `*.vercel.app` subdomain, no custom domain for now.
- **Backend/DB: Supabase.** Both Vercel and Supabase already have MCP tool
  connectors available in this environment — use them directly rather than
  the CLIs where possible.
- **Frontend stays vanilla HTML/CSS/JS.** No framework rewrite. Swap the data
  layer only: `fetch('data/movies.json')` → Supabase client query;
  `localStorage` writes for watched/add/edit/delete → Supabase writes.
- **Two access modes, confirmed by the user:**
  1. **Authenticated owner mode** — just one real user (the collection owner).
     Full CRUD against the real Supabase-backed collection.
  2. **Public demo mode** — shared for demonstration purposes, no login.
     Shows mock data or a curated subset of the real collection. **Recommended
     approach (not yet confirmed in detail with the user, revisit in the new
     session): keep demo mode 100% client-side, exactly like today's
     prototype** — bundle a static JSON subset (e.g. 40–80 movies) and let all
     interactions (watched toggle, add/edit/delete) stay in `localStorage`,
     with zero Supabase calls. This reuses the entire existing app almost
     unchanged for the demo, and completely avoids the harder problem of
     public/anonymous writes to a shared backend. Only the authenticated
     owner route talks to Supabase. Confirm this plan with the user before
     building it — it's a strong recommendation, not a locked decision.
  - Since it's genuinely single-user for the real data, **you probably don't
    need a per-user rows/multi-tenant schema at all** — one `movies` table,
    RLS-gated so only the authenticated owner can read/write it, is enough.
    Don't over-build multi-tenancy for a one-person app.
- **"Add movie" real lookup (TMDB/OMDb by title or IMDb ID): wanted, but
  explicitly deferred** — do it after the DB migration is live, not before.
  When you do build it: needs a small Vercel serverless function to proxy the
  TMDB/OMDb calls (API keys can't live in client-side JS), auto-fills
  everything the app already tracks except the `copies[]`/format/edition
  fields, which the user wants to keep entering manually per physical copy.

## 7. Suggested punch list for the new session

Roughly in order; not gospel, just a sane starting sequence:

1. `git init`, sensible `.gitignore` (`.DS_Store`, maybe the huge source
   XML/CSV), first commit.
2. Design the Supabase schema. Recommendation: don't fully normalize —
   `movies` table with JSONB columns for `genres`, `director`, `writers`,
   `cast`, `studios`, `countries`, `audioLanguages`, `subtitleLanguages`,
   `copies` (nearly 1:1 with the current JSON shape, fast to migrate, still
   queryable via Postgres JSONB/GIN indexes if you need filter performance
   later). Add a plain `watched boolean` column directly on `movies` — no
   separate per-user state table needed, see the single-user note above.
3. Import all 545 rows from `data/movies.json` into Supabase, then apply
   `watched_status.md` (423 pre-validated entries) to set the `watched` column.
4. Add Supabase Auth (single owner account — decide email/password vs magic
   link with the user), gate the real app route.
5. Swap the frontend's data layer: `init()`'s fetch → Supabase query;
   `toggleWatched`/edit-form-submit/delete → Supabase writes. This is also
   the moment to delete the base/custom/override/deletedIds merge complexity
   in `allMovies()` — with a real table, every movie is just a row.
6. Build `/demo` (public, static subset + localStorage, per the plan in §6 —
   confirm details with the user first).
7. Deploy to Vercel, verify the `*.vercel.app` URL end to end.
8. (Later, not blocking launch) Build the TMDB/OMDb "Add movie" lookup flow
   per §6.
9. (Later) Re-run `scripts/enrich_omdb.py` once the OMDb quota resets to
   backfill the remaining 88 movies' `countries`.

## 8. Follow-up clarifications (asked after the first draft of this doc)

**Where does watched status live, and how do we migrate it?**
Confirmed: only in `localStorage["movieShelf.watched"]`, never in
`data/movies.json`. It's scoped per-browser/per-origin — the Claude Browser
pane instance used throughout the prototyping session had essentially nothing
meaningful in it (one leftover test toggle), but the user's own regular
browser did have real data.

**The user has already exported it to `watched_status.md`** at the project
root — it's the raw `localStorage["movieShelf.watched"]` JSON blob (a single
line, `{ "<movieId>": true, ... }`), obtained via their browser's devtools
console. Already validated in this session: **423 entries, valid JSON, all
423 IDs match current `data/movies.json` ids with zero stale/orphaned
entries.** It's ready to use as-is for the Supabase migration — once the
`movies` table exists and is seeded (same ids), loop over this file and set
`watched = true` for each key. No further cleaning needed.

**Should movie metadata (cast, plot, rating, etc.) refresh periodically from
TMDB/OMDb once it's in Supabase?**
Recommendation, not yet built: no automatic polling. Supabase is the
canonical read source (avoids external-API latency/cost on every page load).
Add a manual **"Refresh from TMDB/OMDb"** action in the edit drawer that
re-fetches one movie on demand — cast/plot/poster essentially never change
post-release, and rating drift is slow, so on-demand is enough for a personal
collection. A scheduled bulk re-sync (Vercel Cron) is a reasonable *later*
addition if it turns out to matter, not a launch requirement. A refresh must
only ever touch TMDB/OMDb-sourced fields — never `copies[]`, format, watched
status, or notes, which the APIs have no knowledge of.

**Is there a GitHub connector available for automating the repo?**
Checked directly in this session: `gh` CLI is **not installed** on this
machine (`which gh` → not found), so no CLI-based GitHub automation is
available yet. A GitHub App/plugin connector exists in this environment but
is **not authorized** — that requires the user to approve it via their
claude.ai connector settings; it can't be done from a non-interactive Claude
Code session. Plain `git` (2.50.1) *is* installed, so local repo init and
commits can happen immediately with zero external dependency.
**Important: GitHub is not required to deploy.** The Vercel connector already
available in this environment can deploy directly from a local folder with no
git remote at all. Recommendation: deploy via Vercel directly first; treat a
GitHub remote as optional later infrastructure (mainly useful for auto-deploy-
on-push and backup) to set up only if/when the user wants that workflow.

## 9. Design/interaction conventions to preserve

These came from repeated, specific user feedback during the prototype build —
don't regress them by accident during the migration:

- Cards/pills favor **solid, high-contrast fills** over low-opacity tinted
  backgrounds when sitting on top of unpredictable poster art (grid Metascore
  badge); use the **subtle bordered-pill** style when sitting on a flat panel
  background (drawer pills) — these are deliberately different treatments for
  the same data, not an inconsistency.
- Separator dots (`·`) between inline metadata items must never render
  *inside* a pill's own box — only apply the `::after` dot to plain text
  siblings, never to `.pill` elements.
- When a movie has multiple copies, never show a redundant single "format"
  alongside the "N copies" indicator — the copies indicator *replaces* format
  in that slot, in the same position format would otherwise occupy, for both
  the grid hover overlay and the drawer subline.
- Any time you add something that could grow into a filter option (genre,
  format, country, etc.) via add/edit/delete, the filter chip lists must
  rebuild live — this was a real bug (chips only built once at startup from
  the static base dataset).
