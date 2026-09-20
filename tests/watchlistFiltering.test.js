import { describe, it, expect, beforeEach } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";
import { movies } from "./fixtures/movies.js";
import { watchlist } from "./fixtures/watchlist.js";

function click(id) {
  document.getElementById(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function clickChip(containerId, value) {
  document
    .querySelector(`#${containerId} .chip[data-value="${value}"]`)
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function counterText() {
  return document.getElementById("movie-counter").textContent;
}

function cardTitles() {
  return Array.from(document.querySelectorAll("#watchlist-grid .card-title")).map((n) => n.textContent);
}

beforeEach(async () => {
  await bootDemoApp({ movies, watchlist });
  click("tab-watchlist");
});

describe("Watchlist filtering", () => {
  it("renders all fixture watchlist items on switching tabs", () => {
    expect(counterText()).toBe("3 movies");
    expect(document.querySelectorAll("#watchlist-grid .movie-card")).toHaveLength(3);
  });

  it("filters by genre", () => {
    clickChip("filter-genre", "Drama");
    expect(counterText()).toBe("2 movies");
    expect(cardTitles().sort()).toEqual(["Awaiting Dawn", "Cue the Credits"]);
  });

  it("filters by country", () => {
    clickChip("filter-country", "Germany");
    expect(counterText()).toBe("2 movies");
    expect(cardTitles().sort()).toEqual(["Backlog Blues", "Cue the Credits"]);
  });

  it("filters by decade", () => {
    clickChip("filter-decade", "2020s");
    expect(counterText()).toBe("1 movie");
    expect(cardTitles()).toEqual(["Awaiting Dawn"]);

    clickChip("filter-decade", "2020s"); // toggle off
    clickChip("filter-decade", "1990s");
    expect(counterText()).toBe("1 movie");
    expect(cardTitles()).toEqual(["Backlog Blues"]);
  });

  it("filters by streaming availability", () => {
    clickChip("filter-streaming-available", "yes");
    expect(counterText()).toBe("2 movies");
    expect(cardTitles().sort()).toEqual(["Awaiting Dawn", "Cue the Credits"]);

    clickChip("filter-streaming-available", "no");
    expect(counterText()).toBe("1 movie");
    expect(cardTitles()).toEqual(["Backlog Blues"]);
  });

  it("filters by streaming service", () => {
    clickChip("filter-streaming-service", "Netflix");
    expect(counterText()).toBe("1 movie");
    expect(cardTitles()).toEqual(["Awaiting Dawn"]);
  });

  it("resets every filter via Clear all", () => {
    clickChip("filter-genre", "Drama");
    clickChip("filter-streaming-available", "yes");
    click("filter-clear-btn");

    expect(counterText()).toBe("3 movies");
    expect(
      document.querySelector('#filter-streaming-available .chip[data-value="all"]').classList.contains("active")
    ).toBe(true);
  });
});
