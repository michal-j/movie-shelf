import { describe, it, expect, beforeEach } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";
import { movies } from "./fixtures/movies.js";
import { watchlist } from "./fixtures/watchlist.js";

function click(el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function firstCard() {
  return document.querySelector("#movie-grid .movie-card");
}

// Regression tests: on a real iPhone, tapping a card's poster used to
// sometimes open the detail drawer on the first tap and sometimes need a
// second tap, depending on the card's content — an artifact of relying on
// WebKit's native "first tap simulates :hover" quirk instead of controlling
// it directly. Cards now track their own preview state via a CSS class, so
// the two-tap behavior is deliberate and consistent regardless of content.
describe("tap-to-preview on touch devices", () => {
  it("does not open the drawer on the first tap; opens on the second", async () => {
    await bootDemoApp({ movies, watchlist, touch: true });
    const card = firstCard();

    click(card);
    expect(card.classList.contains("preview-active")).toBe(true);
    expect(document.getElementById("detail-modal").hidden).toBe(true);

    click(card);
    expect(document.getElementById("detail-modal").hidden).toBe(false);
  });

  it("moves the preview to a different card instead of opening it", async () => {
    await bootDemoApp({ movies, watchlist, touch: true });
    const cards = document.querySelectorAll("#movie-grid .movie-card");
    const [first, second] = cards;

    click(first);
    expect(first.classList.contains("preview-active")).toBe(true);

    click(second);
    expect(first.classList.contains("preview-active")).toBe(false);
    expect(second.classList.contains("preview-active")).toBe(true);
    expect(document.getElementById("detail-modal").hidden).toBe(true);
  });

  it("clears the preview when tapping outside any card", async () => {
    await bootDemoApp({ movies, watchlist, touch: true });
    const card = firstCard();

    click(card);
    expect(card.classList.contains("preview-active")).toBe(true);

    click(document.getElementById("movie-counter"));
    expect(card.classList.contains("preview-active")).toBe(false);
  });

  it("opens directly on a single click on non-touch devices", async () => {
    await bootDemoApp({ movies, watchlist, touch: false });
    const card = firstCard();

    click(card);
    expect(document.getElementById("detail-modal").hidden).toBe(false);
  });
});
