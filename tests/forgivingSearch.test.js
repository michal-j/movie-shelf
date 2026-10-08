import { describe, it, expect, beforeEach } from "vitest";
import { bootDemoApp } from "./helpers/bootApp.js";

const movies = [
  { id: "a", title: "Dr. No", year: 1962, genres: ["Action"], copies: [{ format: "DVD" }], format: "DVD" },
  { id: "b", title: "Re-Animator", year: 1985, genres: ["Horror"], copies: [{ format: "DVD" }], format: "DVD" },
  { id: "c", title: "Se7en", year: 1995, genres: ["Crime"], copies: [{ format: "DVD" }], format: "DVD" },
  { id: "d", title: "Amélie", year: 2001, genres: ["Comedy"], copies: [{ format: "DVD" }], format: "DVD" },
  { id: "e", title: "Schindler's List", year: 1993, genres: ["Drama"], copies: [{ format: "DVD" }], format: "DVD" },
  { id: "f", title: "Ace Ventura", year: 1994, genres: ["Comedy"], copies: [{ format: "DVD" }], format: "DVD" },
  { id: "g", title: "Spacey Tale", year: 2000, genres: ["Drama"], copies: [{ format: "DVD" }], format: "DVD" },
  { id: "h", title: "2001: A Space Odyssey", year: 1968, genres: ["Sci-Fi"], copies: [{ format: "DVD" }], format: "DVD" },
];

function search(q) {
  const input = document.getElementById("search-input");
  input.value = q;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  return Array.from(document.querySelectorAll("#movie-grid .card-title")).map((n) => n.textContent);
}

beforeEach(async () => {
  await bootDemoApp({ movies, watchlist: [] });
});

describe("Forgiving search", () => {
  it.each([["dr no"], ["dr. no"], ["drno"], ["Dr No"]])("finds 'Dr. No' for %s", (q) => {
    expect(search(q)).toEqual(["Dr. No"]);
  });

  it.each([["re animator"], ["reanimator"], ["re-animator"], ["re"]])("finds 'Re-Animator' for %s", (q) => {
    expect(search(q)).toContain("Re-Animator");
  });

  it.each([["seven"], ["se7en"], ["sev"]])("finds 'Se7en' for %s", (q) => {
    expect(search(q)).toEqual(["Se7en"]);
  });

  it("ignores accents and apostrophes", () => {
    expect(search("amelie")).toEqual(["Amélie"]);
    expect(search("schindlers list")).toEqual(["Schindler's List"]);
    expect(search("schindler's")).toEqual(["Schindler's List"]);
  });

  it("still only matches the start of a word", () => {
    expect(search("ace")).toEqual(["Ace Ventura"]);
  });

  it("does not decode standalone numbers", () => {
    expect(search("2001")).toEqual(["2001: A Space Odyssey"]);
  });

  it("punctuation-only input doesn't hide everything", () => {
    expect(search("...")).toHaveLength(movies.length);
  });
});
