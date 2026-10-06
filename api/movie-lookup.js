// Vercel serverless function: proxies TMDB + OMDb so their API keys never
// reach client-side JS. Requires a signed-in Supabase session (checked
// against Supabase's own /auth/v1/user endpoint) so the shared free-tier
// OMDb quota (1000/day) isn't burned by random traffic to this URL.
//
// GET /api/movie-lookup?imdbId=tt0050083
// GET /api/movie-lookup?title=12+Angry+Men&year=1957
// GET /api/movie-lookup?tmdbId=389 (used when the caller already resolved
// an exact match via /api/movie-search and just needs the full record)
// GET /api/movie-lookup?tmdbId=13579&mediaType=tv — TMDB movie and TV ids
// are separate namespaces, so a tmdbId is only meaningful with its
// mediaType ("movie" if omitted, for backwards compatibility).
//
// TV shows are resolved exactly like movies: an imdbId checks TMDB's
// tv_results when movie_results is empty, a bare title falls back to
// /search/tv, and the response carries mediaType so the caller stores it.
//
// Returns a camelCase object matching the shape app.js already works with
// (same keys as SELECT_COLUMNS in app.js), covering everything the app
// tracks except copies/format/edition/aspectRatio/audio+subtitleLanguages,
// which stay manual per physical copy.

const SUPABASE_URL = "https://ybfxyrzkdexjjptuzzuy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qI5PQ_DO9esWd9FPAFEbtQ_bcJkmUIN";

const TMDB_API_KEY = process.env.TMDB_API_KEY;
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

function parseRuntime(s) {
  if (!s || s === "N/A") return null;
  const m = /(\d+)/.exec(s);
  return m ? Number(m[1]) : null;
}

function splitCredit(s) {
  if (!s || s === "N/A") return [];
  return s
    .split(",")
    .map((p) => p.replace(/\s*\([^)]*\)\s*$/, "").trim())
    .filter(Boolean);
}

async function tmdbFetch(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${path} failed: ${res.status}`);
  return res.json();
}

async function omdbFetch(params) {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", OMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OMDb request failed: ${res.status}`);
  return res.json();
}

// Returns { tmdbId, mediaType } or null.
async function resolveTmdbId(imdbId, title, year, tmdbIdParam, mediaTypeParam) {
  if (tmdbIdParam) return { tmdbId: Number(tmdbIdParam), mediaType: mediaTypeParam || "movie" };
  if (imdbId) {
    const found = await tmdbFetch(`/find/${imdbId}`, { external_source: "imdb_id" });
    if (found.movie_results?.[0]) return { tmdbId: found.movie_results[0].id, mediaType: "movie" };
    if (found.tv_results?.[0]) return { tmdbId: found.tv_results[0].id, mediaType: "tv" };
    return null;
  }
  const movieSearch = await tmdbFetch("/search/movie", { query: title, ...(year ? { year } : {}) });
  if (movieSearch.results?.[0]) return { tmdbId: movieSearch.results[0].id, mediaType: "movie" };
  const tvSearch = await tmdbFetch("/search/tv", { query: title, ...(year ? { first_air_date_year: year } : {}) });
  if (tvSearch.results?.[0]) return { tmdbId: tvSearch.results[0].id, mediaType: "tv" };
  return null;
}

// Normalizes the TMDB fields that differ between /movie/{id} and /tv/{id}.
function tmdbFields(details, mediaType) {
  if (mediaType === "tv") {
    return {
      title: details.name,
      originalTitle: details.original_name || details.name,
      date: details.first_air_date,
      runtime: details.episode_run_time?.[0] || null,
      countries: (details.production_countries || []).map((c) => c.name),
      // A series has creators rather than a director — stored in the same
      // `director` field, which the drawer labels "Creator" for TV rows.
      creators: (details.created_by || []).map((c) => c.name),
    };
  }
  return {
    title: details.title,
    originalTitle: details.original_title || details.title,
    date: details.release_date,
    runtime: details.runtime || null,
    countries: (details.production_countries || []).map((c) => c.name),
    creators: [],
  };
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!TMDB_API_KEY || !OMDB_API_KEY) {
    res.status(500).json({ error: "Server is missing TMDB_API_KEY / OMDB_API_KEY" });
    return;
  }
  if (!(await requireSession(req))) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const imdbIdParam = (req.query.imdbId || "").trim() || null;
  const titleParam = (req.query.title || "").trim() || null;
  const yearParam = (req.query.year || "").trim() || null;
  const tmdbIdParam = (req.query.tmdbId || "").trim() || null;
  const mediaTypeParam = (req.query.mediaType || "").trim() || null;

  if (!imdbIdParam && !titleParam && !tmdbIdParam) {
    res.status(400).json({ error: "Pass imdbId, tmdbId, or title" });
    return;
  }
  if (mediaTypeParam && mediaTypeParam !== "movie" && mediaTypeParam !== "tv") {
    res.status(400).json({ error: "mediaType must be movie or tv" });
    return;
  }

  try {
    const resolved = await resolveTmdbId(imdbIdParam, titleParam, yearParam, tmdbIdParam, mediaTypeParam);
    if (!resolved) {
      res.status(404).json({ error: "No match found on TMDB" });
      return;
    }
    const { tmdbId, mediaType } = resolved;

    const details = await tmdbFetch(`/${mediaType}/${tmdbId}`, { append_to_response: "credits,external_ids" });
    const tmdb = tmdbFields(details, mediaType);
    const imdbId = imdbIdParam || details.external_ids?.imdb_id || null;

    let omdb = null;
    if (imdbId) {
      const data = await omdbFetch({ i: imdbId, plot: "full" });
      if (data.Response === "True") omdb = data;
    }

    const cast = (details.credits?.cast || []).slice(0, 10).map((c) => ({
      name: c.name,
      role: c.character || "",
    }));

    const omdbDirector = splitCredit(omdb?.Director);

    const result = {
      mediaType,
      title: omdb?.Title || tmdb.title,
      originalTitle: tmdb.originalTitle,
      originalLanguage: details.original_language || null,
      // parseInt, not Number: OMDb gives series a year range ("2001–2002"),
      // and the start year is the one that matters.
      year: parseInt(omdb?.Year, 10) || (tmdb.date ? Number(tmdb.date.slice(0, 4)) : null),
      imdbRating: omdb?.imdbRating && omdb.imdbRating !== "N/A" ? Number(omdb.imdbRating) : null,
      imdbVotes: omdb?.imdbVotes && omdb.imdbVotes !== "N/A" ? Number(omdb.imdbVotes.replace(/,/g, "")) : null,
      metascore: omdb?.Metascore && omdb.Metascore !== "N/A" ? Number(omdb.Metascore) : null,
      runtimeMinutes: parseRuntime(omdb?.Runtime) || tmdb.runtime,
      genres: omdb?.Genre && omdb.Genre !== "N/A" ? splitCredit(omdb.Genre) : (details.genres || []).map((g) => g.name),
      countries: omdb?.Country && omdb.Country !== "N/A" ? splitCredit(omdb.Country) : tmdb.countries,
      director: omdbDirector.length ? omdbDirector : tmdb.creators,
      writers: splitCredit(omdb?.Writer) || [],
      cast,
      studios: (details.production_companies || []).map((c) => c.name),
      description: omdb?.Plot && omdb.Plot !== "N/A" ? omdb.Plot : details.overview || null,
      posterUrl: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null,
      backdropUrl: details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : null,
      tmdbId,
      imdbId,
      imdbLink: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null,
    };

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Lookup failed", detail: String(err.message || err) });
  }
};
