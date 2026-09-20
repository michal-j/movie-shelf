import { describe, it, expect, beforeEach } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";
import { movies } from "./fixtures/movies.js";
import { watchlist } from "./fixtures/watchlist.js";

function clickChip(containerId, value) {
  document
    .querySelector(`#${containerId} .chip[data-value="${value}"]`)
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function counterText() {
  return document.getElementById("movie-counter").textContent;
}

function cardTitles() {
  return Array.from(document.querySelectorAll("#movie-grid .card-title")).map((n) => n.textContent);
}

beforeEach(async () => {
  await bootDemoApp({ movies, watchlist });
});

describe("Personal collection filtering", () => {
  it("renders all fixture movies on first load", () => {
    expect(counterText()).toBe("4 movies");
    expect(document.querySelectorAll("#movie-grid .movie-card")).toHaveLength(4);
  });

  it("filters by search text against the title", () => {
    document.getElementById("search-input").value = "Second";
    document.getElementById("search-input").dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(counterText()).toBe("1 movie");
    expect(cardTitles()).toEqual(["Second Sight"]);
  });

  it("filters by watched status", () => {
    clickChip("filter-watched", "watched");
    expect(counterText()).toBe("2 movies");
    expect(cardTitles().sort()).toEqual(["Fourth Wall", "The Prefect Storm"]);

    clickChip("filter-watched", "unwatched");
    expect(counterText()).toBe("2 movies");
    expect(cardTitles().sort()).toEqual(["Second Sight", "Third Wheel"]);
  });

  it("filters by format", () => {
    clickChip("filter-format", "DVD");
    expect(counterText()).toBe("2 movies");
    expect(cardTitles().sort()).toEqual(["Second Sight", "Third Wheel"]);
  });

  it("filters by multiple-copies", () => {
    clickChip("filter-copies", "multi");
    expect(counterText()).toBe("1 movie");
    expect(cardTitles()).toEqual(["Second Sight"]);
  });

  it("filters by genre", () => {
    clickChip("filter-genre", "Comedy");
    expect(counterText()).toBe("2 movies");
    expect(cardTitles().sort()).toEqual(["Fourth Wall", "Third Wheel"]);
  });

  it("filters by country", () => {
    clickChip("filter-country", "France");
    expect(counterText()).toBe("2 movies");
    expect(cardTitles().sort()).toEqual(["Fourth Wall", "Third Wheel"]);
  });

  it("filters by decade", () => {
    clickChip("filter-decade", "1990s");
    expect(counterText()).toBe("2 movies");
    expect(cardTitles().sort()).toEqual(["Second Sight", "The Prefect Storm"]);

    clickChip("filter-decade", "1990s"); // toggle back off
    clickChip("filter-decade", "1980s");
    expect(counterText()).toBe("1 movie");
    expect(cardTitles()).toEqual(["Third Wheel"]);
  });

  it("combines multiple active filters", () => {
    clickChip("filter-genre", "Drama");
    clickChip("filter-decade", "1990s");
    expect(counterText()).toBe("1 movie");
    expect(cardTitles()).toEqual(["The Prefect Storm"]);
  });

  it("resets every filter via Clear all", () => {
    clickChip("filter-genre", "Drama");
    clickChip("filter-decade", "1990s");
    clickChip("filter-watched", "watched");
    document.getElementById("filter-clear-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    expect(counterText()).toBe("4 movies");
    expect(document.querySelector('#filter-watched .chip[data-value="all"]').classList.contains("active")).toBe(true);
  });

  it("sorts by year, newest first", () => {
    const select = document.getElementById("sort-select");
    select.value = "year-desc";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(cardTitles()).toEqual(["Fourth Wall", "The Prefect Storm", "Second Sight", "Third Wheel"]);
  });
});
