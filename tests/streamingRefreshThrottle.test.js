import { describe, it, expect, vi } from "vitest";
import { bootRealApp } from "./helpers/bootRealApp.js";

// Regression tests for a real, serious bug: refreshing cached streaming
// availability for stale watchlist items used to fire one fetch + one
// Supabase write per item, completely unthrottled, for every item on
// every real-app page load. With a watchlist large enough that a
// meaningful chunk has gone stale (>24h), that's dozens of concurrent
// requests from a single mobile connection — the likely cause of reports
// of the app becoming unresponsive for minutes at a time, consistently,
// in a way a reload didn't fix (reloading just re-triggered the same
// burst). Now capped and concurrency-limited, oldest-stale-first.

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function buildWatchlist() {
  const items = [];
  // 5 never-fetched items — highest priority (treated as oldest).
  for (let i = 1; i <= 5; i++) {
    items.push({ id: `w${i}`, tmdbId: 1000 + i, mediaType: "movie", streamingFetchedAt: null });
  }
  // 20 stale items, distinct ages from very stale (w6) to barely stale (w25).
  for (let i = 6; i <= 25; i++) {
    const ageDays = 26 - i; // w6 -> 20 days stale, w25 -> 1 day stale
    items.push({
      id: `w${i}`,
      tmdbId: 1000 + i,
      mediaType: "movie",
      streamingFetchedAt: new Date(NOW - ageDays * DAY_MS).toISOString(),
    });
  }
  // 5 fresh items (fetched an hour ago) — not stale, must never be touched.
  for (let i = 26; i <= 30; i++) {
    items.push({
      id: `w${i}`,
      tmdbId: 1000 + i,
      mediaType: "movie",
      streamingFetchedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    });
  }
  return items;
}

function tmdbIdsFetched(fetchMock) {
  return fetchMock.mock.calls.map(([url]) => Number(new URL(url, "http://x").searchParams.get("tmdbId")));
}

describe("stale streaming-provider refresh is capped and throttled", () => {
  it("fetches at most the capped number of items, oldest-stale-first, skipping fresh ones", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true, json: async () => ({ providers: [], link: null }) };
    });

    const watchlist = buildWatchlist();
    await bootRealApp({ session: { user: { id: "u1" } }, movies: [], watchlist, fetchImpl });

    await vi.waitFor(
      () => {
        if (fetchImpl.mock.calls.length < 20) throw new Error("not all refreshes issued yet");
      },
      { timeout: 2000 }
    );
    // Give any (incorrect) extra calls a chance to show up before asserting
    // the cap held.
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchImpl.mock.calls.length).toBe(20);
    expect(maxInFlight).toBeLessThanOrEqual(4);

    const fetchedIds = tmdbIdsFetched(fetchImpl);
    // The 5 never-fetched + 15 most-stale of the dated ones (w6..w20).
    for (let i = 1; i <= 20; i++) expect(fetchedIds).toContain(1000 + i);
    // Excluded: the 5 least-stale-but-still-stale ones, and all 5 fresh ones.
    for (let i = 21; i <= 30; i++) expect(fetchedIds).not.toContain(1000 + i);
  });
});
