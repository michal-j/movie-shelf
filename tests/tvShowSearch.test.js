import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { bootRealApp } from "./helpers/bootRealApp.js";

// Regression coverage for "the Add search never finds TV shows": the
// search endpoint used TMDB's /search/movie only, and the lookup endpoint
// only ever fetched /movie/{id}. The Blue Planet (2001, TMDB tv/13579,
// IMDb tt0296310) is the real title that exposed it.

const require = createRequire(import.meta.url);

// The /api functions are CommonJS and read their API keys at load time, so
// set the env first and load a fresh copy per test.
function loadHandler(name) {
  process.env.TMDB_API_KEY = "test-tmdb";
  process.env.OMDB_API_KEY = "test-omdb";
  const path = require.resolve(`../api/${name}.js`);
  delete require.cache[path];
  return require(path);
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

const jsonResponse = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

// Routes a URL string to a canned body. The Supabase auth check always
// passes; everything else must be matched or the test fails loudly.
function stubFetch(routes) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/auth/v1/user")) return jsonResponse({ id: "u1" });
      for (const [pattern, body] of routes) {
        if (url.includes(pattern)) return jsonResponse(body);
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    })
  );
  return calls;
}

const authedReq = (query) => ({ method: "GET", headers: { authorization: "Bearer t" }, query });

const BLUE_PLANET_TV_DETAILS = {
  id: 13579,
  name: "The Blue Planet",
  original_name: "The Blue Planet",
  original_language: "en",
  first_air_date: "2001-09-12",
  episode_run_time: [50],
  genres: [{ name: "Documentary" }],
  production_countries: [{ name: "United Kingdom" }],
  production_companies: [{ name: "BBC Natural History Unit" }],
  created_by: [{ name: "Alastair Fothergill" }],
  overview: "A documentary series on the natural history of the oceans.",
  poster_path: "/bp.jpg",
  backdrop_path: "/bp-back.jpg",
  credits: { cast: [{ name: "David Attenborough", character: "Narrator" }] },
  external_ids: { imdb_id: "tt0296310" },
};

const BLUE_PLANET_OMDB = {
  Response: "True",
  Title: "The Blue Planet",
  Year: "2001–2001", // OMDb gives series a year range
  Type: "series",
  Runtime: "N/A",
  Director: "N/A",
  Writer: "N/A",
  Genre: "Documentary",
  Country: "United Kingdom",
  imdbRating: "9.0",
  imdbVotes: "30,000",
  Metascore: "N/A",
  Plot: "N/A",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/api/movie-search", () => {
  it("returns TV shows alongside movies, with mediaType, and drops people", async () => {
    const calls = stubFetch([
      [
        "/search/multi",
        {
          results: [
            { id: 13579, media_type: "tv", name: "The Blue Planet", first_air_date: "2001-09-12", poster_path: "/bp.jpg" },
            { id: 1, media_type: "person", name: "Someone Blue" },
            { id: 99, media_type: "movie", title: "Blue Planet: The Movie", release_date: "1990-01-01", poster_path: null },
          ],
        },
      ],
    ]);
    const handler = loadHandler("movie-search");
    const res = fakeRes();
    await handler(authedReq({ title: "The Blue Planet" }), res);

    expect(calls.some((u) => u.includes("/search/multi"))).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toEqual([
      { tmdbId: 13579, mediaType: "tv", title: "The Blue Planet", year: 2001, posterUrl: "https://image.tmdb.org/t/p/w200/bp.jpg" },
      { tmdbId: 99, mediaType: "movie", title: "Blue Planet: The Movie", year: 1990, posterUrl: null },
    ]);
  });
});

describe("/api/movie-lookup", () => {
  it("fetches /tv/{id} when given tmdbId + mediaType=tv, mapping TV fields", async () => {
    const calls = stubFetch([
      ["/tv/13579", BLUE_PLANET_TV_DETAILS],
      ["omdbapi.com", BLUE_PLANET_OMDB],
    ]);
    const handler = loadHandler("movie-lookup");
    const res = fakeRes();
    await handler(authedReq({ tmdbId: "13579", mediaType: "tv" }), res);

    expect(res.statusCode).toBe(200);
    expect(calls.some((u) => u.includes("/movie/"))).toBe(false);
    expect(res.body).toMatchObject({
      mediaType: "tv",
      title: "The Blue Planet",
      year: 2001, // start of OMDb's "2001–2001" range, not NaN
      runtimeMinutes: 50, // from episode_run_time since OMDb has N/A
      director: ["Alastair Fothergill"], // TMDB creators, since OMDb Director is N/A
      description: BLUE_PLANET_TV_DETAILS.overview,
      tmdbId: 13579,
      imdbId: "tt0296310",
    });
  });

  it("resolves an IMDb ID via tv_results when it has no movie match", async () => {
    const calls = stubFetch([
      ["/find/tt0296310", { movie_results: [], tv_results: [{ id: 13579 }] }],
      ["/tv/13579", BLUE_PLANET_TV_DETAILS],
      ["omdbapi.com", BLUE_PLANET_OMDB],
    ]);
    const handler = loadHandler("movie-lookup");
    const res = fakeRes();
    await handler(authedReq({ imdbId: "tt0296310" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.mediaType).toBe("tv");
    expect(res.body.title).toBe("The Blue Planet");
    expect(calls.some((u) => u.includes("/tv/13579"))).toBe(true);
  });

  it("still defaults a bare tmdbId to a movie (backwards compatible)", async () => {
    const calls = stubFetch([
      [
        "/movie/389",
        {
          id: 389,
          title: "12 Angry Men",
          original_title: "12 Angry Men",
          release_date: "1957-04-10",
          runtime: 97,
          credits: { cast: [] },
          external_ids: { imdb_id: "tt0050083" },
        },
      ],
      ["omdbapi.com", { Response: "True", Title: "12 Angry Men", Year: "1957", Director: "Sidney Lumet" }],
    ]);
    const handler = loadHandler("movie-lookup");
    const res = fakeRes();
    await handler(authedReq({ tmdbId: "389" }), res);

    expect(res.statusCode).toBe(200);
    expect(calls.some((u) => u.includes("/tv/"))).toBe(false);
    expect(res.body).toMatchObject({ mediaType: "movie", year: 1957, director: ["Sidney Lumet"] });
  });

  it("rejects an unknown mediaType", async () => {
    stubFetch([]);
    const handler = loadHandler("movie-lookup");
    const res = fakeRes();
    await handler(authedReq({ tmdbId: "1", mediaType: "person" }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe("Add flow with a TV show result (real app)", () => {
  it("shows a TV tag in results, looks it up as TV, and saves it to the watchlist as mediaType tv", async () => {
    const lookupUrls = [];
    const { inserted } = await bootRealApp({
      session: { user: { id: "u1" }, access_token: "t" },
      movies: [],
      watchlist: [],
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.startsWith("/api/movie-search")) {
          return jsonResponse({
            results: [{ tmdbId: 13579, mediaType: "tv", title: "The Blue Planet", year: 2001, posterUrl: null }],
          });
        }
        if (url.startsWith("/api/movie-lookup")) {
          lookupUrls.push(url);
          return jsonResponse({
            mediaType: "tv",
            title: "The Blue Planet",
            year: 2001,
            director: ["Alastair Fothergill"],
            tmdbId: 13579,
            imdbId: "tt0296310",
          });
        }
        return jsonResponse({ providers: [], link: null });
      },
    });

    document.getElementById("tab-watchlist").click();
    document.getElementById("add-movie-btn").click();
    const input = document.getElementById("search-query");
    input.value = "The Blue Planet";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));

    const resultBtn = await vi.waitFor(
      () => {
        const btn = document.querySelector("#search-results .search-result-item");
        if (!btn) throw new Error("no results yet");
        return btn;
      },
      { timeout: 2000 }
    );
    expect(resultBtn.querySelector(".type-tag-inline")?.textContent).toBe("TV");

    resultBtn.click();
    const preview = await vi.waitFor(() => {
      const el = document.getElementById("movie-preview");
      if (el.hidden) throw new Error("preview not shown yet");
      return el;
    });
    expect(lookupUrls[0]).toContain("tmdbId=13579");
    expect(lookupUrls[0]).toContain("mediaType=tv");
    expect(preview.querySelector(".pill-type-tv")).not.toBeNull();
    expect(preview.textContent).toContain("Creator:");
    expect(preview.textContent).not.toContain("Director:");

    document.getElementById("confirm-add-btn").click();
    await vi.waitFor(() => {
      if (!inserted.watchlist.length) throw new Error("nothing inserted yet");
    });
    expect(inserted.watchlist[0].media_type).toBe("tv");
    expect(inserted.watchlist[0].title).toBe("The Blue Planet");
  });
});
