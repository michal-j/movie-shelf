import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { bootRealApp } from "./helpers/bootRealApp.js";

// After a successful add, the new title is scrolled into view and highlighted
// for a few seconds (grid card or list row). If the active filters/search
// hide it, nothing is highlighted and the toast says so.

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const SESSION = { user: { id: "u1" }, access_token: "t" };

const existing = {
  id: "m1",
  title: "Existing Film",
  imdbId: "tt0000001",
  year: 1990,
  genres: ["Drama"],
  countries: ["France"],
  format: "DVD",
  watched: false,
  copies: [{ format: "DVD" }],
};

const lookupResult = {
  mediaType: "movie",
  title: "Brand New Film",
  year: 2024,
  imdbId: "tt0000002",
  tmdbId: 2,
  genres: ["Comedy"],
};

function fetchImpl(lookup) {
  return async (input) => {
    const url = String(input);
    if (url.startsWith("/api/movie-search")) {
      return jsonResponse({ results: [{ tmdbId: lookup.tmdbId, mediaType: "movie", title: lookup.title, year: lookup.year }] });
    }
    if (url.startsWith("/api/movie-lookup")) return jsonResponse(lookup);
    return jsonResponse({ providers: [], link: null });
  };
}

// Drives the real add flow up to (and including) clicking the confirm button.
async function addTitle({ tab = "collection", title }) {
  if (tab === "watchlist") document.getElementById("tab-watchlist").click();
  document.getElementById("add-movie-btn").click();
  const input = document.getElementById("search-query");
  input.value = title;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  const resultBtn = await vi.waitFor(
    () => {
      const btn = document.querySelector("#search-results .search-result-item");
      if (!btn) throw new Error("no results yet");
      return btn;
    },
    { timeout: 2000 }
  );
  resultBtn.click();
  await vi.waitFor(() => {
    if (document.getElementById("movie-preview").hidden) throw new Error("preview not shown yet");
  });
  document.getElementById("confirm-add-btn").click();
}

const toastText = () => document.querySelector("#toast .toast-text")?.textContent ?? "";
const toastAction = () => document.querySelector("#toast .toast-action");

function typeSearch(value) {
  const search = document.getElementById("search-input");
  search.value = value;
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function clickChip(containerId, value) {
  document
    .querySelector(`#${containerId} .chip[data-value="${value}"]`)
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

async function waitForToast(prefix) {
  await vi.waitFor(() => {
    if (!toastText().startsWith(prefix)) throw new Error("no toast yet");
  });
}
const highlighted = () => Array.from(document.querySelectorAll(".just-added"));

let scrollSpy;
beforeEach(() => {
  localStorage.clear(); // view mode / active tab persist here between tests
  scrollSpy = vi.fn();
  window.Element.prototype.scrollIntoView = scrollSpy;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Reveal and highlight after adding (real app)", () => {
  it("highlights and scrolls to the new grid card in the collection", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], fetchImpl: fetchImpl(lookupResult) });
    await addTitle({ title: "Brand New Film" });

    await vi.waitFor(() => {
      if (!highlighted().length) throw new Error("not highlighted yet");
    });
    const [card] = highlighted();
    expect(card.classList.contains("movie-card")).toBe(true);
    expect(card.querySelector(".card-title").textContent).toBe("Brand New Film");
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.contexts[0]).toBe(card);
    expect(toastText()).toBe("Movie added");
  });

  it("highlights the new row in list view", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], fetchImpl: fetchImpl(lookupResult) });
    document.getElementById("view-list-btn")?.click();
    await addTitle({ title: "Brand New Film" });

    await vi.waitFor(() => {
      if (!highlighted().length) throw new Error("not highlighted yet");
    });
    const [row] = highlighted();
    expect(row.classList.contains("movie-row")).toBe(true);
    expect(row.textContent).toContain("Brand New Film");
  });

  it("highlights the new watchlist item", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], watchlist: [], fetchImpl: fetchImpl(lookupResult) });
    await addTitle({ tab: "watchlist", title: "Brand New Film" });

    await vi.waitFor(() => {
      if (!highlighted().length) throw new Error("not highlighted yet");
    });
    expect(highlighted()[0].querySelector(".card-title").textContent).toBe("Brand New Film");
    expect(toastText()).toBe("Added to watchlist");
  });

  it("highlights the existing title when a copy is added to it", async () => {
    await bootRealApp({
      session: SESSION,
      movies: [existing],
      fetchImpl: fetchImpl({ ...lookupResult, title: "Existing Film", imdbId: "tt0000001" }),
    });
    // The fake client's update().eq() resolves { error: null }, same as a real success.
    await addTitle({ title: "Existing Film" });

    await vi.waitFor(() => {
      if (!highlighted().length) throw new Error("not highlighted yet");
    });
    expect(highlighted()).toHaveLength(1);
    expect(highlighted()[0].dataset.id).toBe("m1");
    expect(toastText()).toContain("copy of");
  });

  it("keeps the highlight through a re-render and mouse movement", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], fetchImpl: fetchImpl(lookupResult) });
    await addTitle({ title: "Brand New Film" });
    await vi.waitFor(() => {
      if (!highlighted().length) throw new Error("not highlighted yet");
    });

    // Mouse leaving/entering other cards must not clear it.
    const other = document.querySelector('.movie-card[data-id="m1"]');
    other.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
    other.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
    expect(highlighted()).toHaveLength(1);

    // A background refresh re-renders the whole grid; the highlight is re-applied.
    const search = document.getElementById("search-input");
    search.value = "brand";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(highlighted()).toHaveLength(1);
    expect(highlighted()[0].querySelector(".card-title").textContent).toBe("Brand New Film");
    // Re-rendering must not scroll again.
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("clears the highlight after a few seconds", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], fetchImpl: fetchImpl(lookupResult) });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await addTitle({ title: "Brand New Film" });
    await vi.waitFor(() => {
      if (!highlighted().length) throw new Error("not highlighted yet");
    });

    vi.advanceTimersByTime(3000);
    expect(highlighted()).toHaveLength(1);
    vi.advanceTimersByTime(1500);
    expect(highlighted()).toHaveLength(0);
  });

  it("does not highlight a title hidden by search, and says so in the toast", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], fetchImpl: fetchImpl(lookupResult) });
    typeSearch("existing");

    await addTitle({ title: "Brand New Film" });
    await waitForToast("Movie added");

    expect(highlighted()).toHaveLength(0);
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(toastText()).toBe("Movie added — hidden by your search");
    expect(toastAction()?.textContent).toBe("Show");
  });

  it("names filters, or search and filters, as the reason", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], fetchImpl: fetchImpl(lookupResult) });
    clickChip("filter-genre", "Drama");
    await addTitle({ title: "Brand New Film" });
    await waitForToast("Movie added");
    expect(toastText()).toBe("Movie added — hidden by your filters");

    // Adding the same title again is an extra copy — also hidden, same wording.
    typeSearch("existing");
    await addTitle({ title: "Brand New Film" });
    await vi.waitFor(() => {
      if (!toastText().includes("search and filters")) throw new Error("no second toast yet");
    });
    expect(toastText()).toBe('Added DVD copy of "Brand New Film" — hidden by your search and filters');
  });

  it("Show clears search and filters, then reveals and highlights the title", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], fetchImpl: fetchImpl(lookupResult) });
    clickChip("filter-genre", "Drama");
    typeSearch("existing");
    await addTitle({ title: "Brand New Film" });
    await waitForToast("Movie added");

    toastAction().click();

    expect(document.getElementById("search-input").value).toBe("");
    expect(document.querySelector('#filter-genre .chip[data-value="Drama"]').classList.contains("active")).toBe(false);
    expect(document.getElementById("filter-count-badge").hidden).toBe(true);
    expect(document.getElementById("toast").hidden).toBe(true);
    expect(highlighted()).toHaveLength(1);
    expect(highlighted()[0].querySelector(".card-title").textContent).toBe("Brand New Film");
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    // Both titles are visible again.
    expect(document.querySelectorAll("#movie-grid .movie-card")).toHaveLength(2);
  });

  it("Show only clears the watchlist's own filters when adding to the watchlist", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], watchlist: [{ ...existing, id: "w1" }], fetchImpl: fetchImpl(lookupResult) });
    clickChip("filter-genre", "Drama"); // collection filter, should survive
    document.getElementById("tab-watchlist").click();
    clickChip("filter-genre", "Drama"); // watchlist filter
    await addTitle({ title: "Brand New Film" });
    await waitForToast("Added to watchlist");
    expect(toastText()).toBe("Added to watchlist — hidden by your filters");

    toastAction().click();
    expect(highlighted()).toHaveLength(1);

    document.getElementById("tab-collection").click();
    expect(document.getElementById("filter-count-badge").textContent).toBe("1");
  });

  it("on touch, a highlighted card opens on the first tap", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], touch: true, fetchImpl: fetchImpl(lookupResult) });
    await addTitle({ title: "Brand New Film" });
    await vi.waitFor(() => {
      if (!highlighted().length) throw new Error("not highlighted yet");
    });

    highlighted()[0].click();
    expect(document.getElementById("detail-modal").hidden).toBe(false);

    // Other cards keep the normal tap-to-preview-first behaviour.
    document.getElementById("detail-modal").hidden = true;
    const other = document.querySelector('.movie-card[data-id="m1"]');
    other.click();
    expect(document.getElementById("detail-modal").hidden).toBe(true);
    expect(other.classList.contains("preview-active")).toBe(true);
  });

  it("a plain toast has no action button", async () => {
    await bootRealApp({ session: SESSION, movies: [existing], fetchImpl: fetchImpl(lookupResult) });
    await addTitle({ title: "Brand New Film" });
    await waitForToast("Movie added");
    expect(toastAction()).toBeNull();
  });
});
