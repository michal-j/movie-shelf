import { describe, it, expect } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";
import { bootRealApp } from "./helpers/bootRealApp.js";
import { movies } from "./fixtures/movies.js";
import { watchlist } from "./fixtures/watchlist.js";

function click(el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

describe("mobile hamburger menu (demo)", () => {
  it("starts closed, opens and closes via its toggle button", async () => {
    await bootDemoApp({ movies, watchlist });
    const menu = document.getElementById("mobile-menu");
    const toggle = document.getElementById("mobile-menu-btn");
    expect(menu.hidden).toBe(true);

    click(toggle);
    expect(menu.hidden).toBe(false);
    expect(toggle.classList.contains("active")).toBe(true);

    click(toggle);
    expect(menu.hidden).toBe(true);
    expect(toggle.classList.contains("active")).toBe(false);
  });

  it("closes when clicking outside the menu", async () => {
    await bootDemoApp({ movies, watchlist });
    click(document.getElementById("mobile-menu-btn"));
    expect(document.getElementById("mobile-menu").hidden).toBe(false);

    click(document.getElementById("movie-grid"));
    expect(document.getElementById("mobile-menu").hidden).toBe(true);
  });

  it("its Add-movie item is inert in demo mode, matching the topbar button", async () => {
    await bootDemoApp({ movies, watchlist });
    const mobileAdd = document.getElementById("mobile-add-btn");
    expect(mobileAdd.classList.contains("btn-inert")).toBe(true);
    expect(mobileAdd.getAttribute("aria-disabled")).toBe("true");
  });

  it("has no Sign out item (demo has no session)", async () => {
    await bootDemoApp({ movies, watchlist });
    expect(document.getElementById("mobile-sign-out-btn")).toBeNull();
  });
});

describe("mobile hamburger menu (real app)", () => {
  it("Add movie item opens the edit modal and closes the menu", async () => {
    await bootRealApp({ session: { user: { id: "u1" } }, movies: [], watchlist: [] });
    click(document.getElementById("mobile-menu-btn"));
    click(document.getElementById("mobile-add-btn"));

    expect(document.getElementById("edit-modal").hidden).toBe(false);
    expect(document.getElementById("mobile-menu").hidden).toBe(true);
  });
});
