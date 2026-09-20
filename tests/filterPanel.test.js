import { describe, it, expect, beforeEach } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";
import { movies } from "./fixtures/movies.js";
import { watchlist } from "./fixtures/watchlist.js";

function click(id) {
  document.getElementById(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

describe("filter panel open/close", () => {
  beforeEach(async () => {
    await bootDemoApp({ movies, watchlist });
  });

  it("starts closed", () => {
    expect(document.getElementById("filter-panel").hidden).toBe(true);
  });

  it("opens and closes via the Filters toggle button", () => {
    click("filter-toggle-btn");
    expect(document.getElementById("filter-panel").hidden).toBe(false);
    expect(document.getElementById("filter-toggle-btn").classList.contains("active")).toBe(true);

    click("filter-toggle-btn");
    expect(document.getElementById("filter-panel").hidden).toBe(true);
    expect(document.getElementById("filter-toggle-btn").classList.contains("active")).toBe(false);
  });

  it("closes when clicking outside the panel", () => {
    click("filter-toggle-btn");
    expect(document.getElementById("filter-panel").hidden).toBe(false);

    document.getElementById("movie-grid").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    expect(document.getElementById("filter-panel").hidden).toBe(true);
    expect(document.getElementById("filter-toggle-btn").classList.contains("active")).toBe(false);
  });

  it("does not close when clicking inside the panel", () => {
    click("filter-toggle-btn");
    document.getElementById("filter-panel").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("filter-panel").hidden).toBe(false);
  });

  it("closes on Escape", () => {
    click("filter-toggle-btn");
    expect(document.getElementById("filter-panel").hidden).toBe(false);

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.getElementById("filter-panel").hidden).toBe(true);
    expect(document.getElementById("filter-toggle-btn").classList.contains("active")).toBe(false);
  });
});

describe("filter panel groups shown per tab", () => {
  beforeEach(async () => {
    await bootDemoApp({ movies, watchlist });
  });

  function hidden(className) {
    return document.querySelector(`.${className}`).hidden;
  }

  it("shows collection-only groups and hides watchlist-only groups on the Personal collection tab", () => {
    expect(hidden("filter-group-watched")).toBe(false);
    expect(hidden("filter-group-format")).toBe(false);
    expect(hidden("filter-group-copies")).toBe(false);
    expect(hidden("filter-group-streaming-available")).toBe(true);
    expect(hidden("filter-group-streaming-service")).toBe(true);
  });

  it("keeps Decade, Genre and Country visible on the Personal collection tab", () => {
    expect(hidden("filter-group-decade")).toBe(false);
    expect(hidden("filter-group-genre")).toBe(false);
    expect(hidden("filter-group-country")).toBe(false);
  });

  it("shows watchlist-only groups and hides collection-only groups on the Watchlist tab", () => {
    click("tab-watchlist");

    expect(hidden("filter-group-watched")).toBe(true);
    expect(hidden("filter-group-format")).toBe(true);
    expect(hidden("filter-group-copies")).toBe(true);
    expect(hidden("filter-group-streaming-available")).toBe(false);
    expect(hidden("filter-group-streaming-service")).toBe(false);
  });

  // Regression test: Decade was accidentally deleted from the Watchlist tab
  // (state, chip building, filtering, badge count) instead of just being
  // repositioned in the filter grid. It must stay usable on both tabs.
  it("keeps Decade (and Genre/Country) visible and populated on the Watchlist tab too", () => {
    click("tab-watchlist");

    expect(hidden("filter-group-decade")).toBe(false);
    expect(hidden("filter-group-genre")).toBe(false);
    expect(hidden("filter-group-country")).toBe(false);
    expect(document.getElementById("filter-decade").childElementCount).toBeGreaterThan(0);
  });
});
