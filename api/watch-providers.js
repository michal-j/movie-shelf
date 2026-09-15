// Vercel serverless function: TMDB watch/providers proxy, scoped to Poland.
// TMDB's watch-provider data comes from a partnership with JustWatch and is
// free to use with the same key as movie-lookup.js — but the API only
// returns one link per country (to TMDB's own watch page), never a
// per-provider deep link, so every provider on a title shares that one URL.
//
// GET /api/watch-providers?tmdbId=603

const SUPABASE_URL = "https://ybfxyrzkdexjjptuzzuy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qI5PQ_DO9esWd9FPAFEbtQ_bcJkmUIN";

const TMDB_API_KEY = process.env.TMDB_API_KEY;

async function requireSession(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  return res.ok;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!TMDB_API_KEY) {
    res.status(500).json({ error: "Server is missing TMDB_API_KEY" });
    return;
  }
  if (!(await requireSession(req))) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const tmdbId = (req.query.tmdbId || "").trim();
  if (!tmdbId) {
    res.status(400).json({ error: "Pass tmdbId" });
    return;
  }

  try {
    const url = new URL(`https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers`);
    url.searchParams.set("api_key", TMDB_API_KEY);
    const tmdbRes = await fetch(url);
    if (!tmdbRes.ok) throw new Error(`TMDB watch/providers failed: ${tmdbRes.status}`);
    const data = await tmdbRes.json();

    const pl = data.results?.PL;
    if (!pl) {
      res.status(200).json({ providers: [], link: null });
      return;
    }

    const byId = new Map();
    for (const bucket of [pl.flatrate, pl.rent, pl.buy]) {
      for (const p of bucket || []) {
        if (!byId.has(p.provider_id)) {
          byId.set(p.provider_id, { id: p.provider_id, name: p.provider_name, logoPath: p.logo_path });
        }
      }
    }

    res.status(200).json({ providers: [...byId.values()], link: pl.link || null });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Lookup failed", detail: String(err.message || err) });
  }
};
