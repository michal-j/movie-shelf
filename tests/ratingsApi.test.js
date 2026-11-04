import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";

// /api/ratings and the shared OMDb entity decoding. The handler reads
// OMDB_API_KEY at load time, so each test loads a fresh copy.

const require = createRequire(import.meta.url);

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function load() {
  for (const k of Object.keys(require.cache)) if (k.includes("/api/")) delete require.cache[k];
  process.env.OMDB_API_KEY = "test-key";
  return require("../api/ratings.js");
}

function stubFetch({ sessionOk = true, omdb }) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).includes("/auth/v1/user")) return { ok: sessionOk };
    return { ok: true, json: async () => omdb };
  }));
}

const req = (imdbId = "tt1014763", auth = "Bearer t") => ({ method: "GET", headers: { authorization: auth }, query: { imdbId } });

beforeEach(() => vi.unstubAllGlobals());

describe("/api/ratings", () => {
  it("returns numeric rating, votes (commas stripped) and Metascore", async () => {
    stubFetch({ omdb: { Response: "True", imdbRating: "6.4", imdbVotes: "80,390", Metascore: "41" } });
    const res = mockRes();
    await load()(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ found: true, imdbRating: 6.4, imdbVotes: 80390, metascore: 41 });
  });

  it("turns N/A into null rather than NaN", async () => {
    stubFetch({ omdb: { Response: "True", imdbRating: "N/A", imdbVotes: "N/A", Metascore: "N/A" } });
    const res = mockRes();
    await load()(req(), res);
    expect(res.body).toEqual({ found: true, imdbRating: null, imdbVotes: null, metascore: null });
  });

  it("reports found:false when OMDb has no record", async () => {
    stubFetch({ omdb: { Response: "False", Error: "Error getting data." } });
    const res = mockRes();
    await load()(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ found: false });
  });

  it("maps OMDb's request limit to 429", async () => {
    stubFetch({ omdb: { Response: "False", Error: "Request limit reached!" } });
    const res = mockRes();
    await load()(req(), res);
    expect(res.statusCode).toBe(429);
  });

  it("requires a signed-in session", async () => {
    stubFetch({ sessionOk: false, omdb: {} });
    const res = mockRes();
    await load()(req(), res);
    expect(res.statusCode).toBe(401);
  });

  it("rejects a malformed imdbId without calling OMDb", async () => {
    stubFetch({ omdb: {} });
    const res = mockRes();
    await load()(req("not-an-id"), res);
    expect(res.statusCode).toBe(400);
    const omdbCalls = fetch.mock.calls.filter(([u]) => String(u).includes("omdbapi"));
    expect(omdbCalls).toEqual([]);
  });
});

describe("OMDb entity decoding (api/_omdb.js)", () => {
  it("decodes the entities OMDb emits and leaves plain text alone", () => {
    const { decodeEntities } = require("../api/_omdb.js");
    expect(decodeEntities("Dan O&apos;Bannon")).toBe("Dan O'Bannon");
    expect(decodeEntities("Q&amp;A &quot;x&quot;")).toBe('Q&A "x"');
    expect(decodeEntities("&amp;apos;")).toBe("&apos;");
    expect(decodeEntities("Plain")).toBe("Plain");
    expect(decodeEntities(null)).toBe(null);
  });
});
