(() => {
  "use strict";

  // Shared by both the real (Supabase-backed) app and the public demo.
  // demo.html sets window.MOVIE_SHELF_DEMO = true before this script loads,
  // and never loads supabaseClient.js / the Supabase SDK at all — so every
  // Supabase call in this file must be behind a `!DEMO_MODE` branch.
  const DEMO_MODE = !!window.MOVIE_SHELF_DEMO;

  // On touch devices (no real :hover), WebKit's "first tap simulates
  // hover, second tap fires the click" behavior is inconsistent in
  // practice — it depends on exactly what's under the finger, and could
  // fire the card's click immediately, or fire it and then a delayed
  // synthetic one that raced with the modal's own open/close state. Cards
  // now implement the tap-to-preview/tap-again-to-open pattern explicitly
  // (see bindCardOpen) instead of relying on that native quirk, so it's
  // the same deliberate two-tap behavior everywhere, regardless of
  // per-card content.
  const TOUCH_DEVICE = typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;

  const STORAGE_KEYS = {
    viewMode: "movieShelf.viewMode",
    listColumns: "movieShelf.listColumns",
    gridCols: "movieShelf.gridCols",
    demoMovies: "movieShelf.demoMovies",
    demoWatchlist: "movieShelf.demoWatchlist",
    activeView: "movieShelf.activeView",
  };

  // Movie rows live in Supabase with snake_case columns; the rest of this file
  // works with the same camelCase shape the old static JSON used, so the
  // select aliases columns back to camelCase and writes go through this map.
  const SELECT_COLUMNS = [
    "id", "imdbId:imdb_id", "imdbLink:imdb_link", "tmdbId:tmdb_id", "title",
    "originalTitle:original_title", "originalLanguage:original_language", "year",
    "imdbRating:imdb_rating", "imdbVotes:imdb_votes", "metascore", "runtimeMinutes:runtime_minutes",
    "genres", "countries", "director", "writers", "cast:cast_members", "studios",
    "format", "edition", "aspectRatio:aspect_ratio", "audioLanguages:audio_languages",
    "subtitleLanguages:subtitle_languages", "hasExtras:has_extras", "description",
    "posterUrl:poster_url", "backdropUrl:backdrop_url", "dateAdded:date_added",
    "collectionNumber:collection_number", "copies", "watched",
  ].join(", ");

  const CAMEL_TO_DB_COLUMN = {
    id: "id", imdbId: "imdb_id", imdbLink: "imdb_link", tmdbId: "tmdb_id", title: "title",
    originalTitle: "original_title", originalLanguage: "original_language", year: "year",
    imdbRating: "imdb_rating", imdbVotes: "imdb_votes", metascore: "metascore",
    runtimeMinutes: "runtime_minutes", genres: "genres", countries: "countries",
    director: "director", writers: "writers", cast: "cast_members", studios: "studios",
    format: "format", edition: "edition", aspectRatio: "aspect_ratio",
    audioLanguages: "audio_languages", subtitleLanguages: "subtitle_languages",
    hasExtras: "has_extras", description: "description", posterUrl: "poster_url",
    backdropUrl: "backdrop_url", dateAdded: "date_added", collectionNumber: "collection_number",
    copies: "copies", watched: "watched",
  };

  function toDbColumns(movieLikeObject) {
    const out = {};
    for (const [key, value] of Object.entries(movieLikeObject)) {
      const column = CAMEL_TO_DB_COLUMN[key];
      if (column) out[column] = value;
    }
    return out;
  }

  // Watchlist rows share most of movies' shape but have no copies/format/watched,
  // plus cached TMDB/JustWatch streaming-availability columns of their own.
  const SELECT_COLUMNS_WATCHLIST = [
    "id", "imdbId:imdb_id", "imdbLink:imdb_link", "tmdbId:tmdb_id", "mediaType:media_type", "title",
    "originalTitle:original_title", "originalLanguage:original_language", "year",
    "imdbRating:imdb_rating", "imdbVotes:imdb_votes", "metascore", "runtimeMinutes:runtime_minutes",
    "genres", "countries", "director", "writers", "cast:cast_members", "studios",
    "description", "posterUrl:poster_url", "backdropUrl:backdrop_url",
    "streamingProviders:streaming_pl", "streamingLink:streaming_link",
    "streamingFetchedAt:streaming_fetched_at", "dateAdded:date_added",
  ].join(", ");

  const CAMEL_TO_DB_COLUMN_WATCHLIST = {
    id: "id", imdbId: "imdb_id", imdbLink: "imdb_link", tmdbId: "tmdb_id", mediaType: "media_type", title: "title",
    originalTitle: "original_title", originalLanguage: "original_language", year: "year",
    imdbRating: "imdb_rating", imdbVotes: "imdb_votes", metascore: "metascore",
    runtimeMinutes: "runtime_minutes", genres: "genres", countries: "countries",
    director: "director", writers: "writers", cast: "cast_members", studios: "studios",
    description: "description", posterUrl: "poster_url", backdropUrl: "backdrop_url",
    streamingProviders: "streaming_pl", streamingLink: "streaming_link",
    streamingFetchedAt: "streaming_fetched_at", dateAdded: "date_added",
  };

  function toDbColumnsWatchlist(itemLikeObject) {
    const out = {};
    for (const [key, value] of Object.entries(itemLikeObject)) {
      const column = CAMEL_TO_DB_COLUMN_WATCHLIST[key];
      if (column) out[column] = value;
    }
    return out;
  }

  const GRID_COLS_MIN = 4;
  const GRID_COLS_MAX = 8;
  const GRID_COLS_DEFAULT = 6;
  // Below this poster width, card text (title/meta) and the hover overlay
  // stop reading comfortably — used to cap how many columns the "Per row"
  // slider will actually offer at the current viewport width, instead of
  // always allowing up to GRID_COLS_MAX regardless of how little room
  // there is (which used to force posters far smaller than this).
  const GRID_COLS_MIN_POSTER_PX = 150;
  const GRID_GAP_PX = 18;

  // Locked columns always appear first, in this order, and can't be hidden.
  const LOCKED_LIST_COLUMNS = [
    { key: "watched", width: 26 },
    { key: "poster", width: 44 },
    { key: "title", label: "Title", width: 260, minWidth: 140, resizable: true },
  ];

  // Optional columns: user can show/hide and resize them.
  const LIST_COLUMNS = [
    { key: "originalTitle", label: "Original Title", width: 200, minWidth: 90, defaultVisible: true },
    { key: "genres", label: "Genre", width: 160, minWidth: 70, defaultVisible: true },
    { key: "year", label: "Year", width: 70, minWidth: 50, defaultVisible: true },
    { key: "runtime", label: "Runtime", width: 80, minWidth: 55, defaultVisible: true },
    { key: "rating", label: "IMDb Rating", width: 90, minWidth: 60, defaultVisible: true },
    { key: "metascore", label: "Metascore", width: 90, minWidth: 60, defaultVisible: false },
    { key: "format", label: "Format", width: 90, minWidth: 60, defaultVisible: false },
    { key: "director", label: "Director", width: 170, minWidth: 90, defaultVisible: false },
  ];

  // Watchlist's locked/optional list columns mirror the collection's, minus
  // Format (meaningless without owned copies) and plus a Streaming column.
  const WATCHLIST_LOCKED_LIST_COLUMNS = [
    { key: "poster", width: 44 },
    { key: "title", label: "Title", width: 260, minWidth: 140, resizable: true },
  ];

  const WATCHLIST_LIST_COLUMNS = [
    { key: "originalTitle", label: "Original Title", width: 200, minWidth: 90, defaultVisible: true },
    { key: "streaming", label: "Streaming", width: 170, minWidth: 100, defaultVisible: true },
    { key: "genres", label: "Genre", width: 160, minWidth: 70, defaultVisible: true },
    { key: "year", label: "Year", width: 70, minWidth: 50, defaultVisible: true },
    { key: "runtime", label: "Runtime", width: 80, minWidth: 55, defaultVisible: true },
    { key: "rating", label: "IMDb Rating", width: 90, minWidth: 60, defaultVisible: true },
    { key: "metascore", label: "Metascore", width: 90, minWidth: 60, defaultVisible: false },
    { key: "director", label: "Director", width: 170, minWidth: 90, defaultVisible: false },
  ];

  // state.listColumns is shared across both tabs, so its defaults need to
  // cover every key either tab's optional columns can use (harmless overlap
  // on shared keys like "year" — same width/visibility either way).
  function defaultListColumns() {
    const optionalByKey = new Map();
    [...LIST_COLUMNS, ...WATCHLIST_LIST_COLUMNS].forEach((c) => {
      if (!optionalByKey.has(c.key)) optionalByKey.set(c.key, c);
    });
    const resizableLocked = [...LOCKED_LIST_COLUMNS, ...WATCHLIST_LOCKED_LIST_COLUMNS].filter((c) => c.resizable);
    return {
      visible: Object.fromEntries([...optionalByKey.values()].map((c) => [c.key, c.defaultVisible])),
      widths: Object.fromEntries([...resizableLocked, ...optionalByKey.values()].map((c) => [c.key, c.width])),
    };
  }

  const state = {
    allMovies: [], // every row from Supabase, source of truth
    movies: [], // filtered+sorted view
    allWatchlist: [], // every row from the watchlist table
    watchlist: [], // filtered+sorted watchlist view
    activeView: localStorage.getItem(STORAGE_KEYS.activeView) || "collection",
    viewMode: localStorage.getItem(STORAGE_KEYS.viewMode) || "grid",
    gridCols: (() => {
      const saved = parseInt(localStorage.getItem(STORAGE_KEYS.gridCols), 10);
      if (Number.isFinite(saved) && saved >= GRID_COLS_MIN && saved <= GRID_COLS_MAX) return saved;
      return GRID_COLS_DEFAULT;
    })(),
    listColumns: (() => {
      const saved = loadJSON(STORAGE_KEYS.listColumns, null);
      const base = defaultListColumns();
      if (!saved) return base;
      return {
        visible: { ...base.visible, ...saved.visible },
        widths: { ...base.widths, ...saved.widths },
      };
    })(),
    search: "",
    sort: "title-asc",
    filters: {
      watched: "all", // all | watched | unwatched
      formats: new Set(),
      decades: new Set(),
      genres: new Set(),
      countries: new Set(),
      multiCopy: false,
    },
    watchlistFilters: {
      decades: new Set(),
      genres: new Set(),
      countries: new Set(),
      streamingAvailable: "all", // all | yes | no
      streamingServices: new Set(),
    },
    editingId: null, // id currently open in edit modal (null = adding new)
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  const el = (id) => document.getElementById(id);
  const grid = el("movie-grid");
  const list = el("movie-list");
  const emptyState = el("empty-state");
  const counterEl = el("movie-counter");
  const filterPanel = el("filter-panel");
  const filterCountBadge = el("filter-count-badge");
  // Watchlist DOM is only present in index.html — these are null in the demo.
  const watchlistGrid = el("watchlist-grid");
  const watchlistList = el("watchlist-list");
  const watchlistEmptyState = el("watchlist-empty-state");

  // ---------- Data loading ----------
  async function init() {
    if (DEMO_MODE) {
      const saved = loadJSON(STORAGE_KEYS.demoMovies, null);
      if (saved) {
        state.allMovies = saved;
      } else {
        const res = await fetch("data/movies-demo.json");
        state.allMovies = await res.json();
      }

      const savedWatchlist = loadJSON(STORAGE_KEYS.demoWatchlist, null);
      if (savedWatchlist) {
        state.allWatchlist = savedWatchlist;
      } else {
        const wlRes = await fetch("data/watchlist-demo.json");
        state.allWatchlist = await wlRes.json();
      }
    } else {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }
      // Session confirmed — safe to reveal the shell index.html hides by
      // default (see its inline <style>), whether the movies fetch below
      // succeeds or not.
      document.body.style.visibility = "visible";

      const { data, error } = await window.supabaseClient
        .from("movies")
        .select(SELECT_COLUMNS)
        .order("title");
      if (error) {
        console.error(error);
        document.body.innerHTML = `<p style="padding:40px;color:#eceef2;font-family:sans-serif;">Failed to load your collection. Please refresh.</p>`;
        return;
      }
      state.allMovies = data;

      const { data: watchlistData, error: watchlistError } = await window.supabaseClient
        .from("watchlist")
        .select(SELECT_COLUMNS_WATCHLIST)
        .order("date_added", { ascending: false });
      if (watchlistError) {
        console.error(watchlistError);
      } else {
        state.allWatchlist = watchlistData;
      }
    }

    buildFilterChips();
    buildWatchlistFilterChips();
    bindEvents();
    applyGridCols();
    setViewMode(state.viewMode, { skipSave: true });
    switchView(state.activeView, { skipSave: true });

    if (!DEMO_MODE) {
      window.supabaseClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "/login";
      });
      refreshStaleStreamingProviders();
    }
  }

  // Demo's only "backend" is localStorage — call after any mutation to
  // state.allMovies so a refresh doesn't lose it. No-op in the real app.
  function saveDemoMovies() {
    if (DEMO_MODE) saveJSON(STORAGE_KEYS.demoMovies, state.allMovies);
  }

  function saveDemoWatchlist() {
    if (DEMO_MODE) saveJSON(STORAGE_KEYS.demoWatchlist, state.allWatchlist);
  }

  function allMovies() {
    return state.allMovies;
  }

  function allWatchlist() {
    return state.allWatchlist;
  }

  function isWatched(id) {
    return !!getMovieById(id)?.watched;
  }

  // ---------- Filter chip construction ----------
  function buildFilterChips() {
    const movies = allMovies();
    const formats = uniqueSorted(movies.map((m) => m.format).filter(Boolean));
    const genres = uniqueSorted(movies.flatMap((m) => m.genres || []));
    const countries = uniqueSorted(movies.flatMap((m) => m.countries || []));
    const decades = uniqueSorted(
      movies
        .filter((m) => m.year)
        .map((m) => Math.floor(m.year / 10) * 10)
    ).sort((a, b) => b - a);

    renderChipGroup("filter-format", formats, state.filters.formats);
    renderChipGroup("filter-genre", genres, state.filters.genres);
    renderChipGroup("filter-country", countries, state.filters.countries);
    renderChipGroup(
      "filter-decade",
      decades.map((d) => `${d}s`),
      state.filters.decades
    );

    if (!filterPanel.hidden) setupCollapsibleChipRow("filter-country", "filter-country-toggle");
  }

  // Decade/Genre/Country chip-row containers are shared with the collection
  // filter panel (same DOM ids, different value sets) — whichever build
  // function ran most recently "owns" their current contents, so switchView()
  // always calls the one matching the tab being switched to.
  function buildWatchlistFilterChips() {
    const items = allWatchlist();
    const genres = uniqueSorted(items.flatMap((m) => m.genres || []));
    const countries = uniqueSorted(items.flatMap((m) => m.countries || []));
    const decades = uniqueSorted(
      items.filter((m) => m.year).map((m) => Math.floor(m.year / 10) * 10)
    ).sort((a, b) => b - a);
    const services = uniqueSorted(items.flatMap((m) => (m.streamingProviders || []).map((p) => p.name)));

    renderChipGroup("filter-genre", genres, state.watchlistFilters.genres);
    renderChipGroup("filter-country", countries, state.watchlistFilters.countries);
    renderChipGroup(
      "filter-decade",
      decades.map((d) => `${d}s`),
      state.watchlistFilters.decades
    );
    renderChipGroup("filter-streaming-service", services, state.watchlistFilters.streamingServices);

    if (!filterPanel.hidden) {
      setupCollapsibleChipRow("filter-country", "filter-country-toggle");
      setupCollapsibleChipRow("filter-streaming-service", "filter-streaming-service-toggle");
    }
  }

  // Toggles which filter-panel groups are visible for the active tab. Groups
  // with no data-view attribute (Decade/Genre/Country) are shared by both.
  function applyFilterPanelView(view) {
    document.querySelectorAll(".filter-group").forEach((group) => {
      const groupView = group.dataset.view;
      group.hidden = !!groupView && groupView !== view;
    });
  }

  function setupCollapsibleChipRow(rowId, toggleId) {
    const row = el(rowId);
    const toggle = el(toggleId);
    // Let layout settle, then check whether the full chip list actually
    // overflows the collapsed height before deciding to show the toggle.
    requestAnimationFrame(() => {
      const needsToggle = row.scrollHeight > row.clientHeight + 1;
      toggle.hidden = !needsToggle;
      toggle.textContent = "Show all";
      row.classList.remove("expanded");
    });
    toggle.onclick = () => {
      const expanded = row.classList.toggle("expanded");
      toggle.textContent = expanded ? "Show less" : "Show all";
    };
  }

  function uniqueSorted(arr) {
    return [...new Set(arr)].sort();
  }

  function renderChipGroup(containerId, values, activeSet) {
    const container = el(containerId);
    container.innerHTML = "";
    values.forEach((value) => {
      const btn = document.createElement("button");
      btn.className = "chip" + (activeSet.has(value) ? " active" : "");
      btn.type = "button";
      btn.dataset.value = value;
      btn.textContent = value;
      btn.addEventListener("click", () => {
        if (activeSet.has(value)) activeSet.delete(value);
        else activeSet.add(value);
        btn.classList.toggle("active");
        render();
      });
      container.appendChild(btn);
    });
  }

  // ---------- Filtering / sorting ----------
  // Leading articles to ignore when alphabetizing titles, across the languages
  // that actually show up in this collection.
  const SORT_ARTICLES = new Set([
    "the", "a", "an", // English
    "der", "die", "das", "dem", "den", "des", "ein", "eine", "einen", "einem", "einer", // German
    "le", "la", "les", "un", "une", "des", // French
    "el", "los", "las", "un", "una", "unos", "unas", // Spanish
    "il", "lo", "gli", "i", "un", "uno", "una", // Italian
    "o", "os", "as", "um", "uma", "uns", "umas", // Portuguese
    "de", "het", "een", // Dutch
  ]);

  function titleSortKey(title) {
    let t = (title || "").trim();
    // French/Italian elision: L'Auberge, D'Artagnan (no space before the word)
    const elision = t.match(/^[A-Za-z]['’]/);
    if (elision) {
      t = t.slice(elision[0].length);
    } else {
      const spaceIdx = t.indexOf(" ");
      if (spaceIdx > 0) {
        const firstWord = t.slice(0, spaceIdx).toLowerCase().replace(/[^a-zà-ÿ]/gi, "");
        if (SORT_ARTICLES.has(firstWord)) {
          t = t.slice(spaceIdx + 1);
        }
      }
    }
    return t.toLowerCase();
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Matches the query as the start of a word, not anywhere inside one —
  // "ace" finds "Ace Ventura" but not "Spacey" or "Wallace".
  function wordPrefixRegex(query) {
    return new RegExp("\\b" + escapeRegex(query), "i");
  }

  function getFilteredSorted() {
    let list = allMovies();

    if (state.search.trim()) {
      const searchRe = wordPrefixRegex(state.search.trim());
      list = list.filter((m) => {
        const haystacks = [
          m.title,
          m.originalTitle,
          ...(m.director || []),
          ...(m.cast || []).map((c) => c.name),
          ...(m.genres || []),
        ];
        return haystacks.some((h) => h && searchRe.test(h));
      });
    }

    if (state.filters.watched === "watched") list = list.filter((m) => isWatched(m.id));
    else if (state.filters.watched === "unwatched") list = list.filter((m) => !isWatched(m.id));

    if (state.filters.formats.size) {
      list = list.filter((m) => state.filters.formats.has(m.format));
    }
    if (state.filters.multiCopy) {
      list = list.filter((m) => (m.copies || []).length > 1);
    }
    if (state.filters.genres.size) {
      list = list.filter((m) => (m.genres || []).some((g) => state.filters.genres.has(g)));
    }
    if (state.filters.countries.size) {
      list = list.filter((m) => (m.countries || []).some((c) => state.filters.countries.has(c)));
    }
    if (state.filters.decades.size) {
      list = list.filter((m) => {
        if (!m.year) return false;
        const decade = `${Math.floor(m.year / 10) * 10}s`;
        return state.filters.decades.has(decade);
      });
    }

    return sortMovies(list, state.sort);
  }

  function sortMovies(list, sortValue) {
    const [key, dir] = sortValue.split("-");
    const mul = dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      let av, bv;
      switch (key) {
        case "title":
          av = titleSortKey(a.title);
          bv = titleSortKey(b.title);
          break;
        case "year":
          av = a.year || 0;
          bv = b.year || 0;
          break;
        case "rating":
          av = a.imdbRating ?? -1;
          bv = b.imdbRating ?? -1;
          break;
        case "metascore":
          av = a.metascore ?? -1;
          bv = b.metascore ?? -1;
          break;
        case "runtime":
          av = a.runtimeMinutes || 0;
          bv = b.runtimeMinutes || 0;
          break;
        case "added":
          av = new Date(a.dateAdded || 0).getTime() || 0;
          bv = new Date(b.dateAdded || 0).getTime() || 0;
          break;
        default:
          av = 0; bv = 0;
      }
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return titleSortKey(a.title).localeCompare(titleSortKey(b.title));
    });
  }

  function getWatchlistFilteredSorted() {
    let list = allWatchlist();

    if (state.search.trim()) {
      const searchRe = wordPrefixRegex(state.search.trim());
      list = list.filter((m) => {
        const haystacks = [
          m.title,
          m.originalTitle,
          ...(m.director || []),
          ...(m.cast || []).map((c) => c.name),
          ...(m.genres || []),
        ];
        return haystacks.some((h) => h && searchRe.test(h));
      });
    }

    if (state.watchlistFilters.genres.size) {
      list = list.filter((m) => (m.genres || []).some((g) => state.watchlistFilters.genres.has(g)));
    }
    if (state.watchlistFilters.countries.size) {
      list = list.filter((m) => (m.countries || []).some((c) => state.watchlistFilters.countries.has(c)));
    }
    if (state.watchlistFilters.decades.size) {
      list = list.filter((m) => {
        if (!m.year) return false;
        const decade = `${Math.floor(m.year / 10) * 10}s`;
        return state.watchlistFilters.decades.has(decade);
      });
    }
    if (state.watchlistFilters.streamingAvailable !== "all") {
      const wantAvailable = state.watchlistFilters.streamingAvailable === "yes";
      list = list.filter((m) => ((m.streamingProviders || []).length > 0) === wantAvailable);
    }
    if (state.watchlistFilters.streamingServices.size) {
      list = list.filter((m) =>
        (m.streamingProviders || []).some((p) => state.watchlistFilters.streamingServices.has(p.name))
      );
    }

    return sortMovies(list, state.sort);
  }

  // ---------- Rendering ----------
  function render() {
    if (state.activeView === "watchlist") renderWatchlistView();
    else renderCollectionView();
  }

  function renderCollectionView() {
    const filtered = getFilteredSorted();
    state.movies = filtered;

    counterEl.textContent = `${filtered.length} movie${filtered.length === 1 ? "" : "s"}`;
    updateFilterBadge();

    emptyState.hidden = filtered.length !== 0;
    grid.hidden = state.viewMode !== "grid" || filtered.length === 0;
    list.hidden = state.viewMode !== "list" || filtered.length === 0;

    if (state.viewMode === "grid") renderGrid(filtered);
    else renderList(filtered);
  }

  function renderWatchlistView() {
    const filtered = getWatchlistFilteredSorted();
    state.watchlist = filtered;

    counterEl.textContent = `${filtered.length} movie${filtered.length === 1 ? "" : "s"}`;
    updateWatchlistFilterBadge();

    const noneAtAll = state.allWatchlist.length === 0;
    watchlistEmptyState.hidden = filtered.length !== 0;
    watchlistEmptyState.querySelector("p").textContent = noneAtAll
      ? "Your watchlist is empty."
      : "No watchlist movies match your filters.";
    el("watchlist-empty-clear-btn").hidden = noneAtAll;
    watchlistGrid.hidden = state.viewMode !== "grid" || filtered.length === 0;
    watchlistList.hidden = state.viewMode !== "list" || filtered.length === 0;

    if (state.viewMode === "grid") renderWatchlistGrid(filtered);
    else renderWatchlistList(filtered);
  }

  function updateFilterBadge() {
    const count =
      (state.filters.watched !== "all" ? 1 : 0) +
      state.filters.formats.size +
      state.filters.genres.size +
      state.filters.countries.size +
      state.filters.decades.size +
      (state.filters.multiCopy ? 1 : 0);
    filterCountBadge.hidden = count === 0;
    filterCountBadge.textContent = count;
  }

  function updateWatchlistFilterBadge() {
    const f = state.watchlistFilters;
    const count =
      (f.streamingAvailable !== "all" ? 1 : 0) + f.genres.size + f.countries.size + f.decades.size + f.streamingServices.size;
    filterCountBadge.hidden = count === 0;
    filterCountBadge.textContent = count;
  }

  function posterNode(movie, className) {
    if (movie.posterUrl) {
      const img = document.createElement("img");
      img.className = className;
      img.loading = "lazy";
      img.src = movie.posterUrl;
      img.alt = `${movie.title} poster`;
      img.onerror = () => img.replaceWith(fallbackPoster(movie, className));
      return img;
    }
    return fallbackPoster(movie, className);
  }

  function fallbackPoster(movie, className) {
    const div = document.createElement("div");
    div.className = `${className === "poster" ? "poster-fallback" : "poster-fallback"}`;
    div.style.background = gradientFor(movie.title || "?");
    div.textContent = movie.title || "Untitled";
    return div;
  }

  function metascoreClass(score) {
    if (score >= 61) return "good";
    if (score >= 40) return "mixed";
    return "bad";
  }

  function gradientFor(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 45) % 360;
    return `linear-gradient(150deg, hsl(${h1} 45% 22%), hsl(${h2} 55% 14%))`;
  }

  // Every provider on a title shares the same TMDB/JustWatch link (TMDB's API
  // has no per-provider deep link), so each icon/pill just opens that one URL.
  function streamingProvidersHtml(movie, opts = {}) {
    const providers = movie.streamingProviders || [];
    if (!providers.length) {
      return `<span class="streaming-empty">No streaming options available</span>`;
    }
    const link = movie.streamingLink || "#";
    if (opts.variant === "link") {
      return providers
        .map(
          (p) => `
        <a class="streaming-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">
          ${p.logoPath ? `<img src="https://image.tmdb.org/t/p/w92${escapeHtml(p.logoPath)}" alt="">` : ""}
          <span>${escapeHtml(p.name)}</span>
        </a>`
        )
        .join("");
    }
    const iconClass = opts.variant === "row" ? "row-streaming-icon" : "streaming-icon";
    return providers
      .map(
        (p) => `
      <a class="${iconClass}" href="${escapeHtml(link)}" target="_blank" rel="noopener" title="${escapeHtml(p.name)}">
        ${p.logoPath ? `<img src="https://image.tmdb.org/t/p/w92${escapeHtml(p.logoPath)}" alt="${escapeHtml(p.name)}">` : ""}
      </a>`
      )
      .join("");
  }

  // On touch, the first tap reveals the card's hover overlay (title/meta/
  // scores) instead of opening the detail drawer immediately; a second tap
  // on the same (now-previewing) card opens it. Tapping a different card
  // just moves the preview there. Mouse/keyboard users are unaffected —
  // real :hover already previews on desktop, so a click always opens.
  let previewCard = null;
  function clearCardPreview() {
    if (previewCard) {
      previewCard.classList.remove("preview-active");
      previewCard = null;
    }
  }
  function bindCardOpen(card, onOpen) {
    card.addEventListener("click", () => {
      if (!TOUCH_DEVICE || card.classList.contains("preview-active")) {
        onOpen();
        return;
      }
      clearCardPreview();
      card.classList.add("preview-active");
      previewCard = card;
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onOpen();
    });
  }

  function renderGrid(movies) {
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    movies.forEach((movie) => {
      const card = document.createElement("article");
      card.className = "movie-card" + (isWatched(movie.id) ? " is-watched" : "");
      card.tabIndex = 0;

      card.appendChild(posterNode(movie, "poster"));

      if (isWatched(movie.id)) {
        const watchedBadge = document.createElement("div");
        watchedBadge.className = "watched-badge";
        watchedBadge.title = "Watched";
        watchedBadge.innerHTML = eyeIconSvg();
        card.appendChild(watchedBadge);
      }

      const overlay = document.createElement("div");
      overlay.className = "card-overlay";
      overlay.innerHTML = `
        ${
          movie.imdbRating != null || movie.metascore != null
            ? `<div class="card-scores">
                ${movie.metascore != null ? `<div class="metascore-pill ${metascoreClass(movie.metascore)}" title="Metascore">${movie.metascore}</div>` : ""}
                ${movie.imdbRating != null ? `<div class="rating-pill">${starIconSvg()}<span>${movie.imdbRating.toFixed(1)}</span></div>` : ""}
              </div>`
            : ""
        }
        <p class="card-title">${escapeHtml(movie.title)}</p>
        <p class="card-meta">
          ${movie.year ? `<span>${movie.year}</span>` : ""}
          ${movie.runtimeMinutes ? `<span>${movie.runtimeMinutes}m</span>` : ""}
          ${
            (movie.copies || []).length > 1
              ? `<span>${movie.copies.length}× copies</span>`
              : movie.format
              ? `<span>${escapeHtml(movie.format)}</span>`
              : ""
          }
          ${(movie.genres || [])[0] ? `<span>${escapeHtml(movie.genres[0])}</span>` : ""}
        </p>
      `;
      card.appendChild(overlay);

      bindCardOpen(card, () => openDetailModal(movie.id));

      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function renderWatchlistGrid(movies) {
    watchlistGrid.innerHTML = "";
    const frag = document.createDocumentFragment();
    movies.forEach((movie) => {
      const hasStreaming = (movie.streamingProviders || []).length > 0;
      const card = document.createElement("article");
      card.className = "movie-card";
      card.tabIndex = 0;

      const poster = posterNode(movie, "poster");
      if (!hasStreaming) poster.classList.add("poster-no-streaming");
      card.appendChild(poster);

      const overlay = document.createElement("div");
      overlay.className = "card-overlay";
      overlay.innerHTML = `
        ${
          movie.imdbRating != null || movie.metascore != null
            ? `<div class="card-scores">
                ${movie.metascore != null ? `<div class="metascore-pill ${metascoreClass(movie.metascore)}" title="Metascore">${movie.metascore}</div>` : ""}
                ${movie.imdbRating != null ? `<div class="rating-pill">${starIconSvg()}<span>${movie.imdbRating.toFixed(1)}</span></div>` : ""}
              </div>`
            : ""
        }
        <p class="card-title">${escapeHtml(movie.title)}</p>
        <p class="card-meta">
          ${movie.year ? `<span>${movie.year}</span>` : ""}
          ${movie.runtimeMinutes ? `<span>${movie.runtimeMinutes}m</span>` : ""}
          ${(movie.genres || [])[0] ? `<span>${escapeHtml(movie.genres[0])}</span>` : ""}
        </p>
        <div class="streaming-row">${streamingProvidersHtml(movie)}</div>
      `;
      card.appendChild(overlay);
      overlay.querySelectorAll(".streaming-icon").forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));

      bindCardOpen(card, () => openDetailModal(movie.id));

      frag.appendChild(card);
    });
    watchlistGrid.appendChild(frag);
  }

  function getVisibleListColumns() {
    return LIST_COLUMNS.filter((c) => state.listColumns.visible[c.key]);
  }

  function applyListGridTemplate() {
    const parts = ["26px", "44px", (state.listColumns.widths.title || 260) + "px"];
    getVisibleListColumns().forEach((c) => {
      parts.push((state.listColumns.widths[c.key] || c.width) + "px");
    });
    list.style.setProperty("--list-template", parts.join(" "));
  }

  function listCellHtml(column, movie) {
    switch (column.key) {
      case "originalTitle":
        return `<div class="row-cell row-original-title">${
          movie.originalTitle && movie.originalTitle !== movie.title ? escapeHtml(movie.originalTitle) : "—"
        }</div>`;
      case "genres":
        return `<div class="row-cell row-genres">${escapeHtml((movie.genres || []).join(", ")) || "—"}</div>`;
      case "year":
        return `<div class="row-cell row-year">${movie.year ?? "—"}</div>`;
      case "runtime":
        return `<div class="row-cell row-runtime">${movie.runtimeMinutes ? movie.runtimeMinutes + "m" : "—"}</div>`;
      case "rating":
        return `<div class="row-cell row-rating">${movie.imdbRating != null ? "★ " + movie.imdbRating.toFixed(1) : "—"}</div>`;
      case "metascore":
        return `<div class="row-cell row-metascore">${
          movie.metascore != null ? `<span class="metascore-pill ${metascoreClass(movie.metascore)}">${movie.metascore}</span>` : "—"
        }</div>`;
      case "format": {
        const copies = movie.copies && movie.copies.length ? movie.copies : movie.format ? [{ format: movie.format }] : [];
        const list = copies.map((c) => c.format || "DVD").join(", ");
        return `<div class="row-cell row-format" title="${escapeHtml(list)}">${escapeHtml(list) || "—"}</div>`;
      }
      case "director":
        return `<div class="row-cell row-director">${escapeHtml((movie.director || []).join(", ")) || "—"}</div>`;
      case "streaming":
        return `<div class="row-cell row-streaming">${streamingProvidersHtml(movie, { variant: "row" })}</div>`;
      default:
        return `<div class="row-cell"></div>`;
    }
  }

  function listHeaderCellHtml(column) {
    return `<div class="list-header-cell" data-key="${column.key}">${escapeHtml(column.label)}<div class="col-resize-handle" data-key="${column.key}"></div></div>`;
  }

  function renderList(movies) {
    applyListGridTemplate();
    const visibleColumns = getVisibleListColumns();

    list.innerHTML = `
      <div class="list-header">
        <span></span><span></span>
        <div class="list-header-cell" data-key="title">Title<div class="col-resize-handle" data-key="title"></div></div>
        ${visibleColumns.map(listHeaderCellHtml).join("")}
      </div>
    `;
    wireColumnResizeHandles();

    const frag = document.createDocumentFragment();
    movies.forEach((movie) => {
      const row = document.createElement("div");
      row.className = "movie-row";
      row.tabIndex = 0;

      const posterWrap = document.createElement("div");
      posterWrap.className = "row-poster";
      posterWrap.appendChild(posterNode(movie, "row-poster-img"));

      row.innerHTML = `
        <div class="row-watched-slot"></div>
        <div class="row-poster-slot"></div>
        <div class="row-cell row-title">${escapeHtml(movie.title)}</div>
        ${visibleColumns.map((c) => listCellHtml(c, movie)).join("")}
      `;
      row.querySelector(".row-poster-slot").replaceWith(posterWrap);

      const watchedSlot = row.querySelector(".row-watched-slot");
      watchedSlot.className = "row-watched-icon";
      if (isWatched(movie.id)) {
        watchedSlot.title = "Watched";
        watchedSlot.innerHTML = eyeIconSvg();
      }

      row.addEventListener("click", () => openDetailModal(movie.id));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") openDetailModal(movie.id);
      });

      frag.appendChild(row);
    });
    list.appendChild(frag);
  }

  function wireColumnResizeHandles() {
    list.querySelectorAll(".col-resize-handle").forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = handle.dataset.key;
        const allDefs = [...LOCKED_LIST_COLUMNS, ...LIST_COLUMNS];
        const def = allDefs.find((c) => c.key === key);
        const startX = e.clientX;
        const startWidth = state.listColumns.widths[key] || def.width;
        handle.classList.add("resizing");

        function onMove(ev) {
          const delta = ev.clientX - startX;
          const newWidth = Math.max(def.minWidth || 40, Math.round(startWidth + delta));
          state.listColumns.widths[key] = newWidth;
          applyListGridTemplate();
        }
        function onUp() {
          handle.classList.remove("resizing");
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          saveJSON(STORAGE_KEYS.listColumns, state.listColumns);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
  }

  // "Format" is meaningless for watchlist items (no owned copies), so it's
  // excluded even if the user enabled it as an optional column on the
  // collection tab — grid-cols/list-column preferences are shared across tabs.
  function getVisibleWatchlistListColumns() {
    return WATCHLIST_LIST_COLUMNS.filter((c) => state.listColumns.visible[c.key]);
  }

  function applyWatchlistListGridTemplate() {
    const parts = ["44px", (state.listColumns.widths.title || 260) + "px"];
    getVisibleWatchlistListColumns().forEach((c) => {
      parts.push((state.listColumns.widths[c.key] || c.width) + "px");
    });
    watchlistList.style.setProperty("--list-template", parts.join(" "));
  }

  function watchlistListHeaderCellHtml(column) {
    return `<div class="list-header-cell" data-key="${column.key}">${escapeHtml(column.label)}<div class="col-resize-handle" data-key="${column.key}"></div></div>`;
  }

  function renderWatchlistList(movies) {
    applyWatchlistListGridTemplate();
    const visibleColumns = getVisibleWatchlistListColumns();

    watchlistList.innerHTML = `
      <div class="list-header">
        <span></span>
        <div class="list-header-cell" data-key="title">Title<div class="col-resize-handle" data-key="title"></div></div>
        ${visibleColumns.map(watchlistListHeaderCellHtml).join("")}
      </div>
    `;
    wireWatchlistColumnResizeHandles();

    const frag = document.createDocumentFragment();
    movies.forEach((movie) => {
      const hasStreaming = (movie.streamingProviders || []).length > 0;
      const row = document.createElement("div");
      row.className = "movie-row";
      row.tabIndex = 0;

      const posterWrap = document.createElement("div");
      posterWrap.className = "row-poster";
      const posterImg = posterNode(movie, "row-poster-img");
      if (!hasStreaming) posterImg.classList.add("poster-no-streaming");
      posterWrap.appendChild(posterImg);

      row.innerHTML = `
        <div class="row-poster-slot"></div>
        <div class="row-cell row-title">${escapeHtml(movie.title)}</div>
        ${visibleColumns.map((c) => listCellHtml(c, movie)).join("")}
      `;
      row.querySelector(".row-poster-slot").replaceWith(posterWrap);

      row.querySelectorAll(".row-streaming-icon").forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));

      row.addEventListener("click", () => openDetailModal(movie.id));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") openDetailModal(movie.id);
      });

      frag.appendChild(row);
    });
    watchlistList.appendChild(frag);
  }

  function wireWatchlistColumnResizeHandles() {
    watchlistList.querySelectorAll(".col-resize-handle").forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = handle.dataset.key;
        const allDefs = [...WATCHLIST_LOCKED_LIST_COLUMNS, ...WATCHLIST_LIST_COLUMNS];
        const def = allDefs.find((c) => c.key === key);
        const startX = e.clientX;
        const startWidth = state.listColumns.widths[key] || def.width;
        handle.classList.add("resizing");

        function onMove(ev) {
          const delta = ev.clientX - startX;
          const newWidth = Math.max(def.minWidth || 40, Math.round(startWidth + delta));
          state.listColumns.widths[key] = newWidth;
          applyWatchlistListGridTemplate();
        }
        function onUp() {
          handle.classList.remove("resizing");
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          saveJSON(STORAGE_KEYS.listColumns, state.listColumns);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
  }

  function buildColumnsMenu(columns) {
    const menu = el("columns-menu");
    menu.innerHTML = columns.map(
      (c) => `
      <label class="columns-menu-item">
        <input type="checkbox" data-key="${c.key}" ${state.listColumns.visible[c.key] ? "checked" : ""} />
        ${escapeHtml(c.label)}
      </label>
    `
    ).join("");
    menu.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        state.listColumns.visible[input.dataset.key] = input.checked;
        saveJSON(STORAGE_KEYS.listColumns, state.listColumns);
        render();
      });
    });
  }

  async function toggleWatched(id) {
    const movie = getMovieById(id);
    if (!movie) return;
    const nextWatched = !movie.watched;
    movie.watched = nextWatched; // optimistic
    render();
    if (detailModalOpenId === id) renderDetailBody(getMovieById(id));

    if (DEMO_MODE) {
      saveDemoMovies();
      return;
    }

    const { error } = await window.supabaseClient.from("movies").update({ watched: nextWatched }).eq("id", id);
    if (error) {
      movie.watched = !nextWatched; // revert
      render();
      if (detailModalOpenId === id) renderDetailBody(getMovieById(id));
      showToast("Failed to update watched status");
    }
  }

  function getMovieById(id) {
    return allMovies().find((m) => m.id === id) || allWatchlist().find((m) => m.id === id);
  }

  // ---------- Detail modal ----------
  let detailModalOpenId = null;
  const detailModal = el("detail-modal");
  const detailBody = el("detail-body");

  function openDetailModal(id) {
    detailModalOpenId = id;
    const movie = getMovieById(id);
    if (!movie) return;
    renderDetailBody(movie);
    detailModal.hidden = false;
    // Double rAF so the browser paints the closed (translated-out) state
    // first, then the "open" class transition actually animates in.
    requestAnimationFrame(() => requestAnimationFrame(() => detailModal.classList.add("open")));
  }

  function closeDetailModal() {
    if (detailModal.hidden) return;
    clearCardPreview();
    detailModal.classList.remove("open");
    const panel = detailModal.querySelector(".detail-modal");
    const finish = () => {
      detailModal.hidden = true;
    };
    if (panel) {
      panel.addEventListener("transitionend", finish, { once: true });
      setTimeout(finish, 350); // fallback in case transitionend doesn't fire
    } else {
      finish();
    }
    detailModalOpenId = null;
  }

  function copyCardHtml(c) {
    const rows = [
      c.edition ? ["Edition", c.edition] : null,
      c.distributor ? ["Distributor", c.distributor] : null,
      c.aspectRatio ? ["Aspect ratio", c.aspectRatio] : null,
      c.audioLanguages && c.audioLanguages.length ? ["Audio", c.audioLanguages.join(", ")] : null,
      c.subtitleLanguages && c.subtitleLanguages.length ? ["Subtitles", c.subtitleLanguages.join(", ")] : null,
      c.extras ? ["Extras", c.extras === "Yes" ? "Yes" : c.extras] : null,
      c.polishLicensedRelease != null ? ["Polish release", c.polishLicensedRelease ? "Yes" : "No (import)"] : null,
      c.notes ? ["Notes", c.notes] : null,
    ].filter(Boolean);

    return `
      <div class="copy-card">
        <div class="copy-card-header">
          <span class="pill">${escapeHtml(c.format || "DVD")}${c.formatDetail && c.formatDetail !== c.format ? ` <span class="copy-format-detail">(${escapeHtml(c.formatDetail)})</span>` : ""}</span>
        </div>
        ${rows.length ? `<dl class="meta-table copy-meta">${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>` : `<p class="copy-empty">No extra details recorded.</p>`}
      </div>
    `;
  }

  function renderDetailBody(movie) {
    // Watchlist rows always carry a streamingProviders array (even if empty);
    // owned-collection rows never have that field, so its presence tells us
    // which kind of item this is without threading a separate flag around.
    const isWatchlistItem = movie.streamingProviders !== undefined;
    const watched = !isWatchlistItem && isWatched(movie.id);
    const backdrop = movie.backdropUrl || movie.posterUrl;
    detailBody.innerHTML = `
      <div class="detail-hero" style="${backdrop ? `background-image:url('${escapeHtml(backdrop)}')` : `background:${gradientFor(movie.title)}`}"></div>
      <div class="detail-main">
        <div class="detail-poster">${movie.posterUrl ? `<img src="${escapeHtml(movie.posterUrl)}" alt="">` : `<div class="poster-fallback" style="height:100%;background:${gradientFor(movie.title)}">${escapeHtml(movie.title)}</div>`}</div>
        <div class="detail-info">
          <h2 class="detail-title">${escapeHtml(movie.title)}</h2>
          ${movie.originalTitle && movie.originalTitle !== movie.title ? `<p class="detail-original">${escapeHtml(movie.originalTitle)}</p>` : ""}
          <div class="detail-subline">
            ${movie.year ? `<span>${movie.year}</span>` : ""}
            ${movie.runtimeMinutes ? `<span>${movie.runtimeMinutes} min</span>` : ""}
            ${!isWatchlistItem && movie.format && (movie.copies || []).length <= 1 ? `<span class="pill">${escapeHtml(movie.format)}</span>` : ""}
            ${!isWatchlistItem && (movie.copies || []).length > 1 ? `<span class="pill">${movie.copies.length} copies owned</span>` : ""}
            ${movie.metascore != null ? `<span class="pill metascore-pill ${metascoreClass(movie.metascore)}">${movie.metascore} Metascore</span>` : ""}
            ${movie.imdbRating != null ? `<span class="pill gold">★ ${movie.imdbRating.toFixed(1)} IMDb</span>` : ""}
          </div>
          <div class="detail-actions">
            ${!isWatchlistItem ? `<button class="btn ${watched ? "btn-watched" : "btn-ghost"}" id="detail-watch-btn" type="button">
              ${eyeIconSvg()} ${watched ? "Watched" : "Mark as watched"}
            </button>` : ""}
            ${movie.imdbLink ? `<a class="btn btn-ghost" href="${escapeHtml(movie.imdbLink)}" target="_blank" rel="noopener">IMDb ↗</a>` : ""}
            <a class="btn btn-ghost" href="https://www.youtube.com/results?search_query=${encodeURIComponent((movie.originalTitle || movie.title) + " " + (movie.year || "") + " trailer")}" target="_blank" rel="noopener">Trailer ↗</a>
            ${!isWatchlistItem
              ? `<button class="btn btn-ghost" id="detail-edit-btn" type="button">${pencilIconSvg()} Edit</button>`
              : `<button class="btn btn-danger" id="detail-remove-watchlist-btn" type="button">Remove from watchlist</button>`}
          </div>

          ${(movie.genres || []).length ? `<div class="detail-section"><h4>Genres</h4><div class="genre-tags">${movie.genres.map((g) => `<span class="genre-tag">${escapeHtml(g)}</span>`).join("")}</div></div>` : ""}

          ${(movie.countries || []).length ? `<div class="detail-section"><h4>Country</h4><p>${escapeHtml(movie.countries.join(", "))}</p></div>` : ""}

          ${movie.description ? `<div class="detail-section"><h4>Overview</h4><p>${escapeHtml(movie.description)}</p></div>` : ""}

          ${isWatchlistItem ? `<div class="detail-section">
            <h4>Where to watch (PL)</h4>
            <div class="streaming-links">${streamingProvidersHtml(movie, { variant: "link" })}</div>
            ${(movie.streamingProviders || []).length ? `<p class="streaming-attribution">Data provided by JustWatch</p>` : ""}
          </div>` : ""}

          ${(movie.cast || []).length ? `<div class="detail-section"><h4>Cast</h4><div class="cast-grid">${movie.cast
            .slice(0, 8)
            .map((c) => `<div class="cast-item"><strong>${escapeHtml(c.name)}</strong>${c.role ? ` <span class="cast-role">as ${escapeHtml(c.role)}</span>` : ""}</div>`)
            .join("")}</div></div>` : ""}

          ${movie.director?.length || movie.writers?.length ? `<div class="detail-section">
            <h4>Credits</h4>
            <dl class="meta-table">
              ${movie.director && movie.director.length ? `<dt>${movie.mediaType === "tv" ? "Creator" : "Director"}</dt><dd>${escapeHtml(movie.director.join(", "))}</dd>` : ""}
              ${movie.writers && movie.writers.length ? `<dt>Writers</dt><dd>${escapeHtml(movie.writers.join(", "))}</dd>` : ""}
            </dl>
          </div>` : ""}

          ${!isWatchlistItem ? `<div class="detail-section">
            <h4>${(movie.copies || []).length > 1 ? `Your copies (${movie.copies.length})` : "Your copy"}</h4>
            <div class="copies-list">
              ${(movie.copies && movie.copies.length ? movie.copies : [{}]).map((c) => copyCardHtml(c)).join("")}
            </div>
          </div>` : ""}
        </div>
      </div>
    `;

    if (!isWatchlistItem) {
      detailBody.querySelector("#detail-watch-btn").addEventListener("click", () => toggleWatched(movie.id));
      detailBody.querySelector("#detail-edit-btn").addEventListener("click", () => {
        closeDetailModal();
        openEditModal(movie.id);
      });
    } else {
      const removeBtn = detailBody.querySelector("#detail-remove-watchlist-btn");
      let confirming = false;
      let confirmTimer = null;
      removeBtn.addEventListener("click", () => {
        if (!confirming) {
          confirming = true;
          removeBtn.textContent = "Click again to remove";
          confirmTimer = setTimeout(() => {
            confirming = false;
            removeBtn.textContent = "Remove from watchlist";
          }, 4000);
          return;
        }
        clearTimeout(confirmTimer);
        removeFromWatchlist(movie.id);
      });
    }
  }

  // ---------- Edit / add modal ----------
  const editModal = el("edit-modal");
  const editForm = el("edit-form");
  const editModalTitle = el("edit-modal-title");
  const deleteMovieBtn = el("delete-movie-btn");
  const addPanel = el("add-panel");

  let searchDebounceTimer = null;
  let selectedMovie = null; // full merged TMDB+OMDb record for the movie about to be added
  let duplicateOfExisting = null; // set when selectedMovie's imdbId matches a movie already on the shelf
  let isDuplicateInWatchlist = false; // set when selectedMovie's imdbId is already in the watchlist
  let addTarget = "collection"; // collection | watchlist — which list the add flow writes to

  // Same press-again-to-confirm pattern as the watchlist drawer's Remove
  // button (see removeFromWatchlist) — not window.confirm(), which is
  // silently suppressed in some embedded/automated browser contexts.
  let deleteConfirming = false;
  let deleteConfirmTimer = null;
  function resetDeleteConfirm() {
    clearTimeout(deleteConfirmTimer);
    deleteConfirming = false;
    deleteMovieBtn.textContent = "Delete";
  }

  function openEditModal(id, target = "collection") {
    state.editingId = id || null;
    addTarget = id ? "collection" : target;
    editForm.reset();
    resetAddPanel();
    resetDeleteConfirm();
    if (id) {
      const movie = getMovieById(id);
      editModalTitle.textContent = "Edit movie";
      deleteMovieBtn.hidden = false;
      addPanel.hidden = true;
      editForm.hidden = false;
      editForm.title.value = movie.title || "";
      editForm.originalTitle.value = movie.originalTitle || "";
      editForm.year.value = movie.year || "";
      editForm.runtimeMinutes.value = movie.runtimeMinutes || "";
      editForm.imdbRating.value = movie.imdbRating ?? "";
      editForm.format.value = movie.format || "DVD";
      editForm.genres.value = (movie.genres || []).join(", ");
      editForm.director.value = (movie.director || []).join(", ");
      editForm.cast.value = (movie.cast || []).map((c) => c.name).join(", ");
      editForm.imdbId.value = movie.imdbId || "";
      editForm.description.value = movie.description || "";
    } else {
      editModalTitle.textContent = addTarget === "watchlist" ? "Add to watchlist" : "Add movie";
      deleteMovieBtn.hidden = true;
      addPanel.hidden = false;
      editForm.hidden = true;
      el("add-format-field").hidden = addTarget === "watchlist";
    }
    editModal.hidden = false;
  }

  function closeEditModal() {
    editModal.hidden = true;
    state.editingId = null;
    resetAddPanel();
    resetDeleteConfirm();
  }

  function resetAddPanel() {
    selectedMovie = null;
    duplicateOfExisting = null;
    isDuplicateInWatchlist = false;
    clearTimeout(searchDebounceTimer);
    el("search-query").value = "";
    el("search-results").hidden = true;
    el("search-results").innerHTML = "";
    el("movie-preview").hidden = true;
    el("movie-preview").innerHTML = "";
    el("add-format-select").value = "DVD";
    el("confirm-add-btn").disabled = true;
    el("confirm-add-btn").textContent = addTarget === "watchlist" ? "Add to watchlist" : "Add to shelf";
    setSearchStatus("");
  }

  function setSearchStatus(msg, isError) {
    const statusEl = el("search-status");
    statusEl.hidden = !msg;
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", !!isError);
  }

  function renderSearchResults(results) {
    const container = el("search-results");
    if (!results.length) {
      container.hidden = true;
      container.innerHTML = "";
      setSearchStatus("No matches found. Try a different title, or paste an IMDb ID.", true);
      return;
    }
    setSearchStatus("");
    container.hidden = false;
    container.innerHTML = results
      .map(
        (r, i) => `
      <button type="button" class="search-result-item" data-index="${i}">
        <div class="search-result-poster">${r.posterUrl ? `<img src="${escapeHtml(r.posterUrl)}" alt="">` : ""}</div>
        <div class="search-result-text">
          <div class="search-result-title">${escapeHtml(r.title)}</div>
          <div class="search-result-year">${r.year || "—"}</div>
        </div>
      </button>
    `
      )
      .join("");
    container.querySelectorAll(".search-result-item").forEach((btn) => {
      btn.addEventListener("click", () => selectMovie(results[Number(btn.dataset.index)]));
    });
  }

  async function selectMovie(result) {
    el("search-results").hidden = true;
    setSearchStatus("Loading details…");
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const res = await fetch(`/api/movie-lookup?tmdbId=${result.tmdbId}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      applySelectedMovie(data);
    } catch (err) {
      setSearchStatus(err.message || "Lookup failed", true);
    }
  }

  async function lookupByImdbId(imdbId) {
    setSearchStatus("Looking up…");
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const res = await fetch(`/api/movie-lookup?imdbId=${encodeURIComponent(imdbId)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      applySelectedMovie(data);
    } catch (err) {
      setSearchStatus(err.message || "Lookup failed", true);
    }
  }

  function ownedFormatsList(movie) {
    const formats = (movie.copies && movie.copies.length ? movie.copies.map((c) => c.format) : [movie.format]).filter(Boolean);
    return [...new Set(formats)].join(", ");
  }

  function updateConfirmButtonLabel() {
    const btn = el("confirm-add-btn");
    if (addTarget === "watchlist") {
      btn.textContent = isDuplicateInWatchlist ? "Already in watchlist" : "Add to watchlist";
      return;
    }
    btn.textContent = duplicateOfExisting ? `Add ${el("add-format-select").value} copy` : "Add to shelf";
  }

  function applySelectedMovie(data) {
    selectedMovie = data;
    if (addTarget === "watchlist") {
      duplicateOfExisting = null;
      isDuplicateInWatchlist = data.imdbId ? state.allWatchlist.some((w) => w.imdbId === data.imdbId) : false;
    } else {
      duplicateOfExisting = data.imdbId ? state.allMovies.find((m) => m.imdbId === data.imdbId) || null : null;
      isDuplicateInWatchlist = false;
    }
    renderMoviePreview(data);
    setSearchStatus("");
    el("confirm-add-btn").disabled = isDuplicateInWatchlist;
    updateConfirmButtonLabel();
  }

  function renderMoviePreview(data) {
    const preview = el("movie-preview");
    preview.hidden = false;
    const heroImage = data.backdropUrl || data.posterUrl;
    preview.innerHTML = `
      <div class="movie-preview-poster">${data.posterUrl ? `<img src="${escapeHtml(data.posterUrl)}" alt="">` : ""}</div>
      <div class="movie-preview-hero" style="${heroImage ? `background-image:url('${escapeHtml(heroImage)}')` : `background:${gradientFor(data.title)}`}"></div>
      <div class="movie-preview-info">
        <p class="movie-preview-title">${escapeHtml(data.title)}</p>
        ${data.originalTitle && data.originalTitle !== data.title ? `<p class="movie-preview-original">${escapeHtml(data.originalTitle)}</p>` : ""}
        <div class="movie-preview-subline">
          ${data.year ? `<span>${data.year}</span>` : ""}
          ${data.runtimeMinutes ? `<span>${data.runtimeMinutes} min</span>` : ""}
          ${data.metascore != null ? `<span class="pill metascore-pill ${metascoreClass(data.metascore)}">${data.metascore} Metascore</span>` : ""}
          ${data.imdbRating != null ? `<span class="pill gold">★ ${data.imdbRating.toFixed(1)} IMDb</span>` : ""}
        </div>
        ${duplicateOfExisting ? `<p class="duplicate-notice">You already own this — <strong>${escapeHtml(ownedFormatsList(duplicateOfExisting))}</strong>. Saving will add another copy, not a new entry.</p>` : ""}
        ${isDuplicateInWatchlist ? `<p class="duplicate-notice">This is already in your watchlist.</p>` : ""}
        ${data.description ? `<p class="movie-preview-overview">${escapeHtml(data.description)}</p>` : ""}
        <div class="movie-preview-meta">
          ${(data.genres || []).length ? `<div><strong>Genres:</strong> ${escapeHtml(data.genres.join(", "))}</div>` : ""}
          ${(data.director || []).length ? `<div><strong>Director:</strong> ${escapeHtml(data.director.join(", "))}</div>` : ""}
          ${(data.cast || []).length ? `<div><strong>Cast:</strong> ${escapeHtml(data.cast.slice(0, 6).map((c) => c.name).join(", "))}</div>` : ""}
        </div>
        <button type="button" class="btn-text search-again-btn" id="search-again-btn">Search again</button>
      </div>
    `;
    el("search-again-btn").addEventListener("click", () => {
      selectedMovie = null;
      duplicateOfExisting = null;
      isDuplicateInWatchlist = false;
      preview.hidden = true;
      preview.innerHTML = "";
      el("confirm-add-btn").disabled = true;
      updateConfirmButtonLabel();
      el("search-query").value = "";
      el("search-query").focus();
    });
  }

  async function runTitleSearch(query) {
    setSearchStatus("Searching…");
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const res = await fetch(`/api/movie-search?title=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      renderSearchResults(data.results || []);
    } catch (err) {
      el("search-results").hidden = true;
      setSearchStatus(err.message || "Search failed", true);
    }
  }

  el("search-query").addEventListener("input", (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchDebounceTimer);
    selectedMovie = null;
    el("movie-preview").hidden = true;
    el("movie-preview").innerHTML = "";
    el("confirm-add-btn").disabled = true;

    if (!query) {
      el("search-results").hidden = true;
      setSearchStatus("");
      return;
    }

    if (/^tt\d+$/i.test(query)) {
      el("search-results").hidden = true;
      searchDebounceTimer = setTimeout(() => lookupByImdbId(query), 400);
      return;
    }

    if (query.length < 2) {
      el("search-results").hidden = true;
      return;
    }

    searchDebounceTimer = setTimeout(() => runTitleSearch(query), 350);
  });

  el("add-format-select").addEventListener("change", updateConfirmButtonLabel);

  async function confirmAddToWatchlist() {
    if (isDuplicateInWatchlist) return;
    const btn = el("confirm-add-btn");
    btn.textContent = "Adding…";

    const newItem = {
      id: "wl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      // The app's own search/add flow only resolves movies on TMDB — TV
      // shows currently only enter the watchlist via a manual/bulk import.
      mediaType: "movie",
      title: selectedMovie.title,
      originalTitle: selectedMovie.originalTitle || selectedMovie.title,
      originalLanguage: selectedMovie.originalLanguage || null,
      year: selectedMovie.year || null,
      imdbRating: selectedMovie.imdbRating ?? null,
      imdbVotes: selectedMovie.imdbVotes ?? null,
      metascore: selectedMovie.metascore ?? null,
      runtimeMinutes: selectedMovie.runtimeMinutes || null,
      genres: selectedMovie.genres || [],
      countries: selectedMovie.countries || [],
      director: selectedMovie.director || [],
      writers: selectedMovie.writers || [],
      cast: selectedMovie.cast || [],
      studios: selectedMovie.studios || [],
      description: selectedMovie.description || null,
      posterUrl: selectedMovie.posterUrl || null,
      backdropUrl: selectedMovie.backdropUrl || null,
      tmdbId: selectedMovie.tmdbId || null,
      imdbId: selectedMovie.imdbId || null,
      imdbLink: selectedMovie.imdbLink || null,
      dateAdded: new Date().toISOString(),
      streamingProviders: [],
      streamingLink: null,
    };

    const { error } = await window.supabaseClient.from("watchlist").insert(toDbColumnsWatchlist(newItem));
    btn.disabled = false;
    btn.textContent = "Add to watchlist";
    if (error) {
      console.error(error);
      showToast("Failed to add to watchlist");
      return;
    }
    state.allWatchlist.push(newItem);
    showToast("Added to watchlist");
    closeEditModal();
    buildWatchlistFilterChips();
    render();

    if (newItem.tmdbId) fetchAndStoreStreamingProviders(newItem.id, newItem.tmdbId, newItem.mediaType);
  }

  // Rebuilding the whole watchlist grid/chips on every single completion
  // (below) is cheap for one item but not for a burst of them landing
  // within milliseconds of each other — debounced so a whole batch
  // collapses into one re-render instead of thrashing the DOM once per
  // item. Detail-drawer updates stay immediate (see caller) since that's
  // one targeted item, not a full rebuild.
  let watchlistRefreshRenderTimer = null;
  function scheduleWatchlistRefreshRender() {
    clearTimeout(watchlistRefreshRenderTimer);
    watchlistRefreshRenderTimer = setTimeout(() => {
      buildWatchlistFilterChips();
      if (state.activeView === "watchlist") render();
    }, 300);
  }

  async function fetchAndStoreStreamingProviders(id, tmdbId, mediaType) {
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const res = await fetch(`/api/watch-providers?tmdbId=${tmdbId}&mediaType=${mediaType === "tv" ? "tv" : "movie"}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      const fetchedAt = new Date().toISOString();
      const { error } = await window.supabaseClient
        .from("watchlist")
        .update({ streaming_pl: data.providers, streaming_link: data.link, streaming_fetched_at: fetchedAt })
        .eq("id", id);
      if (error) throw error;
      const item = state.allWatchlist.find((w) => w.id === id);
      if (item) {
        item.streamingProviders = data.providers;
        item.streamingLink = data.link;
        item.streamingFetchedAt = fetchedAt;
        scheduleWatchlistRefreshRender();
        if (detailModalOpenId === id) renderDetailBody(item);
      }
    } catch (err) {
      // Silent: the watchlist item is already added/visible, just without
      // streaming data until the next successful fetch.
      console.error(err);
    }
  }

  // Keeps cached streaming availability roughly in sync with TMDB's own
  // once-a-day refresh from JustWatch, without a live call on every render.
  //
  // Capped and throttled — refreshing every stale item unconditionally
  // used to fire one fetch+Supabase-write per item, all at once, on every
  // real-app page load. With a large watchlist where a meaningful chunk
  // has gone stale (e.g. after a day away), that's dozens of concurrent
  // requests from a single mobile connection, likely the cause of
  // reported multi-minute unresponsiveness that a reload didn't fix
  // (reloading just re-triggered the same burst). Oldest-stale-first with
  // a per-load cap means a capped run still makes real progress on a
  // large backlog across consecutive sessions, instead of either doing
  // nothing or trying to do everything at once.
  const STALE_STREAMING_REFRESH_LIMIT = 20;
  const STALE_STREAMING_CONCURRENCY = 4;
  function refreshStaleStreamingProviders() {
    const STALE_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const stale = state.allWatchlist
      .filter((w) => w.tmdbId && (!w.streamingFetchedAt || now - new Date(w.streamingFetchedAt).getTime() > STALE_MS))
      .sort((a, b) => new Date(a.streamingFetchedAt || 0) - new Date(b.streamingFetchedAt || 0))
      .slice(0, STALE_STREAMING_REFRESH_LIMIT);

    let next = 0;
    async function worker() {
      while (next < stale.length) {
        const w = stale[next++];
        await fetchAndStoreStreamingProviders(w.id, w.tmdbId, w.mediaType);
      }
    }
    for (let i = 0; i < Math.min(STALE_STREAMING_CONCURRENCY, stale.length); i++) worker();
  }

  // Confirmation is handled by the caller (a press-again-to-confirm button in
  // the drawer) rather than window.confirm() — native confirm dialogs are
  // suppressed in some embedded/automated browser contexts, which made this
  // silently no-op there.
  async function removeFromWatchlist(id) {
    if (DEMO_MODE) {
      state.allWatchlist = state.allWatchlist.filter((m) => m.id !== id);
      saveDemoWatchlist();
      showToast("Removed from watchlist");
      if (detailModalOpenId === id) closeDetailModal();
      buildWatchlistFilterChips();
      render();
      return;
    }

    const { error } = await window.supabaseClient.from("watchlist").delete().eq("id", id);
    if (error) {
      console.error(error);
      showToast("Failed to remove from watchlist");
      return;
    }
    state.allWatchlist = state.allWatchlist.filter((m) => m.id !== id);
    showToast("Removed from watchlist");
    if (detailModalOpenId === id) closeDetailModal();
    buildWatchlistFilterChips();
    render();
  }

  el("confirm-add-btn").addEventListener("click", async () => {
    if (!selectedMovie) return;
    const btn = el("confirm-add-btn");
    btn.disabled = true;

    if (addTarget === "watchlist") {
      await confirmAddToWatchlist();
      return;
    }

    const format = el("add-format-select").value;

    if (duplicateOfExisting) {
      btn.textContent = "Adding…";
      const newCopy = {
        format,
        formatDetail: null,
        edition: null,
        distributor: null,
        aspectRatio: null,
        audioLanguages: [],
        subtitleLanguages: [],
        extras: null,
        polishLicensedRelease: null,
        notes: null,
        source: "manual",
      };
      const updatedCopies = [...(duplicateOfExisting.copies || []), newCopy];
      const { error } = await window.supabaseClient
        .from("movies")
        .update({ copies: updatedCopies })
        .eq("id", duplicateOfExisting.id);
      btn.disabled = false;
      if (error) {
        console.error(error);
        showToast("Failed to add copy");
        return;
      }
      const idx = state.allMovies.findIndex((m) => m.id === duplicateOfExisting.id);
      state.allMovies[idx] = { ...state.allMovies[idx], copies: updatedCopies };
      showToast(`Added ${format} copy of "${duplicateOfExisting.title}"`);
      closeEditModal();
      buildFilterChips();
      render();
      return;
    }

    btn.textContent = "Adding…";

    const newMovie = {
      id: "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: selectedMovie.title,
      originalTitle: selectedMovie.originalTitle || selectedMovie.title,
      originalLanguage: selectedMovie.originalLanguage || null,
      year: selectedMovie.year || null,
      imdbRating: selectedMovie.imdbRating ?? null,
      imdbVotes: selectedMovie.imdbVotes ?? null,
      metascore: selectedMovie.metascore ?? null,
      runtimeMinutes: selectedMovie.runtimeMinutes || null,
      genres: selectedMovie.genres || [],
      countries: selectedMovie.countries || [],
      director: selectedMovie.director || [],
      writers: selectedMovie.writers || [],
      cast: selectedMovie.cast || [],
      studios: selectedMovie.studios || [],
      format,
      edition: "",
      aspectRatio: "",
      audioLanguages: [],
      subtitleLanguages: [],
      hasExtras: false,
      description: selectedMovie.description || null,
      posterUrl: selectedMovie.posterUrl || null,
      backdropUrl: selectedMovie.backdropUrl || null,
      tmdbId: selectedMovie.tmdbId || null,
      imdbId: selectedMovie.imdbId || null,
      imdbLink: selectedMovie.imdbLink || null,
      dateAdded: new Date().toISOString(),
      watched: false,
      copies: [
        {
          format,
          formatDetail: null,
          edition: null,
          distributor: null,
          aspectRatio: null,
          audioLanguages: [],
          subtitleLanguages: [],
          extras: null,
          polishLicensedRelease: null,
          notes: null,
          source: "manual",
        },
      ],
    };

    const { error } = await window.supabaseClient.from("movies").insert(toDbColumns(newMovie));
    btn.disabled = false;
    btn.textContent = "Add to shelf";
    if (error) {
      console.error(error);
      showToast("Failed to add movie");
      return;
    }
    state.allMovies.push(newMovie);
    showToast("Movie added");
    closeEditModal();
    buildFilterChips();
    render();
  });

  function splitCsv(value) {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.editingId) return;
    const fd = new FormData(editForm);
    const patch = {
      title: fd.get("title").trim(),
      originalTitle: fd.get("originalTitle").trim() || fd.get("title").trim(),
      year: fd.get("year") ? Number(fd.get("year")) : null,
      runtimeMinutes: fd.get("runtimeMinutes") ? Number(fd.get("runtimeMinutes")) : null,
      imdbRating: fd.get("imdbRating") ? Number(fd.get("imdbRating")) : null,
      format: fd.get("format"),
      genres: splitCsv(fd.get("genres")),
      director: splitCsv(fd.get("director")),
      cast: splitCsv(fd.get("cast")).map((name) => ({ name, role: "" })),
      imdbId: fd.get("imdbId").trim(),
      imdbLink: fd.get("imdbId").trim() ? `https://www.imdb.com/title/${fd.get("imdbId").trim()}/` : null,
      description: fd.get("description").trim(),
    };

    const submitBtn = editForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    if (DEMO_MODE) {
      const idx = state.allMovies.findIndex((m) => m.id === state.editingId);
      state.allMovies[idx] = { ...state.allMovies[idx], ...patch };
      saveDemoMovies();
      submitBtn.disabled = false;
      showToast("Movie updated");
      closeEditModal();
      buildFilterChips();
      render();
      return;
    }

    const { error } = await window.supabaseClient
      .from("movies")
      .update(toDbColumns(patch))
      .eq("id", state.editingId);
    submitBtn.disabled = false;
    if (error) {
      console.error(error);
      showToast("Failed to update movie");
      return;
    }
    const idx = state.allMovies.findIndex((m) => m.id === state.editingId);
    state.allMovies[idx] = { ...state.allMovies[idx], ...patch };
    showToast("Movie updated");
    closeEditModal();
    buildFilterChips();
    render();
  });

  deleteMovieBtn.addEventListener("click", async () => {
    if (!state.editingId) return;
    if (!deleteConfirming) {
      deleteConfirming = true;
      deleteMovieBtn.textContent = "Click again to delete";
      deleteConfirmTimer = setTimeout(resetDeleteConfirm, 4000);
      return;
    }
    resetDeleteConfirm();

    if (DEMO_MODE) {
      state.allMovies = state.allMovies.filter((m) => m.id !== state.editingId);
      saveDemoMovies();
      showToast("Movie removed");
      closeEditModal();
      buildFilterChips();
      render();
      return;
    }

    const { error } = await window.supabaseClient.from("movies").delete().eq("id", state.editingId);
    if (error) {
      console.error(error);
      showToast("Failed to remove movie");
      return;
    }
    state.allMovies = state.allMovies.filter((m) => m.id !== state.editingId);
    showToast("Movie removed");
    closeEditModal();
    buildFilterChips();
    render();
  });

  // ---------- View mode ----------
  function setViewMode(mode, opts = {}) {
    state.viewMode = mode;
    el("view-grid-btn").classList.toggle("active", mode === "grid");
    el("view-list-btn").classList.toggle("active", mode === "list");
    el("columns-toggle-btn").hidden = mode !== "list";
    el("grid-cols-control").hidden = mode !== "grid";
    if (mode !== "list") {
      el("columns-menu").hidden = true;
      el("columns-toggle-btn").classList.remove("active");
    }
    if (!opts.skipSave) localStorage.setItem(STORAGE_KEYS.viewMode, mode);
    render();
  }

  function maxGridColsForViewport() {
    const available = grid.clientWidth || window.innerWidth;
    const fit = Math.floor((available + GRID_GAP_PX) / (GRID_COLS_MIN_POSTER_PX + GRID_GAP_PX));
    return Math.min(GRID_COLS_MAX, Math.max(GRID_COLS_MIN, fit));
  }

  function applyGridCols() {
    const maxCols = maxGridColsForViewport();
    const slider = el("grid-cols-slider");
    slider.max = maxCols;
    if (state.gridCols > maxCols) {
      state.gridCols = maxCols;
      localStorage.setItem(STORAGE_KEYS.gridCols, String(state.gridCols));
    }
    grid.style.setProperty("--grid-cols", state.gridCols);
    if (watchlistGrid) watchlistGrid.style.setProperty("--grid-cols", state.gridCols);
    slider.value = state.gridCols;
    el("grid-cols-value").textContent = state.gridCols;
  }

  // Not available in the demo (no watchlist tab/DOM there) — only called
  // from real-mode code paths (init, tab click handlers).
  function switchView(view, opts = {}) {
    state.activeView = view;
    if (!opts.skipSave) localStorage.setItem(STORAGE_KEYS.activeView, view);
    el("tab-collection").classList.toggle("active", view === "collection");
    el("tab-watchlist").classList.toggle("active", view === "watchlist");

    // Force every content container hidden, then let render() below
    // un-hide only the pair that belongs to the newly active view.
    grid.hidden = true;
    list.hidden = true;
    emptyState.hidden = true;
    watchlistGrid.hidden = true;
    watchlistList.hidden = true;
    watchlistEmptyState.hidden = true;

    if (view === "watchlist") buildWatchlistFilterChips();
    else buildFilterChips();
    applyFilterPanelView(view);
    buildColumnsMenu(view === "watchlist" ? WATCHLIST_LIST_COLUMNS : LIST_COLUMNS);
    el("add-movie-btn-label").textContent = view === "watchlist" ? "Add to watchlist" : "Add movie";
    el("mobile-add-btn-label").textContent = view === "watchlist" ? "Add to watchlist" : "Add movie";
    render();
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    const toast = el("toast");
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2200);
  }

  // ---------- Icons ----------
  function eyeIconSvg() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 12C1.5 12 5 5 12 5C19 5 22.5 12 22.5 12C22.5 12 19 19 12 19C5 19 1.5 12 1.5 12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg>`;
  }
  function starIconSvg() {
    return `<svg width="10" height="10" viewBox="0 0 24 24" fill="#f4c752" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L14.9 8.6L22 9.3L16.6 14L18.2 21L12 17.3L5.8 21L7.4 14L2 9.3L9.1 8.6L12 2Z"/></svg>`;
  }
  function pencilIconSvg() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 20H8L18.5 9.5C19.3 8.7 19.3 7.3 18.5 6.5L17.5 5.5C16.7 4.7 15.3 4.7 14.5 5.5L4 16V20Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  }
  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- Events ----------
  function bindEvents() {
    el("search-input").addEventListener("input", (e) => {
      state.search = e.target.value;
      render();
    });

    el("sort-select").addEventListener("change", (e) => {
      state.sort = e.target.value;
      render();
    });

    el("view-grid-btn").addEventListener("click", () => setViewMode("grid"));
    el("view-list-btn").addEventListener("click", () => setViewMode("list"));

    el("grid-cols-slider").addEventListener("input", (e) => {
      state.gridCols = Number(e.target.value);
      applyGridCols();
      localStorage.setItem(STORAGE_KEYS.gridCols, String(state.gridCols));
    });

    let resizeDebounceTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(applyGridCols, 150);
    });

    el("filter-toggle-btn").addEventListener("click", () => {
      filterPanel.hidden = !filterPanel.hidden;
      el("filter-toggle-btn").classList.toggle("active", !filterPanel.hidden);
      if (!filterPanel.hidden) {
        setupCollapsibleChipRow("filter-country", "filter-country-toggle");
        if (state.activeView === "watchlist") setupCollapsibleChipRow("filter-streaming-service", "filter-streaming-service-toggle");
      }
    });

    buildColumnsMenu(state.activeView === "watchlist" ? WATCHLIST_LIST_COLUMNS : LIST_COLUMNS);
    el("columns-toggle-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = el("columns-menu");
      menu.hidden = !menu.hidden;
      el("columns-toggle-btn").classList.toggle("active", !menu.hidden);
    });
    document.addEventListener("click", (e) => {
      const menu = el("columns-menu");
      if (!menu.hidden && !menu.contains(e.target) && e.target !== el("columns-toggle-btn") && !el("columns-toggle-btn").contains(e.target)) {
        menu.hidden = true;
        el("columns-toggle-btn").classList.remove("active");
      }
      const toggleBtn = el("filter-toggle-btn");
      if (!filterPanel.hidden && !filterPanel.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
        filterPanel.hidden = true;
        toggleBtn.classList.remove("active");
      }
      if (previewCard && !previewCard.contains(e.target)) clearCardPreview();
      const mobileMenu = el("mobile-menu");
      const mobileMenuBtn = el("mobile-menu-btn");
      if (!mobileMenu.hidden && !mobileMenu.contains(e.target) && e.target !== mobileMenuBtn && !mobileMenuBtn.contains(e.target)) {
        mobileMenu.hidden = true;
        mobileMenuBtn.classList.remove("active");
      }
    });

    document.querySelectorAll("#filter-watched .chip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.value === "all");
      chip.addEventListener("click", () => {
        state.filters.watched = chip.dataset.value;
        document.querySelectorAll("#filter-watched .chip").forEach((c) => c.classList.toggle("active", c === chip));
        render();
      });
    });

    document.querySelectorAll("#filter-copies .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.filters.multiCopy = !state.filters.multiCopy;
        chip.classList.toggle("active", state.filters.multiCopy);
        render();
      });
    });

    document.querySelectorAll("#filter-streaming-available .chip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.value === "all");
      chip.addEventListener("click", () => {
        state.watchlistFilters.streamingAvailable = chip.dataset.value;
        document.querySelectorAll("#filter-streaming-available .chip").forEach((c) => c.classList.toggle("active", c === chip));
        render();
      });
    });

    el("filter-clear-btn").addEventListener("click", () => {
      if (state.activeView === "watchlist") clearWatchlistFilters();
      else clearFilters();
    });
    el("empty-clear-btn").addEventListener("click", clearFilters);
    const watchlistEmptyClearBtn = el("watchlist-empty-clear-btn");
    if (watchlistEmptyClearBtn) watchlistEmptyClearBtn.addEventListener("click", clearWatchlistFilters);

    const mobileMenu = el("mobile-menu");
    const mobileMenuBtn = el("mobile-menu-btn");
    function closeMobileMenu() {
      mobileMenu.hidden = true;
      mobileMenuBtn.classList.remove("active");
    }
    mobileMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      mobileMenu.hidden = !mobileMenu.hidden;
      mobileMenuBtn.classList.toggle("active", !mobileMenu.hidden);
    });

    if (DEMO_MODE) {
      [el("add-movie-btn"), el("mobile-add-btn")].forEach((btn) => {
        btn.classList.add("btn-inert");
        btn.setAttribute("aria-disabled", "true");
        btn.title = "Not available in the demo — sign in to add movies or watchlist items";
        // No click listener attached, so the button is functionally inert;
        // deliberately not using the disabled attribute since that also
        // suppresses the hover tooltip in most browsers.
      });
    } else {
      const openAdd = () => openEditModal(null, state.activeView);
      el("add-movie-btn").addEventListener("click", openAdd);
      el("mobile-add-btn").addEventListener("click", () => {
        closeMobileMenu();
        openAdd();
      });
    }
    const tabCollectionBtn = el("tab-collection");
    const tabWatchlistBtn = el("tab-watchlist");
    if (tabCollectionBtn && tabWatchlistBtn) {
      tabCollectionBtn.addEventListener("click", () => switchView("collection"));
      tabWatchlistBtn.addEventListener("click", () => switchView("watchlist"));
    }
    el("home-btn").addEventListener("click", goHome);
    const signOutBtn = el("sign-out-btn");
    if (signOutBtn) {
      const doSignOut = async () => {
        await window.supabaseClient.auth.signOut();
        window.location.href = "/login";
      };
      signOutBtn.addEventListener("click", doSignOut);
      el("mobile-sign-out-btn").addEventListener("click", () => {
        closeMobileMenu();
        doSignOut();
      });
    }

    document.querySelectorAll("[data-close-detail]").forEach((b) => b.addEventListener("click", closeDetailModal));
    document.querySelectorAll("[data-close-edit]").forEach((b) => b.addEventListener("click", closeEditModal));

    detailModal.addEventListener("click", (e) => {
      if (e.target === detailModal) closeDetailModal();
    });
    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) closeEditModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!detailModal.hidden) closeDetailModal();
      if (!editModal.hidden) closeEditModal();
      if (!filterPanel.hidden) {
        filterPanel.hidden = true;
        el("filter-toggle-btn").classList.remove("active");
      }
    });
  }

  function clearFilters() {
    state.filters.watched = "all";
    state.filters.formats.clear();
    state.filters.genres.clear();
    state.filters.countries.clear();
    state.filters.decades.clear();
    state.filters.multiCopy = false;
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.value === "all"));
    render();
  }

  function clearWatchlistFilters() {
    state.watchlistFilters.genres.clear();
    state.watchlistFilters.countries.clear();
    state.watchlistFilters.decades.clear();
    state.watchlistFilters.streamingAvailable = "all";
    state.watchlistFilters.streamingServices.clear();
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.value === "all"));
    render();
  }

  function goHome() {
    state.search = "";
    el("search-input").value = "";
    filterPanel.hidden = true;
    el("filter-toggle-btn").classList.remove("active");
    if (state.activeView === "watchlist") clearWatchlistFilters();
    else clearFilters();
  }

  init();
})();
