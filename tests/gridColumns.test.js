import { describe, it, expect } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";
import { movies } from "./fixtures/movies.js";
import { watchlist } from "./fixtures/watchlist.js";

// jsdom doesn't run a real layout engine, so every element's clientWidth is
// 0 — app.js's maxGridColsForViewport() falls back to window.innerWidth in
// that case, which is exactly the path these tests exercise.
describe("grid columns cap to viewport width", () => {
  it("caps the 'Per row' slider's max below the usual ceiling on a narrow window", async () => {
    Object.defineProperty(window, "innerWidth", { value: 900, configurable: true });
    await bootDemoApp({ movies, watchlist });

    const slider = document.getElementById("grid-cols-slider");
    expect(Number(slider.max)).toBeLessThan(8);
    expect(Number(slider.value)).toBeLessThanOrEqual(Number(slider.max));
  });

  it("clamps a previously-saved column count down to fit a narrow window", async () => {
    localStorage.setItem("movieShelf.gridCols", "8");
    Object.defineProperty(window, "innerWidth", { value: 900, configurable: true });
    await bootDemoApp({ movies, watchlist });

    const slider = document.getElementById("grid-cols-slider");
    expect(Number(slider.value)).toBeLessThan(8);
    expect(document.getElementById("movie-grid").style.getPropertyValue("--grid-cols")).toBe(slider.value);
  });

  it("allows the full column range again on a wide window", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
    await bootDemoApp({ movies, watchlist });

    const slider = document.getElementById("grid-cols-slider");
    expect(Number(slider.max)).toBe(8);
  });
});
