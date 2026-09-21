# Test cases

Human-readable companion to the automated suite in `tests/*.test.js` (run
with `npm test`). Each row below corresponds 1:1 to an `it(...)` in that
suite — same name, same file — so if one starts failing, find it here for
the plain-English version of what broke, or find it in the code for the
exact assertion.

All "Personal collection" cases use the fixture in `tests/fixtures/movies.js`
(4 movies) and all "Watchlist" cases use `tests/fixtures/watchlist.js`
(3 items) — a small, fixed dataset independent of the real app data, so
these don't churn as the real collection grows. Everything here runs
against the demo build of the app (`app.js` in `DEMO_MODE`) in a headless
DOM, except the "Real app auth gate" section, which runs the real
(non-demo) code path with a stubbed Supabase client.

**Fixture reference:**

| Personal collection | Year | Genres | Country | Format | Watched | Copies |
|---|---|---|---|---|---|---|
| The Prefect Storm | 1994 | Drama, Thriller | United States | Blu-ray | Yes | 1 |
| Second Sight | 1994 | Sci-Fi | United Kingdom | DVD | No | 2 |
| Third Wheel | 1987 | Comedy | France | DVD | No | 1 |
| Fourth Wall | 2011 | Drama, Comedy | United States, France | Blu-ray | Yes | 1 |

| Watchlist | Year | Genres | Country | Streaming |
|---|---|---|---|---|
| Awaiting Dawn | 2022 | Drama | United States | Netflix |
| Backlog Blues | 1998 | Comedy | Germany | none |
| Cue the Credits | 2005 | Drama, Thriller | United States, Germany | Apple TV Store |

---

## Filter panel open/close (`filterPanel.test.js`)

### starts closed
**Steps:** Load the app.
**Expected:** The filter panel is hidden by default.

### opens and closes via the Filters toggle button
**Steps:** Click "Filters." Click "Filters" again.
**Expected:** First click reveals the filter panel and marks the toggle
button active. Second click hides the panel and un-marks the button.

### closes when clicking outside the panel
**Steps:** Click "Filters" to open the panel. Click anywhere in the movie
grid (outside the panel).
**Expected:** The panel closes and the toggle button is no longer active.

### does not close when clicking inside the panel
**Steps:** Click "Filters" to open the panel. Click inside the panel
itself.
**Expected:** The panel stays open.

### closes on Escape
**Steps:** Click "Filters" to open the panel. Press Escape.
**Expected:** The panel closes and the toggle button is no longer active.

## Filter panel groups shown per tab (`filterPanel.test.js`)

### shows collection-only groups and hides watchlist-only groups on the Personal collection tab
**Steps:** Load the app (Personal collection tab is the default).
**Expected:** Watched status, Format, and Copies filter groups are
visible. Streaming available and Streaming service groups are hidden.

### keeps Decade, Genre and Country visible on the Personal collection tab
**Steps:** Load the app.
**Expected:** Decade, Genre, and Country filter groups are visible.

### shows watchlist-only groups and hides collection-only groups on the Watchlist tab
**Steps:** Switch to the Watchlist tab.
**Expected:** Streaming available and Streaming service groups are
visible. Watched status, Format, and Copies groups are hidden.

### keeps Decade (and Genre/Country) visible and populated on the Watchlist tab too
*(Regression test — Decade was once accidentally deleted from the
Watchlist tab entirely instead of just being moved to a different spot
in the filter grid.)*
**Steps:** Switch to the Watchlist tab.
**Expected:** Decade, Genre, and Country filter groups are visible, and
the Decade group actually has chips in it (not just an empty container).

---

## Personal collection filtering (`collectionFiltering.test.js`)

### renders all fixture movies on first load
**Steps:** Load the app.
**Expected:** Counter reads "4 movies"; the grid shows 4 movie cards.

### filters by search text against the title
**Steps:** Type "Second" into the search box.
**Expected:** Counter reads "1 movie"; only "Second Sight" is shown.

### filters by watched status
**Steps:** Click the "Watched" chip. Then click the "Unwatched" chip.
**Expected:** "Watched" shows 2 movies (The Prefect Storm, Fourth Wall).
"Unwatched" shows 2 movies (Second Sight, Third Wheel).

### filters by format
**Steps:** Click the "DVD" format chip.
**Expected:** Counter reads "2 movies": Second Sight, Third Wheel.

### filters by multiple-copies
**Steps:** Click the "Multiple copies" chip.
**Expected:** Counter reads "1 movie": Second Sight (the only fixture
movie with more than one copy).

### filters by genre
**Steps:** Click the "Comedy" genre chip.
**Expected:** Counter reads "2 movies": Third Wheel, Fourth Wall.

### filters by country
**Steps:** Click the "France" country chip.
**Expected:** Counter reads "2 movies": Third Wheel, Fourth Wall.

### filters by decade
**Steps:** Click the "1990s" decade chip. Click it again to toggle it
off. Click the "1980s" decade chip.
**Expected:** "1990s" shows 2 movies (The Prefect Storm, Second Sight,
both 1994). After toggling off and picking "1980s," shows 1 movie
(Third Wheel, 1987).

### combines multiple active filters
**Steps:** Click the "Drama" genre chip, then the "1990s" decade chip.
**Expected:** Counter reads "1 movie": The Prefect Storm (Fourth Wall is
Drama but not 1990s, so it's excluded).

### resets every filter via Clear all
**Steps:** Click "Drama" (genre), "1990s" (decade), and "Watched"
(status) chips. Click "Clear all."
**Expected:** Counter reads "4 movies" again and the Watched-status
group's "All" chip is active again.

### sorts by year, newest first
**Steps:** Change the Sort dropdown to "Year (newest)."
**Expected:** Cards appear in order: Fourth Wall (2011), The Prefect
Storm (1994), Second Sight (1994, tie-broken alphabetically after "The
Prefect Storm"), Third Wheel (1987).

---

## Watchlist filtering (`watchlistFiltering.test.js`)

### renders all fixture watchlist items on switching tabs
**Steps:** Switch to the Watchlist tab.
**Expected:** Counter reads "3 movies"; the grid shows 3 cards.

### filters by genre
**Steps:** Click the "Drama" genre chip.
**Expected:** Counter reads "2 movies": Awaiting Dawn, Cue the Credits.

### filters by country
**Steps:** Click the "Germany" country chip.
**Expected:** Counter reads "2 movies": Backlog Blues, Cue the Credits.

### filters by decade
**Steps:** Click the "2020s" decade chip. Toggle it off, then click
"1990s."
**Expected:** "2020s" shows 1 movie (Awaiting Dawn, 2022). "1990s" shows
1 movie (Backlog Blues, 1998).

### filters by streaming availability
**Steps:** Click "Yes" under Streaming available. Then click "No."
**Expected:** "Yes" shows 2 movies (Awaiting Dawn, Cue the Credits —
both have a streaming provider). "No" shows 1 movie (Backlog Blues, the
only one with none).

### filters by streaming service
**Steps:** Click the "Netflix" streaming-service chip.
**Expected:** Counter reads "1 movie": Awaiting Dawn.

### resets every filter via Clear all
**Steps:** Click "Drama" (genre) and "Yes" (streaming available). Click
"Clear all."
**Expected:** Counter reads "3 movies" again and the Streaming-available
group's "All" chip is active again.

---

## Login page structure (`loginPage.test.js`)

### has a Sign in card with the fields login.js binds to
**Steps:** Load the login page.
**Expected:** Email and password inputs exist, the error message area is
empty, and the submit button reads "Sign in."

### has a Try the demo card linking to demo.html
**Steps:** Load the login page.
**Expected:** The "Open the demo" button links to `/demo`.

### checks for an existing session on load
**Steps:** Load the login page.
**Expected:** The page checks Supabase for an existing session exactly
once (used to redirect an already-signed-in visitor straight into the
app — see `login.js`).

## Login form submission (`loginPage.test.js`)

### shows an error and re-enables the button when sign-in fails
**Steps:** Enter an email and an incorrect password. Submit the form
(Supabase returns an error).
**Expected:** Sign-in is attempted with exactly the entered
email/password; the error message reads "Incorrect email or password.";
the submit button is re-enabled and reads "Sign in" again (not stuck on
"Signing in…").

### calls signInWithPassword with the form's values on submit
**Steps:** Enter an email and password. Submit the form (Supabase
returns success).
**Expected:** Sign-in is attempted with exactly the entered
email/password. (What happens after a successful sign-in — the redirect
to `/` — isn't checked here; see the note in `bootLogin.js`.)

---

## Real app auth gate (`authGate.test.js`)

*(Regression tests for a real bug: a signed-out visitor briefly saw the
full app shell before being redirected to the login page, because
`index.html`'s markup painted before the async session check finished.)*

### keeps the app hidden and does not reveal it when there is no session
**Steps:** Load the real (non-demo) app with no Supabase session.
**Expected:** The session is checked exactly once; the page body stays
hidden (never flashes the app shell) before redirecting away.

### reveals the app once a session is confirmed
**Steps:** Load the real (non-demo) app with a valid Supabase session
and a one-movie collection.
**Expected:** The page body becomes visible.

---

## Grid columns cap to viewport width (`gridColumns.test.js`)

*(Regression tests for a real bug found during a mobile/tablet pass: the
"Per row" slider let you pick more columns than the window could show at
a readable poster size, since grid columns had no minimum width — just
shrank to fit however many were requested, however little room there
was.)*

### caps the 'Per row' slider's max below the usual ceiling on a narrow window
**Steps:** Load the app with the window reporting a width of 900px.
**Expected:** The slider's maximum is less than 8 (the usual ceiling),
and its current value is never above that reduced maximum.

### clamps a previously-saved column count down to fit a narrow window
**Steps:** Save "8" as the last-used column count (as if picked on a
wide window earlier). Load the app with the window reporting a width of
900px.
**Expected:** The slider's value is brought down below 8 to fit, and the
grid's `--grid-cols` CSS variable matches the slider's new value.

### allows the full column range again on a wide window
**Steps:** Load the app with the window reporting a width of 1600px.
**Expected:** The slider's maximum is back to 8.

---

## Tap-to-preview on touch devices (`cardPreview.test.js`)

*(Regression tests for a real bug: on iPhone, tapping a movie card
sometimes opened the detail drawer on the first tap and sometimes needed
a second tap, depending on the card's content — an artifact of relying
on WebKit's native "first tap simulates :hover" behavior instead of
controlling it directly. Also implicated in a second, unreproducible
glitch where the drawer would flash open then immediately close.)*

### does not open the drawer on the first tap; opens on the second
**Steps:** Simulate a touch device. Click a movie card once, then click
it again.
**Expected:** After the first click, the card is marked as previewing
and the drawer stays closed. After the second click, the drawer opens.

### moves the preview to a different card instead of opening it
**Steps:** Simulate a touch device. Click one card, then click a
different card.
**Expected:** The first card stops previewing, the second card starts,
and the drawer stays closed throughout.

### clears the preview when tapping outside any card
**Steps:** Simulate a touch device. Click a card, then click elsewhere
on the page (outside any card).
**Expected:** The card's preview state clears.

### opens directly on a single click on non-touch devices
**Steps:** Simulate a non-touch (mouse/desktop) device. Click a movie
card once.
**Expected:** The drawer opens immediately — no second click needed.

---

## Mobile hamburger menu (`mobileMenu.test.js`)

*(Regression coverage for the mobile menu that combines Add movie and
Sign out below 640px, freeing up room for the search bar.)*

### starts closed, opens and closes via its toggle button (demo)
**Steps:** Click the hamburger menu button twice.
**Expected:** First click opens the menu and marks the button active;
second click closes it and un-marks the button.

### closes when clicking outside the menu (demo)
**Steps:** Open the menu, then click elsewhere on the page.
**Expected:** The menu closes.

### its Add-movie item is inert in demo mode, matching the topbar button (demo)
**Steps:** Load the demo app.
**Expected:** The menu's Add-movie item has the same inert styling
(`btn-inert`, `aria-disabled`) as the topbar's Add-movie button.

### has no Sign out item (demo has no session)
**Steps:** Load the demo app.
**Expected:** No `#mobile-sign-out-btn` element exists in the demo's markup.

### Add movie item opens the edit modal and closes the menu (real app)
**Steps:** Load the real (non-demo) app with a valid session. Open the
hamburger menu, then click its Add-movie item.
**Expected:** The edit modal opens, and the hamburger menu closes.

---

## Stale streaming-provider refresh is capped and throttled (`streamingRefreshThrottle.test.js`)

*(Regression test for a serious real bug: on page load, the real app
used to refresh cached streaming availability for every stale watchlist
item — one `fetch` + one Supabase write each — completely unthrottled,
all at once. With a watchlist where a meaningful chunk has gone stale
(>24h), that's dozens of concurrent requests from one mobile connection,
almost certainly the cause of the app going unresponsive for minutes at
a time, consistently, in a way a reload didn't fix — reloading just
re-triggered the same burst.)*

### fetches at most the capped number of items, oldest-stale-first, skipping fresh ones
**Steps:** Load the real (non-demo) app with a 30-item watchlist: 5
items never fetched, 20 items stale by varying amounts (1–20 days), 5
items fetched an hour ago (not stale). Wait for the refresh to finish.
**Expected:** Exactly 20 requests fire (the cap) — never more than 4 at
once — covering the 5 never-fetched items plus the 15 most-overdue dated
ones. The 5 least-urgent stale items and all 5 fresh items are never
touched. (Verified this test actually catches the bug: reverting just
the concurrency-limiting logic while keeping the cap makes it fail with
20 requests in flight simultaneously instead of ≤4.)
