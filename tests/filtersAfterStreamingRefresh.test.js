import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootRealApp } from "./helpers/bootRealApp.js";

// Regression: on load, the background streaming-provider refresh for stale
// watchlist items rebuilt the *watchlist's* filter chips into the chip
// containers shared with the collection tab, so the collection's
// Genre/Country/Decade/Type chips ended up wired to the watchlist's filter
// state and did nothing. Switching tabs rebuilt them, which "fixed" it.

const movies = [
  { id: "m1", title: "Alpha", year: 1990, genres: ["Drama"], format: "DVD", copies: [{ format: "DVD" }] },
  { id: "m2", title: "Beta", year: 2001, genres: ["Comedy"], format: "DVD", copies: [{ format: "DVD" }] },
];
const watchlist = [
  { id: "w1", title: "Wish", year: 1999, genres: ["Horror"], tmdbId: 1, mediaType: "movie", streamingFetchedAt: null },
];

beforeEach(() => localStorage.clear());

describe("collection filters after the background streaming refresh", () => {
  it("still filter when the refresh lands while the collection tab is showing", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ providers: [], link: null }) }));
    await bootRealApp({ session: { user: { id: "u1" } }, movies, watchlist, fetchImpl });

    await vi.waitFor(() => {
      if (fetchImpl.mock.calls.length < 1) throw new Error("refresh not issued");
    });
    // Let the debounced post-refresh chip rebuild (300ms) run.
    await new Promise((r) => setTimeout(r, 500));

    document
      .querySelector('#filter-genre .chip[data-value="Comedy"]')
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("movie-counter").textContent).toBe("1 movie");
    expect(Array.from(document.querySelectorAll("#movie-grid .card-title")).map((n) => n.textContent)).toEqual(["Beta"]);
  });
});
