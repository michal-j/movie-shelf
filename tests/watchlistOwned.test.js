import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";
import { bootRealApp } from "./helpers/bootRealApp.js";

// Own fixtures (not tests/fixtures/*) because these need IDs shared between
// the collection and the watchlist, which the shared fixtures deliberately
// don't have.
const movies = [
  { id: "m1", title: "Shelf Only", year: 2001, imdbId: "tt0000001", tmdbId: 101, format: "Blu-ray", copies: [{ format: "Blu-ray" }, { format: "DVD" }] },
  { id: "m2", title: "Shelf And Stream", year: 2002, imdbId: "tt0000002", tmdbId: 102, format: "DVD", copies: [{ format: "DVD" }] },
  { id: "m3", title: "Matched By Tmdb", year: 2003, imdbId: null, tmdbId: 103, format: "DVD", copies: [{ format: "DVD" }] },
  // Same TMDB number as a watchlist TV show, but a movie: TMDB movie and TV
  // ids are separate namespaces, so this must NOT count as owning it.
  { id: "m4", title: "Movie With TV Id Clash", year: 2004, imdbId: null, tmdbId: 104, format: "DVD", copies: [{ format: "DVD" }] },
  // No IDs at all (like the Mortal Kombat DVDs) — must not match a
  // watchlist item that also has no IDs.
  { id: "m5", title: "No Ids Here", year: 2005, imdbId: null, tmdbId: null, format: "DVD", copies: [{ format: "DVD" }] },
];

const watchlist = [
  { id: "w1", title: "Owned Not Streaming", year: 2001, imdbId: "tt0000001", tmdbId: 101, streamingProviders: [] },
  { id: "w2", title: "Owned And Streaming", year: 2002, imdbId: "tt0000002", tmdbId: 102, streamingProviders: [{ name: "Netflix", logoPath: null }] },
  { id: "w3", title: "Owned Via Tmdb", year: 2003, imdbId: null, tmdbId: 103, streamingProviders: [] },
  { id: "w4", title: "TV Id Clash", year: 2004, imdbId: null, tmdbId: 104, mediaType: "tv", streamingProviders: [] },
  { id: "w5", title: "Unavailable", year: 2005, imdbId: null, tmdbId: null, streamingProviders: [] },
  { id: "w6", title: "Streaming Only", year: 2006, imdbId: "tt0000006", tmdbId: 106, streamingProviders: [{ name: "Max", logoPath: null }] },
];

// Every watchlist fixture gets a poster URL so the real <img> path renders
// (titles without one get a .poster-fallback div instead).
watchlist.forEach((w) => (w.posterUrl = `https://example.test/${w.id}.jpg`));

function click(el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function clickChip(containerId, value) {
  click(document.querySelector(`#${containerId} .chip[data-value="${value}"]`));
}

function card(title) {
  return [...document.querySelectorAll("#watchlist-grid .movie-card")].find(
    (c) => c.querySelector(".card-title").textContent === title
  );
}

function cardTitles() {
  return [...document.querySelectorAll("#watchlist-grid .card-title")].map((n) => n.textContent).sort();
}

describe("Watchlist: titles you already own", () => {
  beforeEach(async () => {
    await bootDemoApp({ movies, watchlist });
    click(document.getElementById("tab-watchlist"));
  });

  it("shows an Owned tag with the owned formats on the grid card", () => {
    const tag = card("Owned Not Streaming").querySelector(".owned-tag");
    expect(tag).not.toBeNull();
    expect(tag.textContent).toBe("Owned · Blu-ray, DVD");
    expect(card("Streaming Only").querySelector(".owned-tag")).toBeNull();
  });

  it("replaces the 'Not streaming' note when owned, and keeps the streaming icons when it streams too", () => {
    const ownedOnly = card("Owned Not Streaming");
    expect(ownedOnly.querySelector(".streaming-empty")).toBeNull();

    const both = card("Owned And Streaming");
    expect(both.querySelector(".owned-tag")).not.toBeNull();
    expect(both.querySelectorAll(".streaming-icon")).toHaveLength(1);

    expect(card("Unavailable").querySelector(".streaming-empty").textContent).toBe("Not streaming in Poland");
  });

  it("only greys out posters that are neither streaming nor owned", () => {
    const greyed = (title) => card(title).querySelector(".poster").classList.contains("poster-no-streaming");
    expect(greyed("Owned Not Streaming")).toBe(false);
    expect(greyed("Owned Via Tmdb")).toBe(false);
    expect(greyed("Streaming Only")).toBe(false);
    expect(greyed("Unavailable")).toBe(true);
    expect(greyed("TV Id Clash")).toBe(true);
  });

  it("matches by TMDB id + media type when there's no IMDb id, never across movie/TV or on missing ids", () => {
    expect(card("Owned Via Tmdb").querySelector(".owned-tag")).not.toBeNull();
    expect(card("TV Id Clash").querySelector(".owned-tag")).toBeNull();
    expect(card("Unavailable").querySelector(".owned-tag")).toBeNull();
  });

  it("filters by availability: streaming, owned, neither", () => {
    clickChip("filter-availability", "streaming");
    expect(cardTitles()).toEqual(["Owned And Streaming", "Streaming Only"]);

    clickChip("filter-availability", "owned");
    expect(cardTitles()).toEqual(["Owned And Streaming", "Owned Not Streaming", "Owned Via Tmdb"]);

    clickChip("filter-availability", "neither");
    expect(cardTitles()).toEqual(["TV Id Clash", "Unavailable"]);

    clickChip("filter-availability", "all");
    expect(cardTitles()).toHaveLength(6);
  });

  it("shows 'On your shelf' in the drawer's Where to watch section", () => {
    click(card("Owned Not Streaming"));
    const body = document.getElementById("detail-body");
    const headings = [...body.querySelectorAll(".detail-section h4")].map((h) => h.textContent);
    expect(headings).toContain("Where to watch");
    expect(body.querySelector(".owned-line").textContent).toBe("On your shelf — Blu-ray, DVD");
    expect(body.querySelector(".streaming-empty").textContent).toBe("Not streaming in Poland");
    click(document.getElementById("detail-modal"));

    click(card("Streaming Only"));
    expect(document.querySelector("#detail-body .owned-line")).toBeNull();
  });

  it("shows the Owned tag in list view's Where to watch column", () => {
    click(document.getElementById("view-list-btn"));
    const headerCells = [...document.querySelectorAll("#watchlist-list .list-header-cell")].map((c) => c.textContent);
    expect(headerCells).toContain("Where to watch");

    const rows = [...document.querySelectorAll("#watchlist-list .movie-row")];
    const owned = rows.find((r) => r.textContent.includes("Owned Not Streaming"));
    expect(owned.querySelector(".row-streaming .owned-tag")).not.toBeNull();
    expect(owned.querySelector(".row-poster-img").classList.contains("poster-no-streaming")).toBe(false);
  });
});

describe("Add to watchlist: title already in the collection (real app)", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function previewFor(imdbId) {
    await bootRealApp({
      session: { user: { id: "u1" }, access_token: "t" },
      movies,
      watchlist: [],
      fetchImpl: async (input) => {
        const url = String(input);
        const body = url.startsWith("/api/movie-search")
          ? { results: [{ tmdbId: 1, mediaType: "movie", title: "Anything", year: 2001, posterUrl: null }] }
          : url.startsWith("/api/movie-lookup")
            ? { mediaType: "movie", title: "Anything", year: 2001, imdbId, tmdbId: 1 }
            : { providers: [], link: null };
        return { ok: true, status: 200, json: async () => body };
      },
    });
    document.getElementById("tab-watchlist").click();
    document.getElementById("add-movie-btn").click();
    const input = document.getElementById("search-query");
    input.value = "Anything";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    const result = await vi.waitFor(
      () => document.querySelector("#search-results .search-result-item") || Promise.reject(new Error("no results")),
      { timeout: 2000 }
    );
    result.click();
    return vi.waitFor(() => {
      const el = document.getElementById("movie-preview");
      if (el.hidden) throw new Error("preview not shown yet");
      return el;
    });
  }

  it("notes that you already own it, without blocking the add", async () => {
    const preview = await previewFor("tt0000001");
    expect(preview.querySelector(".duplicate-notice").textContent).toContain("You already own this — Blu-ray, DVD");
    expect(document.getElementById("confirm-add-btn").disabled).toBe(false);
  });

  it("shows no ownership note for a title you don't own", async () => {
    const preview = await previewFor("tt9999999");
    expect(preview.querySelector(".duplicate-notice")).toBeNull();
  });
});
