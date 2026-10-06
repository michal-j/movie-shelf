// Vercel serverless function: live title search against TMDB only (cheap,
// no meaningful quota) so the Add-movie UI can show a picker as the user
// types, instead of guessing the first match. OMDb is only ever called once
// the user picks a specific result (see api/movie-lookup.js), to keep that
// tighter free-tier quota (1000/day) safe from being burned by every
// keystroke or every wrong guess.
//
// Searches movies AND TV shows together (TMDB's /search/multi, which ranks
// both by relevance in one list) — TV shows are first-class titles in this
// app, not a lesser category, so the picker must surface them too. Each
// result carries its mediaType, because TMDB movie and TV ids are separate
// namespaces: /api/movie-lookup needs it to fetch the right record.
//
// GET /api/movie-search?title=star+wars

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

  const title = (req.query.title || "").trim();
  if (!title) {
    res.status(400).json({ error: "Pass title" });
    return;
  }

  try {
    const url = new URL("https://api.themoviedb.org/3/search/multi");
    url.searchParams.set("api_key", TMDB_API_KEY);
    url.searchParams.set("query", title);
    const tmdbRes = await fetch(url);
    if (!tmdbRes.ok) throw new Error(`TMDB search failed: ${tmdbRes.status}`);
    const data = await tmdbRes.json();

    // /search/multi also returns people — drop those. 8 rather than the old
    // movie-only 5, since movies and TV shows now compete for the slots.
    const results = (data.results || [])
      .filter((m) => m.media_type === "movie" || m.media_type === "tv")
      .slice(0, 8)
      .map((m) => {
        const date = m.media_type === "tv" ? m.first_air_date : m.release_date;
        return {
          tmdbId: m.id,
          mediaType: m.media_type,
          title: m.media_type === "tv" ? m.name : m.title,
          year: date ? Number(date.slice(0, 4)) : null,
          posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
        };
      });

    res.status(200).json({ results });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Search failed", detail: String(err.message || err) });
  }
};
