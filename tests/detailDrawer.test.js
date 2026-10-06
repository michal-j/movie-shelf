import { describe, it, expect } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";
import { movies } from "./fixtures/movies.js";
import { watchlist } from "./fixtures/watchlist.js";

function click(el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Regression tests for a real bug reported on desktop: the drawer would
// sometimes hide itself immediately after opening, and the next open would
// snap into place with no slide-in animation. Root cause: closeDetailModal()
// schedules a 350ms fallback timer to force-hide the drawer (in case
// transitionend never fires), but never cancelled it if the drawer was
// reopened before it fired — clicking a different card while the previous
// one was still mid-close let that stale timer fire later and force-hide
// the newly opened drawer. Because the fallback only sets `hidden = true`
// without touching the "open" class, the drawer was also left in an
// inconsistent state where the next open's re-add of the "open" class was a
// no-op, skipping the transition entirely.
describe("detail drawer open/close race (desktop)", () => {
  it("does not auto-hide a drawer reopened while the previous one is still closing", async () => {
    await bootDemoApp({ movies, watchlist, touch: false });
    const cards = document.querySelectorAll("#movie-grid .movie-card");
    const detailModal = document.getElementById("detail-modal");

    click(cards[0]);
    expect(detailModal.hidden).toBe(false);

    click(detailModal); // backdrop click closes it, scheduling the fallback timer
    await wait(100); // well inside the close's 350ms fallback window

    click(cards[1]); // reopen with a different card before the old close finishes
    expect(detailModal.hidden).toBe(false);

    await wait(400); // past when the stale fallback timer would have fired
    expect(detailModal.hidden).toBe(false);
  });

  it("still animates the drawer open after that race", async () => {
    await bootDemoApp({ movies, watchlist, touch: false });
    const cards = document.querySelectorAll("#movie-grid .movie-card");
    const detailModal = document.getElementById("detail-modal");

    click(cards[0]);
    click(detailModal);
    await wait(100);
    click(cards[1]);
    await wait(400);

    expect(detailModal.classList.contains("open")).toBe(true);
  });
});

// Second root cause, found later: when the close finished via transitionend,
// its listener (and fallback timer) were never removed. That zombie listener
// then caught the *next* open's own slide-in transitionend and hid the
// drawer the moment it finished sliding out; the hide left the "open" class
// stuck on, so the open after that skipped its animation. Alternating
// open → vanishes / open → no animation, indefinitely.
describe("detail drawer reopen after a completed close (desktop)", () => {
  function slideEnd(panel) {
    const e = new window.Event("transitionend", { bubbles: true });
    e.propertyName = "transform";
    panel.dispatchEvent(e);
  }

  it("stays open after its own slide-in finishes following a completed close", async () => {
    await bootDemoApp({ movies, watchlist, touch: false });
    const cards = document.querySelectorAll("#movie-grid .movie-card");
    const detailModal = document.getElementById("detail-modal");
    const panel = detailModal.querySelector(".detail-modal");

    click(cards[0]);
    await wait(50);
    click(detailModal);
    slideEnd(panel); // close finishes via transitionend
    expect(detailModal.hidden).toBe(true);

    click(cards[0]);
    await wait(50);
    expect(detailModal.classList.contains("open")).toBe(true);
    slideEnd(panel); // the new open's slide-in finishing
    await wait(400);
    expect(detailModal.hidden).toBe(false);
    expect(detailModal.classList.contains("open")).toBe(true);
  });

  it("does not leave a stuck open class when closed before the open frame fires", async () => {
    await bootDemoApp({ movies, watchlist, touch: false });
    const cards = document.querySelectorAll("#movie-grid .movie-card");
    const detailModal = document.getElementById("detail-modal");

    click(cards[0]);
    click(detailModal); // close immediately, before the double-rAF add
    await wait(400);
    expect(detailModal.hidden).toBe(true);
    expect(detailModal.classList.contains("open")).toBe(false);
  });
});
