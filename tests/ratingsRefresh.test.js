import { describe, it, expect, vi } from "vitest";
import { bootRealApp } from "./helpers/bootRealApp.js";
import { bootDemoApp } from "./helpers/bootApp.js";

// Background ratings refresh (refreshStaleRatings in app.js): keeps IMDb
// rating / votes / Metascore current by re-reading OMDb through
// /api/ratings, stalest-first, capped, and never overwriting a stored value
// with "no value".

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const THIS_YEAR = new Date().getFullYear();
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY_MS).toISOString();
const session = { user: { id: "u1" } };

function item(id, over = {}) {
  return {
    id,
    imdbId: `tt${id.replace(/\D/g, "").padStart(7, "0")}`,
    tmdbId: 1,
    mediaType: "movie",
    title: id,
    year: 1980,
    imdbRating: 7,
    imdbVotes: 1000,
    metascore: null,
    genres: [],
    countries: [],
    ratingsFetchedAt: null,
    streamingFetchedAt: iso(0), // fresh: keep the streaming refresh out of the way
    ...over,
  };
}

// Records only the /api/ratings calls; answers everything else (streaming).
function makeFetch(ratingsResponse = () => ({ status: 200, body: { found: true, imdbRating: 8.1, imdbVotes: 5000, metascore: 77 } })) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith("/api/ratings")) {
      const { status, body } = ratingsResponse(new URL(u, "http://x").searchParams.get("imdbId"));
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({ providers: [], link: null }) };
  });
}
const ratingsCalls = (f) => f.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/ratings"));
const settle = () => new Promise((r) => setTimeout(r, 80));

describe("background ratings refresh", () => {
  it("refreshes a never-fetched title and stores the new values plus ratings_fetched_at", async () => {
    const fetchImpl = makeFetch();
    const { updated } = await bootRealApp({ session, movies: [item("m1")], watchlist: [], fetchImpl });
    await vi.waitFor(() => expect(updated.movies.length).toBe(1));
    expect(updated.movies[0]).toMatchObject({
      payload: { imdb_rating: 8.1, imdb_votes: 5000, metascore: 77 },
      column: "id",
      value: "m1",
    });
    expect(typeof updated.movies[0].payload.ratings_fetched_at).toBe("string");
  });

  it("covers the watchlist too, writing to the watchlist table", async () => {
    const fetchImpl = makeFetch();
    const { updated } = await bootRealApp({ session, movies: [], watchlist: [item("w1")], fetchImpl });
    await vi.waitFor(() => expect(updated.watchlist.length).toBe(1));
    expect(updated.watchlist[0].payload.metascore).toBe(77);
  });

  it("never overwrites a stored value when OMDb has none, but still stamps the fetch time", async () => {
    const fetchImpl = makeFetch(() => ({ status: 200, body: { found: true, imdbRating: 6.5, imdbVotes: null, metascore: null } }));
    const { updated } = await bootRealApp({
      session,
      movies: [item("m1", { metascore: 61, imdbVotes: 1000 })],
      watchlist: [],
      fetchImpl,
    });
    await vi.waitFor(() => expect(updated.movies.length).toBe(1));
    const { payload } = updated.movies[0];
    expect(payload.imdb_rating).toBe(6.5);
    expect(payload).not.toHaveProperty("metascore");
    expect(payload).not.toHaveProperty("imdb_votes");
    expect(payload.ratings_fetched_at).toBeTruthy();
  });

  it("stamps a title OMDb doesn't know (found:false) so it isn't retried every load, changing no scores", async () => {
    const fetchImpl = makeFetch(() => ({ status: 200, body: { found: false } }));
    const { updated } = await bootRealApp({ session, movies: [item("m1")], watchlist: [], fetchImpl });
    await vi.waitFor(() => expect(updated.movies.length).toBe(1));
    expect(Object.keys(updated.movies[0].payload)).toEqual(["ratings_fetched_at"]);
  });

  it("leaves the title untouched on a transient failure so it is retried on a later load", async () => {
    const fetchImpl = makeFetch(() => ({ status: 502, body: { error: "Lookup failed" } }));
    const { updated } = await bootRealApp({ session, movies: [item("m1")], watchlist: [], fetchImpl });
    await vi.waitFor(() => expect(ratingsCalls(fetchImpl).length).toBe(1));
    await settle();
    expect(updated.movies).toEqual([]);
  });

  it("stops the whole run when OMDb reports its daily limit", async () => {
    const fetchImpl = makeFetch(() => ({ status: 429, body: { error: "OMDb daily limit reached" } }));
    const movies = Array.from({ length: 10 }, (_, i) => item(`m${i + 1}`));
    const { updated } = await bootRealApp({ session, movies, watchlist: [], fetchImpl });
    await vi.waitFor(() => expect(ratingsCalls(fetchImpl).length).toBeGreaterThan(0));
    await settle();
    // Only the requests already in flight (concurrency 3) may have gone out.
    expect(ratingsCalls(fetchImpl).length).toBeLessThanOrEqual(3);
    expect(updated.movies).toEqual([]);
  });

  it("skips titles without an IMDb id", async () => {
    const fetchImpl = makeFetch();
    await bootRealApp({ session, movies: [item("m1", { imdbId: null })], watchlist: [], fetchImpl });
    await settle();
    expect(ratingsCalls(fetchImpl)).toEqual([]);
  });

  it("respects age-based freshness: recent releases go stale after 7 days, classics after 90", async () => {
    const fetchImpl = makeFetch();
    const movies = [
      item("m1", { year: THIS_YEAR, ratingsFetchedAt: iso(3) }),   // new, fresh      -> skip
      item("m2", { year: THIS_YEAR, ratingsFetchedAt: iso(10) }),  // new, stale      -> fetch
      item("m3", { year: THIS_YEAR - 2, ratingsFetchedAt: iso(20) }), // 2y, fresh    -> skip
      item("m4", { year: THIS_YEAR - 2, ratingsFetchedAt: iso(40) }), // 2y, stale    -> fetch
      item("m5", { year: 1960, ratingsFetchedAt: iso(60) }),       // classic, fresh  -> skip
      item("m6", { year: 1960, ratingsFetchedAt: iso(100) }),      // classic, stale  -> fetch
    ];
    await bootRealApp({ session, movies, watchlist: [], fetchImpl });
    await vi.waitFor(() => expect(ratingsCalls(fetchImpl).length).toBe(3));
    await settle();
    const ids = ratingsCalls(fetchImpl).map((u) => new URL(u, "http://x").searchParams.get("imdbId")).sort();
    expect(ids).toEqual([item("m2").imdbId, item("m4").imdbId, item("m6").imdbId].sort());
  });

  it("caps a run at 30 titles, never-fetched first then oldest, newest releases first among ties", async () => {
    const fetchImpl = makeFetch();
    const movies = [];
    // 30 never-fetched (years 1990..2019) + 5 long-stale ones that must lose
    // to them for a slot.
    for (let i = 1; i <= 30; i++) movies.push(item(`m${i}`, { year: 1989 + i }));
    for (let i = 31; i <= 35; i++) movies.push(item(`m${i}`, { year: 2020, ratingsFetchedAt: iso(500) }));
    await bootRealApp({ session, movies, watchlist: [], fetchImpl });
    await vi.waitFor(() => expect(ratingsCalls(fetchImpl).length).toBe(30), { timeout: 3000 });
    await settle();
    expect(ratingsCalls(fetchImpl).length).toBe(30);
    const ids = new Set(ratingsCalls(fetchImpl).map((u) => new URL(u, "http://x").searchParams.get("imdbId")));
    for (let i = 1; i <= 30; i++) expect(ids.has(item(`m${i}`).imdbId)).toBe(true);
    for (let i = 31; i <= 35; i++) expect(ids.has(item(`m${i}`).imdbId)).toBe(false);
  });

  it("does not run in the public demo", async () => {
    await bootDemoApp({ movies: [item("m1")], watchlist: [item("w1")] });
    await settle();
    expect(ratingsCalls(fetch)).toEqual([]);
  });
});
