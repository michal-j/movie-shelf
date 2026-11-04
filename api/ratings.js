// Vercel serverless function: current IMDb rating, vote count and Metascore
// for one title, straight from OMDb. Used by the app's background ratings
// refresh (refreshStaleRatings in app.js) — one OMDb call per request, so
// it's far cheaper than /api/movie-lookup, which also hits TMDB.
//
// GET /api/ratings?imdbId=tt1014763
//   200 { found: true,  imdbRating: 6.4|null, imdbVotes: 80390|null, metascore: 41|null }
//   200 { found: false }   OMDb has no record for that id (don't retry it every load)
//   429                    OMDb's daily limit is exhausted (caller should stop)
//   502                    anything transient (caller should retry on a later load)
//
// A null field means "OMDb has no value" — callers must never overwrite a
// stored value with null.
//
// Same session gate as the other functions so anonymous traffic can't burn
// the shared free-tier OMDb quota (1000/day).

const SUPABASE_URL = "https://ybfxyrzkdexjjptuzzuy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qI5PQ_DO9esWd9FPAFEbtQ_bcJkmUIN";

const OMDB_API_KEY = process.env.OMDB_API_KEY;

async function requireSession(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  return res.ok;
}

function numberOrNull(s, { stripCommas = false } = {}) {
  if (!s || s === "N/A") return null;
  const n = Number(stripCommas ? String(s).replace(/,/g, "") : s);
  return Number.isFinite(n) ? n : null;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!OMDB_API_KEY) {
    res.status(500).json({ error: "Server is missing OMDB_API_KEY" });
    return;
  }
  if (!(await requireSession(req))) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const imdbId = (req.query.imdbId || "").trim();
  if (!/^tt\d{5,}$/.test(imdbId)) {
    res.status(400).json({ error: "Pass a valid imdbId (tt…)" });
    return;
  }

  try {
    const url = new URL("https://www.omdbapi.com/");
    url.searchParams.set("apikey", OMDB_API_KEY);
    url.searchParams.set("i", imdbId);
    const omdbRes = await fetch(url);
    if (!omdbRes.ok) throw new Error(`OMDb request failed: ${omdbRes.status}`);
    const data = await omdbRes.json();

    if (data.Response !== "True") {
      if (/limit/i.test(data.Error || "")) {
        res.status(429).json({ error: "OMDb daily limit reached" });
        return;
      }
      // "Incorrect IMDb ID." / "Error getting data." — OMDb has no record.
      res.status(200).json({ found: false });
      return;
    }

    res.status(200).json({
      found: true,
      imdbRating: numberOrNull(data.imdbRating),
      imdbVotes: numberOrNull(data.imdbVotes, { stripCommas: true }),
      metascore: numberOrNull(data.Metascore),
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Lookup failed", detail: String(err.message || err) });
  }
};
