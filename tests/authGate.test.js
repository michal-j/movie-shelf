import { describe, it, expect } from "vitest";
import { bootRealApp } from "./helpers/bootRealApp.js";

function bodyVisibility() {
  return getComputedStyle(document.body).visibility;
}

describe("real app auth gate (index.html)", () => {
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
});
