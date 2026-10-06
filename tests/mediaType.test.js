import { describe, it, expect } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";
import { movies } from "./fixtures/movies.js";
import { watchlist } from "./fixtures/watchlist.js";

function click(el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function cardByTitle(gridId, title) {
  return [...document.querySelectorAll(`#${gridId} .movie-card`)].find(
    (card) => card.querySelector(".card-title").textContent === title
  );
}

// Fixture "Fourth Wall" (collection) and "Backlog Blues" (watchlist) are
// mediaType: "tv"; every other fixture item is a plain movie (either
// explicitly or via the missing-field default) — see fixtures/movies.js
// and fixtures/watchlist.js.
describe("movie/TV badges and labels", () => {
  it("shows an always-visible TV corner badge on a TV grid card, and none on a movie card", async () => {
    await bootDemoApp({ movies, watchlist });

    const tvCard = cardByTitle("movie-grid", "Fourth Wall");
    expect(tvCard.querySelector(".type-badge")).not.toBeNull();
    expect(tvCard.querySelector(".type-badge").textContent).toBe("TV");

    const movieCard = cardByTitle("movie-grid", "The Prefect Storm");
    expect(movieCard.querySelector(".type-badge")).toBeNull();
  });

  it("shows the TV corner badge on a watchlist grid card too", async () => {
    await bootDemoApp({ movies, watchlist });
    click(document.getElementById("tab-watchlist"));

    const tvCard = cardByTitle("watchlist-grid", "Backlog Blues");
    expect(tvCard.querySelector(".type-badge")).not.toBeNull();

    const movieCard = cardByTitle("watchlist-grid", "Awaiting Dawn");
    expect(movieCard.querySelector(".type-badge")).toBeNull();
  });

  it("shows an inline TV tag next to the title in list view, collection and watchlist", async () => {
    await bootDemoApp({ movies, watchlist });
    click(document.getElementById("view-list-btn"));

    const rows = [...document.querySelectorAll("#movie-list .movie-row")];
    const tvRow = rows.find((r) => r.textContent.includes("Fourth Wall"));
    expect(tvRow.querySelector(".type-tag-inline")).not.toBeNull();
    const movieRow = rows.find((r) => r.textContent.includes("The Prefect Storm"));
    expect(movieRow.querySelector(".type-tag-inline")).toBeNull();

    click(document.getElementById("tab-watchlist"));
    const wlRows = [...document.querySelectorAll("#watchlist-list .movie-row")];
    const wlTvRow = wlRows.find((r) => r.textContent.includes("Backlog Blues"));
    expect(wlTvRow.querySelector(".type-tag-inline")).not.toBeNull();
  });

  it("shows a 'TV Series' pill in the detail drawer for a TV item, and no pill for a movie", async () => {
    await bootDemoApp({ movies, watchlist });

    click(cardByTitle("movie-grid", "Fourth Wall"));
    expect(document.querySelector("#detail-body .pill-type-tv")).not.toBeNull();
    expect(document.querySelector("#detail-body .pill-type-tv").textContent).toBe("TV Series");
    click(document.getElementById("detail-modal"));

    click(cardByTitle("movie-grid", "The Prefect Storm"));
    expect(document.querySelector("#detail-body .pill-type-tv")).toBeNull();
  });

  it("shows the 'Creator' label instead of 'Director' for a TV item in the drawer", async () => {
    await bootDemoApp({ movies, watchlist });

    click(cardByTitle("movie-grid", "Fourth Wall"));
    const creditsTerms = [...document.querySelectorAll("#detail-body .meta-table dt")].map((n) => n.textContent);
    expect(creditsTerms).toContain("Creator");
    expect(creditsTerms).not.toContain("Director");
  });
});
