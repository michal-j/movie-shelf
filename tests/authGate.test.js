import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootRealApp } from "./helpers/bootRealApp.js";

function bodyVisibility() {
  return getComputedStyle(document.body).visibility;
}

describe("real app auth gate (index.html)", () => {
  beforeEach(() => localStorage.clear());

  // Regression test: index.html's app shell (topbar, empty grid, etc.) used
  // to be visible immediately on load, then get replaced by a redirect to
  // the login page once app.js discovered there was no session — a
  // brief "flash of the app" for every signed-out visitor. index.html now
  // hides the body by default and app.js only reveals it once a session is
  // confirmed.
  // jsdom logs a harmless "Not implemented: navigation" stderr line here —
  // app.js does assign window.location.href, jsdom just doesn't act on it.
  it("keeps the app hidden and does not reveal it when there is no session", async () => {
    const { getSession } = await bootRealApp({ session: null });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(bodyVisibility()).toBe("hidden");
  });

  it("reveals the app once a session is confirmed", async () => {
    await bootRealApp({
      session: { user: { id: "u1" } },
      movies: [{ id: "m1", title: "Test Movie", year: 2000 }],
      watchlist: [],
    });
    expect(bodyVisibility()).toBe("visible");
  });

  // Regression test: the remembered Watchlist tab used to only be applied
  // after the data queries finished, so for ~a second the revealed shell
  // showed "Personal collection" as the active tab before flipping.
  it("shows the remembered Watchlist tab as soon as the shell is revealed, before data loads", async () => {
    localStorage.setItem("movieShelf.activeView", "watchlist");
    const never = () => new Promise(() => {});
    await bootRealApp({
      session: { user: { id: "u1" } },
      movies: never,
      waitForData: false,
    });
    expect(bodyVisibility()).toBe("visible");
    expect(document.getElementById("tab-watchlist").classList.contains("active")).toBe(true);
    expect(document.getElementById("tab-collection").classList.contains("active")).toBe(false);
    expect(document.getElementById("add-movie-btn-label").textContent).toBe("Add to watchlist");
  });

  // Loading skeleton: while the first fetch is pending the active view's
  // container shows placeholders instead of being blank; the real render
  // then replaces them.
  describe("loading skeleton", () => {
    function pending() {
      let resolve;
      const promise = new Promise((r) => (resolve = r));
      return { promise, resolve };
    }

    it("shows placeholder cards in the remembered view's grid while data loads, then replaces them", async () => {
      localStorage.setItem("movieShelf.activeView", "watchlist");
      localStorage.setItem("movieShelf.viewMode", "grid");
      const gate = pending();
      await bootRealApp({
        session: { user: { id: "u1" } },
        movies: () => gate.promise,
        waitForData: false,
      });
      const wlGrid = document.getElementById("watchlist-grid");
      expect(wlGrid.hidden).toBe(false);
      expect(wlGrid.querySelectorAll(".skeleton-card").length).toBeGreaterThanOrEqual(12);
      expect(document.getElementById("movie-grid").hidden).toBe(true);
      expect(document.getElementById("content").getAttribute("aria-busy")).toBe("true");

      gate.resolve({ data: [{ id: "m1", title: "Test Movie", year: 2000 }], error: null });
      await vi.waitFor(() => {
        if (document.getElementById("content").hasAttribute("aria-busy")) throw new Error("still loading");
      }, { timeout: 3000 });
      expect(document.querySelector(".skeleton")).toBeNull();
    });

    it("shows placeholder rows in list mode", async () => {
      localStorage.setItem("movieShelf.activeView", "collection");
      localStorage.setItem("movieShelf.viewMode", "list");
      await bootRealApp({
        session: { user: { id: "u1" } },
        movies: () => new Promise(() => {}),
        waitForData: false,
      });
      const movieList = document.getElementById("movie-list");
      expect(movieList.hidden).toBe(false);
      expect(movieList.querySelectorAll(".skeleton-row").length).toBeGreaterThan(0);
      expect(document.getElementById("movie-grid").hidden).toBe(true);
      expect(document.getElementById("view-list-btn").classList.contains("active")).toBe(true);
    });
  });
});
