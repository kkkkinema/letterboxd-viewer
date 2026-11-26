(() => {
  const PLACEHOLDER =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='180'%3E%3Crect fill='%2319191f' width='120' height='180'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2376726a' font-size='14'%3E?%3C/text%3E%3C/svg%3E";

  const REVIEWED_STORAGE_KEY = 'poster_picker_reviewed_keys';

  const loadReviewedSet = () => {
    try {
      const raw = localStorage.getItem(REVIEWED_STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  };

  const state = {
    films: [],
    hasTmdbKey: true,
    queue: 'needs_review',
    rating: 'all',
    year: 'all',
    sort: 'rating_desc',
    query: '',
    selectedKey: null,
    langFilter: 'all',
    postersCache: new Map(), // "movie:123" -> payload
    activePayload: null,     // payload currently displayed in detail pane (auto or manual search)
    manualMatchLabel: '',    // e.g. "The World of Apu (1959)" when loaded from manual TMDB search
    showManualSearch: false, // toggle manual TMDB search box even on matched films
    reviewed: loadReviewedSet(),
    autoAdvance: localStorage.getItem('poster_picker_autoadvance') !== 'false',
    busyGit: false,
  };

  const els = {
    customCounter: document.getElementById('customCounter'),
    unmatchedPill: document.getElementById('unmatchedPill'),
    customizedPill: document.getElementById('customizedPill'),
    autoAdvanceToggle: document.getElementById('autoAdvanceToggle'),
    pullBtn: document.getElementById('pullBtn'),
    pushBtn: document.getElementById('pushBtn'),
    statusBanner: document.getElementById('statusBanner'),
    statusBannerText: document.getElementById('statusBannerText'),
    statusBannerClose: document.getElementById('statusBannerClose'),
    filmSearch: document.getElementById('filmSearch'),
    queuePills: document.getElementById('queuePills'),
    ratingFilter: document.getElementById('ratingFilter'),
    yearFilter: document.getElementById('yearFilter'),
    sortFilter: document.getElementById('sortFilter'),
    filmList: document.getElementById('filmList'),
    detailPane: document.getElementById('detailPane'),
    toast: document.getElementById('toast'),
  };

  els.autoAdvanceToggle.checked = state.autoAdvance;

  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function formatCompactRating(r) {
    if (r == null) return '';
    return `${Number.isInteger(r) ? r : r}★`;
  }

  let toastTimer = null;
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2400);
  }

  function showBanner(msg, tone = 'neutral') {
    els.statusBannerText.textContent = msg;
    els.statusBanner.className = `banner ${tone === 'ok' ? 'is-ok' : tone === 'err' ? 'is-err' : ''}`;
    els.statusBanner.hidden = false;
  }

  function saveReviewed(key) {
    state.reviewed.add(key);
    try {
      localStorage.setItem(REVIEWED_STORAGE_KEY, JSON.stringify(Array.from(state.reviewed)));
    } catch {}
  }

  function updateCounter() {
    const customized = state.films.filter((f) => f.hasOverride).length;
    const unmatchedLeft = state.films.filter((f) => f.isUnmatched && !f.hasOverride).length;
    els.customCounter.textContent = `${customized.toLocaleString()} of ${state.films.length.toLocaleString()} customized`;
    if (els.unmatchedPill) {
      els.unmatchedPill.textContent = `Unmatched (${unmatchedLeft})`;
    }
    if (els.customizedPill) {
      els.customizedPill.textContent = `Customized (${customized})`;
    }
  }

  function updateGitButtons(gitStatus) {
    if (!gitStatus) return;
    const pending = gitStatus.pendingCount || 0;
    els.pushBtn.textContent = pending > 0 ? `↑ Push to GitHub (${pending})` : '↑ Push to GitHub';
    els.pushBtn.classList.toggle('has-pending', pending > 0);
  }

  async function refreshGitStatus() {
    try {
      const res = await fetch('/api/git/status');
      const data = await res.json();
      updateGitButtons(data);
    } catch {}
  }

  function matchesRatingFilter(f) {
    const rf = state.rating;
    if (rf === 'all') return true;
    if (rf === 'liked') return Boolean(f.liked);
    if (rf === 'reviews') return Boolean(f.isReview);
    if (rf === 'unrated') return f.rating == null;
    if (f.rating == null) return false;
    if (rf === '4.5+') return f.rating >= 4.5;
    if (rf === '4+') return f.rating >= 4.0;
    if (rf === 'le2.5') return f.rating <= 2.5;
    return f.rating === Number(rf);
  }

  function getFilteredFilms() {
    const q = state.query.trim().toLowerCase();
    let list = state.films.filter((f) => {
      if (state.queue === 'needs_review' && (f.hasOverride || state.reviewed.has(f.key))) return false;
      if (state.queue === 'unmatched' && (!f.isUnmatched || f.hasOverride)) return false;
      if (state.queue === 'customized' && !f.hasOverride) return false;
      if (!matchesRatingFilter(f)) return false;
      if (state.year !== 'all' && String(f.year || '') !== state.year) return false;
      if (q && !`${f.title} ${f.director} ${f.year || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });

    if (state.sort === 'rating_desc') {
      list = [...list].sort((a, b) => {
        const ra = a.rating ?? -1;
        const rb = b.rating ?? -1;
        if (rb !== ra) return rb - ra;
        if (Boolean(b.liked) !== Boolean(a.liked)) return b.liked ? 1 : -1;
        return (b.lastWatched || '').localeCompare(a.lastWatched || '');
      });
    } else if (state.sort === 'alpha') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }

  function renderFilmList() {
    const list = getFilteredFilms();
    updateCounter();

    if (!list.length) {
      els.filmList.innerHTML = `<div class="empty-note">No films match these filters.</div>`;
      return;
    }

    const slice = list.slice(0, 450);
    els.filmList.innerHTML = slice
      .map((f) => {
        const active = f.key === state.selectedKey;
        const rStr = formatCompactRating(f.rating);
        return `
          <button type="button" class="film-row${active ? ' active' : ''}" data-key="${esc(f.key)}">
            <img src="${esc(f.currentPosterUrl || PLACEHOLDER)}" alt="" class="film-row-thumb" loading="lazy" />
            <div class="film-row-meta">
              <div class="film-row-title">${esc(f.title)}</div>
              <div class="film-row-sub">
                ${esc(f.year ?? '—')}${rStr ? ` · <span class="row-stars">${esc(rStr)}</span>` : ''}${f.liked ? ' <span class="row-heart">♥</span>' : ''}${f.logCount > 1 ? ` · ${f.logCount}×` : ''}
              </div>
            </div>
            ${f.hasOverride ? '<span class="tag-custom">Custom</span>' : f.isUnmatched ? '<span class="tag-unmatched">No ID</span>' : ''}
          </button>
        `;
      })
      .join('');

    els.filmList.querySelectorAll('.film-row').forEach((btn) => {
      btn.addEventListener('click', () => selectFilm(btn.dataset.key));
    });
  }

  function populateYearSelect() {
    const years = Array.from(new Set(state.films.map((f) => f.year).filter(Boolean))).sort((a, b) => b - a);
    els.yearFilter.innerHTML =
      '<option value="all">All Years</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join('');
  }

  async function selectFilm(key, resetLang = true) {
    state.selectedKey = key;
    if (resetLang) {
      state.langFilter = 'all';
      state.activePayload = null;
      state.manualMatchLabel = '';
      state.showManualSearch = false;
    }
    renderFilmList();

    const film = state.films.find((f) => f.key === key);
    if (!film) {
      els.detailPane.innerHTML = `<div class="empty-state">Select a film from the left.</div>`;
      return;
    }

    if (!film.tmdbId) {
      state.showManualSearch = true;
    }

    if (state.activePayload) {
      renderDetailShell(film, state.activePayload, false);
      return;
    }

    renderDetailShell(film, null, Boolean(film.tmdbId && state.hasTmdbKey));

    if (film.tmdbId && state.hasTmdbKey) {
      const cacheKey = `${film.tmdbType}:${film.tmdbId}`;
      let payload = state.postersCache.get(cacheKey);
      if (!payload) {
        try {
          const res = await fetch(`/api/films/${encodeURIComponent(key)}/posters`);
          payload = await res.json();
          if (!payload.error) state.postersCache.set(cacheKey, payload);
        } catch (err) {
          payload = { error: err.message };
        }
      }
      if (state.selectedKey === key) {
        state.activePayload = payload;
        renderDetailShell(film, payload, false);
      }
    }
  }

  function filterPostersByLang(payload) {
    const posters = payload?.posters || [];
    const orig = payload?.originalLanguage || '';
    if (state.langFilter === 'textless') return posters.filter((p) => !p.lang);
    if (state.langFilter === 'en') return posters.filter((p) => p.lang === 'en');
    if (state.langFilter === 'orig') return posters.filter((p) => p.lang === orig);
    return posters;
  }

  function renderDetailShell(film, payload, isLoading) {
    const activePosterPath = film.override?.posterPath || film.defaultPosterPath || '';
    const origLang = payload?.originalLanguage || '';
    const filteredPosters = payload && !payload.error ? filterPostersByLang(payload) : [];

    const langChipsHtml = payload && !payload.error
      ? `
        <div class="lang-chips">
          <button type="button" class="lang-chip${state.langFilter === 'all' ? ' active' : ''}" data-lang="all">All (${payload.posters.length})</button>
          <button type="button" class="lang-chip${state.langFilter === 'textless' ? ' active' : ''}" data-lang="textless">Textless</button>
          <button type="button" class="lang-chip${state.langFilter === 'en' ? ' active' : ''}" data-lang="en">English</button>
          ${origLang && origLang !== 'en' ? `<button type="button" class="lang-chip${state.langFilter === 'orig' ? ' active' : ''}" data-lang="orig">Original (${esc(origLang.toUpperCase())})</button>` : ''}
        </div>
      `
      : '';

    let galleryHtml = '';
    if (!state.hasTmdbKey) {
      galleryHtml = `<div class="empty-note">TMDB_API_KEY not found in <code>.env</code> — set it to browse alternate TMDB posters, or paste any poster URL below.</div>`;
    } else if (isLoading) {
      galleryHtml = `<div class="empty-note">Loading TMDB alternate posters…</div>`;
    } else if (!film.tmdbId && !payload) {
      galleryHtml = `<div class="empty-note">No TMDB ID matched yet — search TMDB right below and click the right film to load its posters.</div>`;
    } else if (payload?.error) {
      galleryHtml = `<div class="empty-note">${esc(payload.error)}</div>`;
    } else if (!filteredPosters.length) {
      galleryHtml = `<div class="empty-note">No posters match this language filter.</div>`;
    } else {
      galleryHtml = `
        <div class="poster-grid" id="posterGrid">
          ${filteredPosters
            .slice(0, 60)
            .map((p, idx) => {
              const isSelected = p.filePath === activePosterPath && (film.hasOverride || p.filePath === film.defaultPosterPath);
              const badge = p.lang ? p.lang.toUpperCase() : 'NO TEXT';
              const resLabel = p.width && p.height ? `${p.width}×${p.height}` : '';
              return `
                <button type="button" class="poster-card${isSelected ? ' is-selected' : ''}" data-path="${esc(p.filePath)}">
                  ${idx < 9 ? `<span class="poster-card-idx">${idx + 1}</span>` : ''}
                  <img src="https://image.tmdb.org/t/p/w342${esc(p.filePath)}" alt="" loading="lazy" />
                  <div class="poster-card-meta">
                    <span>${esc(badge)}</span>
                    <span>${esc(resLabel)}</span>
                  </div>
                </button>
              `;
            })
            .join('')}
        </div>
      `;
    }

    const rStr = formatCompactRating(film.rating);
    const shouldShowSearchBox = state.hasTmdbKey && (!film.tmdbId || state.showManualSearch);

    els.detailPane.innerHTML = `
      <div class="detail-hero">
        <img src="${esc(film.currentPosterUrl || PLACEHOLDER)}" alt="${esc(film.title)}" class="detail-current-poster" id="detailCurrentPoster" />
        <div class="detail-info">
          <h2 class="detail-title">${esc(film.title)}<span class="detail-year">${esc(film.year ?? '')}</span></h2>
          <div class="detail-sub">
            ${film.director ? `Directed by ${esc(film.director)} · ` : ''}${rStr ? `<span class="row-stars">${esc(rStr)}</span>${film.liked ? ' <span class="row-heart">♥</span>' : ''} · ` : ''}Key: <code>${esc(film.key)}</code>
          </div>
          <div class="detail-actions">
            <button type="button" class="btn" id="skipFilmBtn">Skip (Esc)</button>
            ${film.tmdbId && state.hasTmdbKey ? `<button type="button" class="btn" id="toggleManualSearchBtn">${state.showManualSearch ? 'Hide TMDB Search' : '⌕ Search Different TMDB Title'}</button>` : ''}
            ${film.hasOverride ? '<button type="button" class="btn btn-danger" id="resetOverrideBtn">Reset to Default (R)</button>' : ''}
          </div>
          <div class="shortcuts">Shortcuts: J/K or ↑/↓ navigate films · 1–9 pick poster · Esc skip · R reset</div>
        </div>
      </div>

      ${shouldShowSearchBox ? `
        <div class="extra-box" style="margin-top:0;margin-bottom:20px;">
          <div class="extra-box-title">Search TMDB (Movies &amp; TV)</div>
          <div class="url-row">
            <input type="text" id="tmdbTitleQuery" class="input" value="${esc(film.title)}" placeholder="Type movie or TV title…" />
            <button type="button" class="btn btn-push" id="tmdbTitleSearchBtn">Search TMDB</button>
          </div>
          <div id="tmdbSearchResults" class="search-results"></div>
        </div>
      ` : ''}

      <div class="gallery-head" id="galleryAnchor">
        <span class="gallery-title">
          Alternate Posters${state.manualMatchLabel ? ` · ${esc(state.manualMatchLabel)}` : ''}
        </span>
        ${langChipsHtml}
      </div>
      ${galleryHtml}

      <div class="extra-box">
        <div class="extra-box-title">Paste Custom Poster URL</div>
        <div class="url-row">
          <input type="url" id="customUrlInput" class="input" value="${esc(film.override?.url || '')}" placeholder="https://..." />
          <button type="button" class="btn btn-push" id="saveUrlBtn">Save URL</button>
        </div>
        <p class="warn-text">Note: non-TMDB hosts without CORS headers may block PNG share-card downloads.</p>
      </div>
    `;

    els.detailPane.querySelectorAll('.lang-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.langFilter = btn.dataset.lang;
        renderDetailShell(film, state.activePayload || payload, false);
      });
    });

    els.detailPane.querySelectorAll('.poster-card').forEach((card) => {
      card.addEventListener('click', () => savePosterPick(film, { posterPath: card.dataset.path }));
    });

    document.getElementById('skipFilmBtn')?.addEventListener('click', () => skipFilm(film));
    document.getElementById('resetOverrideBtn')?.addEventListener('click', () => resetOverride(film));
    document.getElementById('toggleManualSearchBtn')?.addEventListener('click', () => {
      state.showManualSearch = !state.showManualSearch;
      renderDetailShell(film, state.activePayload || payload, false);
    });
    document.getElementById('saveUrlBtn')?.addEventListener('click', () => {
      const url = document.getElementById('customUrlInput')?.value.trim();
      if (url) savePosterPick(film, { url });
    });

    document.getElementById('tmdbTitleSearchBtn')?.addEventListener('click', () => runUnmatchedSearch(film));
    document.getElementById('tmdbTitleQuery')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runUnmatchedSearch(film);
    });
  }

  async function runUnmatchedSearch(film) {
    const q = document.getElementById('tmdbTitleQuery')?.value.trim();
    const out = document.getElementById('tmdbSearchResults');
    if (!q || !out) return;
    out.innerHTML = '<div class="empty-note">Searching TMDB…</div>';
    try {
      const res = await fetch(`/api/tmdb/search?q=${encodeURIComponent(q)}&year=${encodeURIComponent(film.year || '')}`);
      const data = await res.json();
      const results = data.results || [];
      if (!results.length) {
        out.innerHTML = '<div class="empty-note">No TMDB matches found. Try shortening or translating the title.</div>';
        return;
      }
      out.innerHTML = results
        .map((r) => `
          <button type="button" class="search-result-btn" data-id="${r.tmdbId}" data-type="${esc(r.tmdbType)}" data-title="${esc(r.title)}" data-year="${esc(r.year || '')}">
            <img src="${r.posterPath ? `https://image.tmdb.org/t/p/w185${esc(r.posterPath)}` : PLACEHOLDER}" alt="" />
            <div style="min-width:0;flex:1">
              <div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.title)}</div>
              <div style="font-family:var(--mono);font-size:10.5px;color:var(--text-3)">${esc(r.year || '?')} · ${esc(r.tmdbType.toUpperCase())} #${r.tmdbId}</div>
            </div>
          </button>
        `)
        .join('');

      out.querySelectorAll('.search-result-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ttype = btn.dataset.type;
          const tid = btn.dataset.id;
          const label = `${btn.dataset.title}${btn.dataset.year ? ` (${btn.dataset.year})` : ''}`;

          state.langFilter = 'all';
          state.manualMatchLabel = label;
          renderDetailShell(film, null, true);

          try {
            const res2 = await fetch(`/api/tmdb/images?type=${encodeURIComponent(ttype)}&id=${encodeURIComponent(tid)}`);
            const payload = await res2.json();
            if (state.selectedKey !== film.key) return;
            state.activePayload = payload;
            renderDetailShell(film, payload, false);
            document.getElementById('galleryAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (err) {
            if (state.selectedKey !== film.key) return;
            renderDetailShell(film, { error: err.message || 'Failed to load posters' }, false);
          }
        });
      });
    } catch (err) {
      out.innerHTML = `<div class="empty-note">${esc(err.message)}</div>`;
    }
  }

  function findNextKey(currentKey, beforeList) {
    const idx = beforeList.findIndex((f) => f.key === currentKey);
    const afterList = getFilteredFilms();
    if (!afterList.length) return null;
    if (idx !== -1 && idx + 1 < beforeList.length) {
      const nextCandidate = beforeList[idx + 1].key;
      if (afterList.some((f) => f.key === nextCandidate)) return nextCandidate;
    }
    if (idx >= 0 && idx < afterList.length) return afterList[idx].key;
    return afterList[0].key;
  }

  async function savePosterPick(film, body) {
    const beforeList = getFilteredFilms();
    try {
      const res = await fetch(`/api/overrides/${encodeURIComponent(film.key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        showBanner(data.error || 'Failed to save override', 'err');
        return;
      }

      film.hasOverride = true;
      film.override = data.override;
      film.overrideKey = film.key;
      film.currentPosterUrl = data.currentPosterUrl;
      updateGitButtons(data.gitStatus);
      showToast(`Saved poster for "${film.title}"`);

      if (state.autoAdvance) {
        const nextKey = findNextKey(film.key, beforeList);
        if (nextKey) return selectFilm(nextKey);
      }
      renderFilmList();
      renderDetailShell(film, state.activePayload, false);
    } catch (err) {
      showBanner(err.message || 'Network error', 'err');
    }
  }

  async function resetOverride(film) {
    const deleteKey = film.overrideKey || film.key;
    try {
      const res = await fetch(
        `/api/overrides/${encodeURIComponent(deleteKey)}?fallback=${encodeURIComponent(film.fallbackKey || '')}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!data.ok) return;

      film.hasOverride = false;
      film.override = null;
      film.overrideKey = null;
      film.currentPosterUrl = film.defaultPosterUrl;
      updateGitButtons(data.gitStatus);
      showToast(`Reset "${film.title}" to default`);
      renderFilmList();
      renderDetailShell(film, state.activePayload, false);
    } catch (err) {
      showBanner(err.message || 'Reset failed', 'err');
    }
  }

  function skipFilm(film) {
    const beforeList = getFilteredFilms();
    saveReviewed(film.key);
    const nextKey = findNextKey(film.key, beforeList);
    if (nextKey) selectFilm(nextKey);
    else {
      renderFilmList();
      els.detailPane.innerHTML = '<div class="empty-state">All caught up in this queue!</div>';
    }
  }

  function stepSelection(delta) {
    const list = getFilteredFilms();
    if (!list.length) return;
    const idx = list.findIndex((f) => f.key === state.selectedKey);
    const nextIdx = idx === -1 ? 0 : Math.max(0, Math.min(list.length - 1, idx + delta));
    selectFilm(list[nextIdx].key);
  }

  // Event listeners
  els.autoAdvanceToggle.addEventListener('change', () => {
    state.autoAdvance = els.autoAdvanceToggle.checked;
    localStorage.setItem('poster_picker_autoadvance', String(state.autoAdvance));
  });

  els.queuePills.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    state.queue = btn.dataset.queue;
    els.queuePills.querySelectorAll('.pill').forEach((p) => p.classList.toggle('active', p === btn));
    const list = getFilteredFilms();
    if (list.length && !list.some((f) => f.key === state.selectedKey)) {
      selectFilm(list[0].key);
    } else {
      renderFilmList();
    }
  });

  els.filmSearch.addEventListener('input', () => {
    state.query = els.filmSearch.value;
    renderFilmList();
  });

  els.ratingFilter.addEventListener('change', () => {
    state.rating = els.ratingFilter.value;
    const list = getFilteredFilms();
    if (list.length && !list.some((f) => f.key === state.selectedKey)) {
      selectFilm(list[0].key);
    } else {
      renderFilmList();
    }
  });

  els.yearFilter.addEventListener('change', () => {
    state.year = els.yearFilter.value;
    const list = getFilteredFilms();
    if (list.length && !list.some((f) => f.key === state.selectedKey)) {
      selectFilm(list[0].key);
    } else {
      renderFilmList();
    }
  });

  els.sortFilter.addEventListener('change', () => {
    state.sort = els.sortFilter.value;
    renderFilmList();
  });

  els.statusBannerClose.addEventListener('click', () => {
    els.statusBanner.hidden = true;
  });

  els.pullBtn.addEventListener('click', async () => {
    if (state.busyGit) return;
    state.busyGit = true;
    els.pullBtn.disabled = true;
    els.pushBtn.disabled = true;
    showBanner('Pulling latest changes from GitHub…');
    try {
      const res = await fetch('/api/git/pull', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showBanner(data.message, 'ok');
        updateGitButtons(data.gitStatus);
        await loadFilms();
      } else {
        showBanner(data.error || 'Pull failed', 'err');
      }
    } catch (err) {
      showBanner(err.message || 'Pull failed', 'err');
    } finally {
      state.busyGit = false;
      els.pullBtn.disabled = false;
      els.pushBtn.disabled = false;
    }
  });

  els.pushBtn.addEventListener('click', async () => {
    if (state.busyGit) return;
    state.busyGit = true;
    els.pullBtn.disabled = true;
    els.pushBtn.disabled = true;
    showBanner('Committing overrides & pushing to GitHub…');
    try {
      const res = await fetch('/api/git/push', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showBanner(data.message, 'ok');
        updateGitButtons(data.gitStatus);
      } else {
        showBanner(data.error || 'Push failed', 'err');
      }
    } catch (err) {
      showBanner(err.message || 'Push failed', 'err');
    } finally {
      state.busyGit = false;
      els.pullBtn.disabled = false;
      els.pushBtn.disabled = false;
    }
  });

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const film = state.films.find((f) => f.key === state.selectedKey);
    if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepSelection(1);
    } else if (e.key === 'k' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      stepSelection(-1);
    } else if (e.key === 'Escape' && film) {
      skipFilm(film);
    } else if ((e.key === 'r' || e.key === 'R') && film && film.hasOverride) {
      resetOverride(film);
    } else if (/^[1-9]$/.test(e.key) && film) {
      const idx = Number(e.key) - 1;
      const card = document.querySelectorAll('#posterGrid .poster-card')[idx];
      if (card) savePosterPick(film, { posterPath: card.dataset.path });
    }
  });

  async function loadFilms() {
    const res = await fetch('/api/films');
    const data = await res.json();
    state.films = data.films || [];
    state.hasTmdbKey = Boolean(data.hasTmdbKey);
    populateYearSelect();
    const list = getFilteredFilms();
    if (state.selectedKey && state.films.some((f) => f.key === state.selectedKey)) {
      await selectFilm(state.selectedKey, false);
    } else if (list.length) {
      await selectFilm(list[0].key);
    } else {
      renderFilmList();
    }
  }

  Promise.all([loadFilms(), refreshGitStatus()]).catch((err) => {
    showBanner(err.message || 'Failed to initialize Poster Picker', 'err');
  });
})();
