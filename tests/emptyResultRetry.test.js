import { describe, it, expect } from "vitest";
import { bootRealApp } from "./helpers/bootRealApp.js";

// Regression tests for a reported real bug: a manual reload of the real
// app consistently showed 0 movies, with no error visible anywhere.
// getSession()/the movies query can both succeed while still hitting a
// transient auth-context race (e.g. an access token that needed
// refreshing), which RLS turns into a *successful* empty result rather
// than an error — nothing to catch, nothing to show as broken, just an
// empty collection that (per the user) wasn't actually empty. app.js now
// treats an empty-but-successful query as suspicious right after load and
// retries once after re-checking the session.
const FIXTURE_MOVIES = [
  { id: "m1", title: "First Movie", year: 2000 },
  { id: "m2", title: "Second Movie", year: 2001 },
];

function counterText() {
  return document.getElementById("movie-counter").textContent;
}

describe("empty query results are retried once before being trusted", () => {
  it("retries and recovers when the first movies query comes back empty but the second doesn't", async () => {
    const movies = (callIndex) =>
      callIndex === 0 ? { data: [], error: null } : { data: FIXTURE_MOVIES, error: null };

    const { getSession } = await bootRealApp({ session: { user: { id: "u1" } }, movies, watchlist: [] });

    expect(counterText()).toBe("2 movies");
    // Session gets re-checked as part of the retry (on top of the
    // original check at the top of init()).
    expect(getSession.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not retry a query that returns data on the first attempt", async () => {
    let calls = 0;
    const movies = () => {
      calls++;
      return { data: FIXTURE_MOVIES, error: null };
    };

    await bootRealApp({ session: { user: { id: "u1" } }, movies, watchlist: [] });

    expect(counterText()).toBe("2 movies");
    expect(calls).toBe(1);
  });

  it("shows a genuinely empty collection as empty, without retrying forever", async () => {
    let calls = 0;
    const movies = () => {
      calls++;
      return { data: [], error: null };
    };

    await bootRealApp({ session: { user: { id: "u1" } }, movies, watchlist: [] });

    expect(counterText()).toBe("0 movies");
    expect(calls).toBe(2); // the original attempt plus exactly one retry
  });
});
