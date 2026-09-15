(() => {
  "use strict";

  const STORAGE_KEYS = {
    viewMode: "movieShelf.viewMode",
    listColumns: "movieShelf.listColumns",
    gridCols: "movieShelf.gridCols",
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

  const GRID_COLS_MIN = 4;
  const GRID_COLS_MAX = 8;
  const GRID_COLS_DEFAULT = 6;

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

  function defaultListColumns() {
    return {
      visible: Object.fromEntries(LIST_COLUMNS.map((c) => [c.key, c.defaultVisible])),
      widths: Object.fromEntries(
        [...LOCKED_LIST_COLUMNS.filter((c) => c.resizable), ...LIST_COLUMNS].map((c) => [c.key, c.width])
      ),
    };
  }

  const state = {
    allMovies: [], // every row from Supabase, source of truth
    movies: [], // filtered+sorted view
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

  // ---------- Data loading ----------
  async function init() {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
      window.location.href = "login.html";
      return;
    }

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

    buildFilterChips();
    bindEvents();
    applyGridCols();
    setViewMode(state.viewMode, { skipSave: true });
    render();

    window.supabaseClient.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.href = "login.html";
    });
  }

  function allMovies() {
    return state.allMovies;
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

    const [key, dir] = state.sort.split("-");
    const mul = dir === "desc" ? -1 : 1;
    list = [...list].sort((a, b) => {
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

    return list;
  }

  // ---------- Rendering ----------
  function render() {
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

  function updateFilterBadge() {
    const count =
      (state.filters.watched !== "all" ? 1 : 0) +
      state.filters.formats.size +
      state.filters.genres.size +
      state.filters.countries.size +
      state.filters.decades.size;
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

      card.addEventListener("click", () => openDetailModal(movie.id));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter") openDetailModal(movie.id);
      });

      frag.appendChild(card);
    });
    grid.appendChild(frag);
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
        const copies = movie.copies && movie.copies.length ? movie.copies : [{ format: movie.format }];
        const list = copies.map((c) => c.format || "DVD").join(", ");
        return `<div class="row-cell row-format" title="${escapeHtml(list)}">${escapeHtml(list) || "—"}</div>`;
      }
      case "director":
        return `<div class="row-cell row-director">${escapeHtml((movie.director || []).join(", ")) || "—"}</div>`;
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

  function buildColumnsMenu() {
    const menu = el("columns-menu");
    menu.innerHTML = LIST_COLUMNS.map(
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

    const { error } = await window.supabaseClient.from("movies").update({ watched: nextWatched }).eq("id", id);
    if (error) {
      movie.watched = !nextWatched; // revert
      render();
      if (detailModalOpenId === id) renderDetailBody(getMovieById(id));
      showToast("Failed to update watched status");
    }
  }

  function getMovieById(id) {
    return allMovies().find((m) => m.id === id);
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
    const watched = isWatched(movie.id);
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
            ${movie.format && (movie.copies || []).length <= 1 ? `<span class="pill">${escapeHtml(movie.format)}</span>` : ""}
            ${(movie.copies || []).length > 1 ? `<span class="pill">${movie.copies.length} copies owned</span>` : ""}
            ${movie.metascore != null ? `<span class="pill metascore-pill ${metascoreClass(movie.metascore)}">${movie.metascore} Metascore</span>` : ""}
            ${movie.imdbRating != null ? `<span class="pill gold">★ ${movie.imdbRating.toFixed(1)} IMDb</span>` : ""}
          </div>
          <div class="detail-actions">
            <button class="btn ${watched ? "btn-watched" : "btn-ghost"}" id="detail-watch-btn" type="button">
              ${eyeIconSvg()} ${watched ? "Watched" : "Mark as watched"}
            </button>
            ${movie.imdbLink ? `<a class="btn btn-ghost" href="${escapeHtml(movie.imdbLink)}" target="_blank" rel="noopener">IMDb ↗</a>` : ""}
            <a class="btn btn-ghost" href="https://www.youtube.com/results?search_query=${encodeURIComponent((movie.originalTitle || movie.title) + " " + (movie.year || "") + " trailer")}" target="_blank" rel="noopener">Trailer ↗</a>
            <button class="btn btn-ghost" id="detail-edit-btn" type="button">${pencilIconSvg()} Edit</button>
          </div>

          ${(movie.genres || []).length ? `<div class="detail-section"><h4>Genres</h4><div class="genre-tags">${movie.genres.map((g) => `<span class="genre-tag">${escapeHtml(g)}</span>`).join("")}</div></div>` : ""}

          ${(movie.countries || []).length ? `<div class="detail-section"><h4>Country</h4><p>${escapeHtml(movie.countries.join(", "))}</p></div>` : ""}

          ${movie.description ? `<div class="detail-section"><h4>Overview</h4><p>${escapeHtml(movie.description)}</p></div>` : ""}

          ${(movie.cast || []).length ? `<div class="detail-section"><h4>Cast</h4><div class="cast-grid">${movie.cast
            .slice(0, 8)
            .map((c) => `<div class="cast-item"><strong>${escapeHtml(c.name)}</strong>${c.role ? ` <span class="cast-role">as ${escapeHtml(c.role)}</span>` : ""}</div>`)
            .join("")}</div></div>` : ""}

          ${movie.director?.length || movie.writers?.length ? `<div class="detail-section">
            <h4>Credits</h4>
            <dl class="meta-table">
              ${movie.director && movie.director.length ? `<dt>Director</dt><dd>${escapeHtml(movie.director.join(", "))}</dd>` : ""}
              ${movie.writers && movie.writers.length ? `<dt>Writers</dt><dd>${escapeHtml(movie.writers.join(", "))}</dd>` : ""}
            </dl>
          </div>` : ""}

          <div class="detail-section">
            <h4>${(movie.copies || []).length > 1 ? `Your copies (${movie.copies.length})` : "Your copy"}</h4>
            <div class="copies-list">
              ${(movie.copies && movie.copies.length ? movie.copies : [{}]).map((c) => copyCardHtml(c)).join("")}
            </div>
          </div>
        </div>
      </div>
    `;

    detailBody.querySelector("#detail-watch-btn").addEventListener("click", () => toggleWatched(movie.id));
    detailBody.querySelector("#detail-edit-btn").addEventListener("click", () => {
      closeDetailModal();
      openEditModal(movie.id);
    });
  }

  // ---------- Edit / add modal ----------
  const editModal = el("edit-modal");
  const editForm = el("edit-form");
  const editModalTitle = el("edit-modal-title");
  const deleteMovieBtn = el("delete-movie-btn");
  const addPanel = el("add-panel");

  let searchDebounceTimer = null;
  let selectedMovie = null; // full merged TMDB+OMDb record for the movie about to be added

  function openEditModal(id) {
    state.editingId = id || null;
    editForm.reset();
    resetAddPanel();
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
      editModalTitle.textContent = "Add movie";
      deleteMovieBtn.hidden = true;
      addPanel.hidden = false;
      editForm.hidden = true;
    }
    editModal.hidden = false;
  }

  function closeEditModal() {
    editModal.hidden = true;
    state.editingId = null;
    resetAddPanel();
  }

  function resetAddPanel() {
    selectedMovie = null;
    clearTimeout(searchDebounceTimer);
    el("search-query").value = "";
    el("search-results").hidden = true;
    el("search-results").innerHTML = "";
    el("movie-preview").hidden = true;
    el("movie-preview").innerHTML = "";
    el("add-format-select").value = "DVD";
    el("confirm-add-btn").disabled = true;
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

  function applySelectedMovie(data) {
    selectedMovie = data;
    renderMoviePreview(data);
    setSearchStatus("");
    el("confirm-add-btn").disabled = false;
  }

  function renderMoviePreview(data) {
    const preview = el("movie-preview");
    preview.hidden = false;
    preview.innerHTML = `
      <div class="movie-preview-poster">${data.posterUrl ? `<img src="${escapeHtml(data.posterUrl)}" alt="">` : ""}</div>
      <div class="movie-preview-info">
        <p class="movie-preview-title">${escapeHtml(data.title)}</p>
        ${data.originalTitle && data.originalTitle !== data.title ? `<p class="movie-preview-original">${escapeHtml(data.originalTitle)}</p>` : ""}
        <div class="movie-preview-subline">
          ${data.year ? `<span>${data.year}</span>` : ""}
          ${data.runtimeMinutes ? `<span>${data.runtimeMinutes} min</span>` : ""}
          ${data.metascore != null ? `<span class="pill metascore-pill ${metascoreClass(data.metascore)}">${data.metascore} Metascore</span>` : ""}
          ${data.imdbRating != null ? `<span class="pill gold">★ ${data.imdbRating.toFixed(1)} IMDb</span>` : ""}
        </div>
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
      preview.hidden = true;
      preview.innerHTML = "";
      el("confirm-add-btn").disabled = true;
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

  el("confirm-add-btn").addEventListener("click", async () => {
    if (!selectedMovie) return;
    const btn = el("confirm-add-btn");
    btn.disabled = true;
    btn.textContent = "Adding…";
    const format = el("add-format-select").value;

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
    if (!confirm("Remove this movie from your shelf?")) return;

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

  function applyGridCols() {
    grid.style.setProperty("--grid-cols", state.gridCols);
    el("grid-cols-slider").value = state.gridCols;
    el("grid-cols-value").textContent = state.gridCols;
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

    el("filter-toggle-btn").addEventListener("click", () => {
      filterPanel.hidden = !filterPanel.hidden;
      el("filter-toggle-btn").classList.toggle("active", !filterPanel.hidden);
      if (!filterPanel.hidden) setupCollapsibleChipRow("filter-country", "filter-country-toggle");
    });

    buildColumnsMenu();
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
    });

    document.querySelectorAll("#filter-watched .chip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.value === "all");
      chip.addEventListener("click", () => {
        state.filters.watched = chip.dataset.value;
        document.querySelectorAll("#filter-watched .chip").forEach((c) => c.classList.toggle("active", c === chip));
        render();
      });
    });

    el("filter-clear-btn").addEventListener("click", clearFilters);
    el("empty-clear-btn").addEventListener("click", clearFilters);

    el("add-movie-btn").addEventListener("click", () => openEditModal(null));
    el("home-btn").addEventListener("click", goHome);
    el("sign-out-btn").addEventListener("click", async () => {
      await window.supabaseClient.auth.signOut();
      window.location.href = "login.html";
    });

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
    });
  }

  function clearFilters() {
    state.filters.watched = "all";
    state.filters.formats.clear();
    state.filters.genres.clear();
    state.filters.countries.clear();
    state.filters.decades.clear();
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.value === "all"));
    render();
  }

  function goHome() {
    state.search = "";
    el("search-input").value = "";
    filterPanel.hidden = true;
    el("filter-toggle-btn").classList.remove("active");
    clearFilters();
  }

  init();
})();
