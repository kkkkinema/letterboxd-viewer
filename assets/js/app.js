(() => {
	const PAGE_SIZE = 36;

	const state = {
		films: [],
		lists: [],
		recentReviews: [],
		heroIndex: 0,
		filter: 'all',
		year: 'all',
		month: 'all',
		rating: 'all',
		decade: 'all',
		sort: 'recent',
		view: localStorage.getItem('diary_view') || 'grid',
		query: '',
		displayLimit: PAGE_SIZE,
		visibleItems: [],
		activeIndex: -1,
		activeKind: 'film'
	};

	const els = {
		heroSection: document.getElementById('heroSection'),
		contentArea: document.getElementById('contentArea'),
		filterPills: document.getElementById('filterPills'),
		yearSelect: document.getElementById('yearSelect'),
		monthSelect: document.getElementById('monthSelect'),
		ratingSelect: document.getElementById('ratingSelect'),
		decadeSelect: document.getElementById('decadeSelect'),
		resetFiltersBtn: document.getElementById('resetFiltersBtn'),
		filterDrawerToggle: document.getElementById('filterDrawerToggle'),
		filterDrawer: document.getElementById('filterDrawer'),
		filterActiveBadge: document.getElementById('filterActiveBadge'),
		sortSelect: document.getElementById('sortSelect'),
		toolbarRight: document.getElementById('toolbarRight'),
		viewToggle: document.getElementById('viewToggle'),
		searchInput: document.getElementById('searchInput'),
		colophonStats: document.getElementById('colophonStats'),
		themeToggle: document.getElementById('themeToggle'),
		readerBackdrop: document.getElementById('readerBackdrop'),
		readerModal: document.getElementById('readerModal'),
		readerAside: document.getElementById('readerAside'),
		readerPoster: document.getElementById('readerPoster'),
		readerFacts: document.getElementById('readerFacts'),
		readerTitle: document.getElementById('readerTitle'),
		readerDirector: document.getElementById('readerDirector'),
		readerSubtitle: document.getElementById('readerSubtitle'),
		readerProse: document.getElementById('readerProse'),
		readerScroll: document.getElementById('readerScroll'),
		readerCounter: document.getElementById('readerCounter'),
		shareCardBtn: document.getElementById('shareCardBtn'),
		copyLinkBtn: document.getElementById('copyLinkBtn'),
		prevBtn: document.getElementById('prevBtn'),
		nextBtn: document.getElementById('nextBtn'),
		closeReaderBtn: document.getElementById('closeReaderBtn'),
		shareBackdrop: document.getElementById('shareBackdrop'),
		closeShareBtn: document.getElementById('closeShareBtn'),
		shareStyleToggle: document.getElementById('shareStyleToggle'),
		shareFormatToggle: document.getElementById('shareFormatToggle'),
		shareThemeToggle: document.getElementById('shareThemeToggle'),
		shareReviewBtn: document.getElementById('shareReviewBtn'),
		shareReviewIcon: document.getElementById('shareReviewIcon'),
		shareCanvas: document.getElementById('shareCanvas'),
		downloadCardBtn: document.getElementById('downloadCardBtn'),
		toastStack: document.getElementById('toastStack'),
		pwaTabbar: document.getElementById('pwaTabbar')
	};

	const shareState = {
		style: 'folio', // 'folio' | 'affiche' | 'index' | 'matte' | 'noir' | '35mm'
		format: 'card', // 'card' (1080x1350) | 'story' (1080x1920)
		theme: document.documentElement.getAttribute('data-theme') || 'dark',
		includeReview: true,
		film: null
	};

	// ── Theme ──
	const SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
	const MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

	function applyTheme(theme) {
		document.documentElement.setAttribute('data-theme', theme);
		localStorage.setItem('diary_theme', theme);
		if (els.themeToggle) {
			els.themeToggle.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
			els.themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
			els.themeToggle.setAttribute('aria-label', els.themeToggle.title);
		}
		const themeMeta = document.querySelector('meta[name="theme-color"]');
		if (themeMeta) {
			themeMeta.setAttribute('content', theme === 'dark' ? '#0c0c0e' : '#f5f2eb');
		}
	}

	const initialTheme = document.documentElement.getAttribute('data-theme') || 'dark';
	applyTheme(initialTheme);

	els.themeToggle?.addEventListener('click', () => {
		const current = document.documentElement.getAttribute('data-theme') || 'dark';
		applyTheme(current === 'dark' ? 'light' : 'dark');
	});

	// ── Helpers ──
	const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

	function formatStars(ratingNum) {
		if (!ratingNum || Number.isNaN(ratingNum)) return '';
		const full = Math.floor(ratingNum);
		const half = ratingNum % 1 >= 0.5 ? '½' : '';
		return '★'.repeat(full) + half;
	}

	function parseDateParts(isoDate) {
		if (!isoDate) return null;
		const [y, m, d] = isoDate.split('-').map(Number);
		if (!y || !m || !d) return null;
		return { y, m, d };
	}

	function formatShortDate(isoDate) {
		const p = parseDateParts(isoDate);
		return p ? `${MONTHS_SHORT[p.m - 1]} ${p.d}` : '';
	}

	function formatFullDate(isoDate) {
		const p = parseDateParts(isoDate);
		return p ? `${MONTHS_LONG[p.m - 1]} ${p.d}, ${p.y}` : '';
	}

	function formatMonthGroup(isoDate) {
		const p = parseDateParts(isoDate);
		return p ? `${MONTHS_LONG[p.m - 1]} ${p.y}` : 'Undated';
	}

	function escapeHtml(str) {
		return String(str ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function showToast(message, type = 'success') {
		const el = document.createElement('div');
		el.className = `toast ${type}`;
		el.textContent = message;
		els.toastStack.appendChild(el);
		setTimeout(() => {
			el.style.opacity = '0';
			el.style.transition = 'opacity 0.25s';
			setTimeout(() => el.remove(), 260);
		}, 3800);
	}

	// ── Hero Carousel (5 Latest Reviews, auto-advancing showcase) ──
	const HERO_AUTOPLAY_MS = 3000;
	const heroAuto = {
		timer: null,
		startedAt: 0,
		remaining: HERO_AUTOPLAY_MS,
		paused: false,
		hovered: false,
	};

	function stopHeroAutoplay() {
		if (heroAuto.timer) {
			clearTimeout(heroAuto.timer);
			heroAuto.timer = null;
		}
	}

	function shouldPauseHero() {
		const modalOpen = els.readerBackdrop?.classList.contains('open') || els.shareBackdrop?.classList.contains('open');
		return heroAuto.hovered || document.hidden || modalOpen || els.heroSection.hidden || state.recentReviews.length <= 1;
	}

	function syncHeroPauseClass() {
		const card = els.heroSection.querySelector('.hero-card');
		if (!card) return;
		card.classList.toggle('is-paused', heroAuto.paused);
		card.classList.toggle('is-static', state.recentReviews.length <= 1);
	}

	function scheduleHeroTick(resetDuration = false) {
		stopHeroAutoplay();
		if (resetDuration) heroAuto.remaining = HERO_AUTOPLAY_MS;
		if (shouldPauseHero()) {
			heroAuto.paused = true;
			syncHeroPauseClass();
			return;
		}
		heroAuto.paused = false;
		heroAuto.startedAt = Date.now();
		syncHeroPauseClass();
		heroAuto.timer = setTimeout(() => {
			if (shouldPauseHero()) {
				heroAuto.paused = true;
				syncHeroPauseClass();
				return;
			}
			const total = state.recentReviews.length;
			if (total > 1) {
				state.heroIndex = (state.heroIndex + 1) % total;
				renderHero(true);
			}
		}, Math.max(250, heroAuto.remaining));
	}

	function pauseHeroAutoplay() {
		if (!heroAuto.paused && heroAuto.timer) {
			heroAuto.remaining = Math.max(250, heroAuto.remaining - (Date.now() - heroAuto.startedAt));
		}
		stopHeroAutoplay();
		heroAuto.paused = true;
		syncHeroPauseClass();
	}

	function resumeHeroAutoplay() {
		if (!shouldPauseHero()) {
			scheduleHeroTick(false);
		}
	}

	// Bind hover pause once on the persistent heroSection so innerHTML swaps never orphan mouseleave
	els.heroSection?.addEventListener('pointerenter', (e) => {
		if (e.pointerType === 'mouse') {
			heroAuto.hovered = true;
			pauseHeroAutoplay();
		}
	});
	els.heroSection?.addEventListener('pointerleave', (e) => {
		if (e.pointerType === 'mouse') {
			heroAuto.hovered = false;
			resumeHeroAutoplay();
		}
	});

	document.addEventListener('visibilitychange', () => {
		if (document.hidden) pauseHeroAutoplay();
		else resumeHeroAutoplay();
	});

	function renderHero(animateSlide = false) {
		if (!state.recentReviews.length || state.query || state.filter === 'lists') {
			els.heroSection.hidden = true;
			stopHeroAutoplay();
			return;
		}
		els.heroSection.hidden = false;

		const total = state.recentReviews.length;
		const idx = ((state.heroIndex % total) + total) % total;
		state.heroIndex = idx;
		const featured = state.recentReviews[idx];

		const yearHtml = featured.year ? `<span class="hero-year">${featured.year}</span>` : '';
		const starsHtml = featured.stars ? `<span class="stars" aria-label="${featured.rating} out of 5 stars">${featured.stars}</span>` : '';
		const heartHtml = featured.liked ? `<span class="heart-icon" title="Liked">♥</span>` : '';
		const spoilerBadge = featured.hasSpoilers ? `<span class="inline-badge is-spoiler">Spoilers</span>` : '';
		const dateStr = featured.watchedDate ? `Watched ${formatFullDate(featured.watchedDate)}` : '';

		const dotsHtml = total > 1
			? `<div class="hero-carousel-controls">
					<button type="button" class="icon-btn" id="heroPrevBtn" aria-label="Previous review" style="width:28px;height:28px;">←</button>
					<div class="hero-dots">
						${state.recentReviews.map((_, i) => `<button type="button" class="hero-dot ${i === idx ? 'active' : ''}" data-hero-dot="${i}" aria-label="Show review ${i + 1}"></button>`).join('')}
					</div>
					<button type="button" class="icon-btn" id="heroNextBtn" aria-label="Next review" style="width:28px;height:28px;">→</button>
				</div>`
			: '';

		const excerptHtml = featured.hasSpoilers
			? `<p class="hero-excerpt is-spoiler" aria-hidden="true">${escapeHtml(featured.plainText)}</p>`
			: `<p class="hero-excerpt">${escapeHtml(featured.plainText)}</p>`;

		const slideClass = animateSlide ? ' hero-slide-enter' : '';

		els.heroSection.innerHTML = `
			<article class="hero-card" style="--hero-duration:${HERO_AUTOPLAY_MS}ms;">
				<div class="hero-copy${slideClass}">
					<div class="hero-top-row">
						<div class="hero-eyebrow">Latest Reviews · ${idx + 1} of ${total}</div>
						${dotsHtml}
					</div>
					<h2 class="hero-title">${escapeHtml(featured.title)}${yearHtml}</h2>
					${featured.director ? `<p class="hero-director">Directed by ${escapeHtml(featured.director)}</p>` : ''}
					<div class="hero-rating-row">
						${starsHtml}
						${heartHtml}
						${spoilerBadge}
						${dateStr ? `<span class="hero-date">${escapeHtml(dateStr)}</span>` : ''}
					</div>
					${excerptHtml}
					<div class="hero-cta-row">
						<button type="button" class="btn-primary" id="heroReadBtn">${featured.hasSpoilers ? 'Open review (spoilers) →' : 'Read full review →'}</button>
					</div>
				</div>
				<div class="hero-poster-wrap${slideClass}" id="heroPosterTrigger">
					<img src="${escapeHtml(featured.full)}" onerror="this.src='${escapeHtml(featured.thumb)}'" alt="${escapeHtml(featured.title)} poster" class="hero-poster" />
				</div>
			</article>
		`;

		const openFeatured = () => {
			pauseHeroAutoplay();
			const matchIdx = state.visibleItems.findIndex(item => item.id === featured.id);
			if (matchIdx !== -1 && state.activeKind === 'film') {
				openReader(matchIdx, 'film');
			} else {
				state.visibleItems = state.recentReviews;
				openReader(idx, 'film');
			}
		};

		document.getElementById('heroReadBtn')?.addEventListener('click', openFeatured);
		document.getElementById('heroPosterTrigger')?.addEventListener('click', openFeatured);
		document.getElementById('heroPrevBtn')?.addEventListener('click', () => {
			state.heroIndex = (state.heroIndex - 1 + total) % total;
			renderHero(true);
		});
		document.getElementById('heroNextBtn')?.addEventListener('click', () => {
			state.heroIndex = (state.heroIndex + 1) % total;
			renderHero(true);
		});
		els.heroSection.querySelectorAll('[data-hero-dot]').forEach(dot => {
			dot.addEventListener('click', () => {
				state.heroIndex = Number(dot.dataset.heroDot);
				renderHero(true);
			});
		});

		scheduleHeroTick(true);
	}

	// ── Stats & Counts ──
	function updateCounts() {
		document.getElementById('countAll').textContent = state.films.length;
		document.getElementById('countReviews').textContent = state.films.filter(f => f.isReview).length;
		document.getElementById('countLiked').textContent = state.films.filter(f => f.liked).length;
		document.getElementById('countTop').textContent = state.films.filter(f => (f.rating || 0) >= 4).length;
		document.getElementById('countRewatch').textContent = state.films.filter(f => f.rewatch).length;
		const countListsEl = document.getElementById('countLists');
		if (countListsEl) countListsEl.textContent = state.lists.length;

		const rated = state.films.filter(f => typeof f.rating === 'number' && !Number.isNaN(f.rating));
		const avg = rated.length ? (rated.reduce((s, f) => s + f.rating, 0) / rated.length).toFixed(2) : '—';
		const reviews = state.films.filter(f => f.isReview).length;
		els.colophonStats.innerHTML = `
			<span><strong>${state.films.length}</strong> films logged</span>
			<span><strong>${reviews}</strong> reviews</span>
			<span><strong>${avg}★</strong> avg rating</span>
		`;
	}

	function getFilteredFilms() {
		const q = state.query.trim().toLowerCase();
		let list = state.films.filter(f => {
			if (state.filter === 'reviews' && !f.isReview) return false;
			if (state.filter === 'liked' && !f.liked) return false;
			if (state.filter === 'top' && (f.rating || 0) < 4) return false;
			if (state.filter === 'rewatch' && !f.rewatch) return false;
			if (state.year !== 'all') {
				const watchedYear = (f.watchedDate || '').slice(0, 4);
				if (watchedYear !== state.year) return false;
			}
			if (state.month !== 'all') {
				const watchedMonth = (f.watchedDate || '').slice(5, 7);
				if (watchedMonth !== state.month) return false;
			}
			if (state.rating !== 'all') {
				if (state.rating === 'unrated') {
					if (f.rating != null) return false;
				} else if (f.rating !== Number(state.rating)) {
					return false;
				}
			}
			if (state.decade !== 'all') {
				const dec = f.year ? `${Math.floor(f.year / 10) * 10}s` : '';
				if (dec !== state.decade) return false;
			}
			if (q && !f._search.includes(q)) return false;
			return true;
		});

		list = [...list];
		switch (state.sort) {
			case 'rating-desc':
				list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.order - b.order);
				break;
			case 'year-desc':
				list.sort((a, b) => (b.year || 0) - (a.year || 0) || a.order - b.order);
				break;
			case 'year-asc':
				list.sort((a, b) => (a.year || 9999) - (b.year || 9999) || a.order - b.order);
				break;
			case 'title-asc':
				list.sort((a, b) => a.title.localeCompare(b.title));
				break;
			default:
				list.sort((a, b) => a.order - b.order);
		}
		return list;
	}

	function syncViewButtons() {
		els.viewToggle?.querySelectorAll('.view-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.view === state.view);
		});
		els.pwaTabbar?.querySelectorAll('.pwa-tab[data-pwa-action="grid"], .pwa-tab[data-pwa-action="diary"]').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.pwaAction === state.view);
		});
	}

	function bindCardClicks(selector, kind) {
		els.contentArea.querySelectorAll(selector).forEach(el => {
			const idx = Number(el.dataset.idx);
			el.addEventListener('click', () => openReader(idx, kind));
			el.addEventListener('keydown', e => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					openReader(idx, kind);
				}
			});
		});
	}

	function renderContent() {
		renderHero();
		syncViewButtons();

		const drawerFilterCount =
			(state.year !== 'all' ? 1 : 0) +
			(state.month !== 'all' ? 1 : 0) +
			(state.rating !== 'all' ? 1 : 0) +
			(state.decade !== 'all' ? 1 : 0) +
			(state.sort !== 'recent' ? 1 : 0);

		const hasActiveFilters =
			state.filter !== 'all' ||
			drawerFilterCount > 0 ||
			state.query.trim() !== '';

		if (els.resetFiltersBtn) els.resetFiltersBtn.hidden = !hasActiveFilters;
		if (els.filterActiveBadge) {
			els.filterActiveBadge.textContent = String(drawerFilterCount);
			els.filterActiveBadge.hidden = drawerFilterCount === 0;
		}
		els.filterDrawerToggle?.classList.toggle('has-active', drawerFilterCount > 0);

		if (state.filter === 'lists') {
			els.toolbarRight.style.display = 'none';
			const q = state.query.trim().toLowerCase();
			const lists = state.lists.filter(l => !q || `${l.title} ${l.plainText}`.toLowerCase().includes(q));
			state.visibleItems = lists;
			state.activeKind = 'list';

			if (!lists.length) {
				els.contentArea.innerHTML = `<div class="state-box">No lists match “${escapeHtml(state.query)}”.</div>`;
				return;
			}

			els.contentArea.innerHTML = `<div class="lists-grid">${lists.map((l, i) => `
				<article class="list-card" data-idx="${i}" tabindex="0">
					<div>
						<div class="list-card-label">Curated List</div>
						<h3 class="list-card-title">${escapeHtml(l.title)}</h3>
						<p class="list-card-preview">${escapeHtml(l.plainText)}</p>
					</div>
					<div class="list-card-footer">
						<span>Read list →</span>
					</div>
				</article>
			`).join('')}</div>`;

			bindCardClicks('.list-card', 'list');
			return;
		}

		els.toolbarRight.style.display = '';
		const films = getFilteredFilms();
		state.visibleItems = films;
		state.activeKind = 'film';

		if (!films.length) {
			els.contentArea.innerHTML = `<div class="state-box">No films found matching your current filter.</div>`;
			return;
		}

		const slice = films.slice(0, state.displayLimit);
		const hasMore = slice.length < films.length;
		const loadMoreHtml = hasMore
			? `<div class="load-more-wrap">
					<button type="button" class="btn-ghost" id="loadMoreBtn" style="padding: 0.62rem 1.45rem; font-size: 0.82rem;">Load more films</button>
					<span class="load-more-meta">Showing ${slice.length.toLocaleString()} of ${films.length.toLocaleString()} films</span>
				</div>`
			: '';

		if (state.view === 'diary') {
			const groups = new Map();
			slice.forEach((f, idx) => {
				const key = state.sort === 'recent' ? formatMonthGroup(f.watchedDate) : 'Matching Films';
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push({ film: f, idx });
			});

			let html = '<div class="diary-list">';
			for (const [monthLabel, entries] of groups.entries()) {
				html += `<section>
					<h3 class="diary-month-heading">
						<span>${escapeHtml(monthLabel)}</span>
						<span class="diary-month-count">${entries.length} ${entries.length === 1 ? 'film' : 'films'}</span>
					</h3>
					${entries.map(({ film: f, idx }) => {
						const p = parseDateParts(f.watchedDate);
						const dayNum = p ? String(p.d).padStart(2, '0') : '—';
						const dayMon = p ? MONTHS_SHORT[p.m - 1] : '';
						const snippet = f.isReview
							? (f.hasSpoilers
								? `<p class="diary-snippet is-spoiler">Review contains spoilers — open to read.</p>`
								: `<p class="diary-snippet">${escapeHtml(f.plainText)}</p>`)
							: '';
						const thumbHtml = f.thumb
							? `<img src="${escapeHtml(f.thumb)}" alt="${escapeHtml(f.title)} poster" class="diary-thumb" loading="lazy" decoding="async" />`
							: `<div class="diary-thumb-typo" aria-hidden="true">${escapeHtml((f.title || '?')[0])}</div>`;
						return `
							<article class="diary-row" data-idx="${idx}" tabindex="0">
								<div class="diary-day">
									<span class="diary-day-num">${dayNum}</span>
									<span class="diary-day-mon">${dayMon}</span>
								</div>
								${thumbHtml}
								<div class="diary-main">
									<div class="diary-title-line">
										<h4 class="diary-title">${escapeHtml(f.title)}</h4>
										${f.year ? `<span class="diary-year">${f.year}</span>` : ''}
										${f.director ? `<span class="diary-year">· ${escapeHtml(f.director)}</span>` : ''}
										${f.isReview ? '<span class="inline-badge is-gold">Review</span>' : ''}
										${f.hasSpoilers ? '<span class="inline-badge is-spoiler">Spoilers</span>' : ''}
										${f.rewatch ? '<span class="inline-badge">↻ Rewatch</span>' : ''}
									</div>
									${snippet}
								</div>
								<div class="diary-right">
									${f.stars ? `<span class="card-stars">${f.stars}</span>` : '<span class="card-unrated">Logged</span>'}
									${f.liked ? '<span class="heart-icon" title="Liked">♥</span>' : ''}
								</div>
							</article>
						`;
					}).join('')}
				</section>`;
			}
			html += '</div>' + loadMoreHtml;
			els.contentArea.innerHTML = html;
			bindCardClicks('.diary-row', 'film');
			document.getElementById('loadMoreBtn')?.addEventListener('click', () => {
				state.displayLimit += PAGE_SIZE;
				renderContent();
			});
			return;
		}

		// Poster Grid View (grouped by month when sorted by Recently Watched)
		const renderGridCard = (f, i) => `
			<article class="film-card" data-idx="${i}" tabindex="0" aria-label="${escapeHtml(f.title)}">
				<div class="poster-frame">
					${f.thumb
						? `<img src="${escapeHtml(f.thumb)}" alt="${escapeHtml(f.title)} poster" loading="lazy" decoding="async" />`
						: `<div class="poster-typographic">
								<span class="poster-typo-year">${f.year || 'FILM'}</span>
								<span class="poster-typo-title">${escapeHtml(f.title)}</span>
								<span class="poster-typo-foot">${f.stars || 'LOGGED'}</span>
							</div>`
					}
					<div class="poster-badges">
						${f.isReview ? '<span class="badge badge-review" title="Written review">Review</span>' : ''}
						${f.hasSpoilers ? '<span class="badge badge-spoiler" title="Contains spoilers">Spoiler</span>' : ''}
						${f.rewatch ? '<span class="badge badge-rewatch" title="Rewatch">↻</span>' : ''}
						${f.liked ? '<span class="badge badge-like" title="Liked">♥</span>' : ''}
					</div>
				</div>
				<div class="card-body">
					<h3 class="card-title">${escapeHtml(f.title)}</h3>
					${f.director ? `<div class="card-director">${escapeHtml(f.director)}</div>` : ''}
					<div class="card-meta-row">
						<span>${f.year || '—'}</span>
						<span>${escapeHtml(formatShortDate(f.watchedDate))}</span>
					</div>
					<div class="card-rating-row">
						${f.stars
							? `<span class="card-stars" aria-label="${f.rating} stars">${f.stars}</span>`
							: `<span class="card-unrated">Logged</span>`
						}
					</div>
				</div>
			</article>
		`;

		if (state.sort === 'recent') {
			const groups = new Map();
			slice.forEach((f, idx) => {
				const key = formatMonthGroup(f.watchedDate);
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push({ film: f, idx });
			});

			let html = '<div class="grid-month-groups">';
			for (const [monthLabel, entries] of groups.entries()) {
				html += `<section class="grid-month-section">
					<h3 class="diary-month-heading">
						<span>${escapeHtml(monthLabel)}</span>
						<span class="diary-month-count">${entries.length} ${entries.length === 1 ? 'film' : 'films'}</span>
					</h3>
					<div class="film-grid">${entries.map(({ film, idx }) => renderGridCard(film, idx)).join('')}</div>
				</section>`;
			}
			html += '</div>' + loadMoreHtml;
			els.contentArea.innerHTML = html;
		} else {
			els.contentArea.innerHTML = `<div class="film-grid">${slice.map((f, i) => renderGridCard(f, i)).join('')}</div>${loadMoreHtml}`;
		}

		bindCardClicks('.film-card', 'film');
		document.getElementById('loadMoreBtn')?.addEventListener('click', () => {
			state.displayLimit += PAGE_SIZE;
			renderContent();
		});
	}

	// ── Split-Screen Reader Modal + URL Hash ──
	function openReader(index, kind, pushHash = true) {
		if (index < 0 || index >= state.visibleItems.length) return;
		state.activeIndex = index;
		state.activeKind = kind;
		const item = state.visibleItems[index];

		els.readerCounter.textContent = `${index + 1} / ${state.visibleItems.length}`;
		els.prevBtn.disabled = index === 0;
		els.nextBtn.disabled = index === state.visibleItems.length - 1;
		els.readerScroll.scrollTop = 0;

		if (kind === 'list') {
			els.readerModal.classList.add('is-list-modal');
			els.readerAside.style.display = 'none';
			els.shareCardBtn.style.display = 'none';
			els.readerTitle.textContent = item.title;
			els.readerDirector.hidden = true;
			els.readerSubtitle.innerHTML = `<span class="inline-badge is-gold">Curated List</span>`;
			els.readerProse.innerHTML = item.descriptionHtml || '<p class="reader-log-note">No list notes available.</p>';
		} else {
			els.readerModal.classList.remove('is-list-modal');
			els.readerAside.style.display = '';
			els.shareCardBtn.style.display = '';
			if (item.full || item.thumb) {
				els.readerPoster.style.display = '';
				els.readerPoster.src = item.full || item.thumb;
				els.readerPoster.alt = `${item.title} poster`;
				els.readerPoster.onerror = () => {
					if (item.thumb && els.readerPoster.src !== item.thumb) {
						els.readerPoster.src = item.thumb;
					} else {
						els.readerPoster.style.display = 'none';
					}
				};
			} else {
				els.readerPoster.style.display = 'none';
				els.readerPoster.removeAttribute('src');
			}

			els.readerFacts.innerHTML = `
				${item.director ? `<div class="fact-row"><span class="fact-label">Director</span><span style="text-align:right">${escapeHtml(item.director)}</span></div>` : ''}
				<div class="fact-row"><span class="fact-label">Watched</span><span>${escapeHtml(formatFullDate(item.watchedDate) || '—')}</span></div>
				<div class="fact-row"><span class="fact-label">Released</span><span>${item.year || '—'}</span></div>
				<div class="fact-row"><span class="fact-label">Rating</span><span style="color:var(--green)">${item.stars || 'Unrated'}</span></div>
				${item.liked ? '<div class="fact-row"><span class="fact-label">Status</span><span style="color:var(--coral)">♥ Liked</span></div>' : ''}
				${item.rewatch ? '<div class="fact-row"><span class="fact-label">Viewing</span><span>↻ Rewatch</span></div>' : ''}
			`;

			els.readerTitle.textContent = item.title;
			if (item.director) {
				els.readerDirector.textContent = `Directed by ${item.director}`;
				els.readerDirector.hidden = false;
			} else {
				els.readerDirector.hidden = true;
			}
			els.readerSubtitle.innerHTML = `
				${item.stars ? `<span class="stars">${item.stars}</span>` : '<span class="card-unrated">Logged</span>'}
				${item.liked ? '<span class="heart-icon">♥</span>' : ''}
				${item.isReview ? '<span class="inline-badge is-gold">Review</span>' : ''}
				${item.hasSpoilers ? '<span class="inline-badge is-spoiler">Contains Spoilers</span>' : ''}
				${item.watchedDate ? `<span class="hero-date">${escapeHtml(formatFullDate(item.watchedDate))}</span>` : ''}
			`;

			if (item.isReview) {
				if (item.hasSpoilers) {
					els.readerProse.innerHTML = `
						<div class="spoiler-box" id="spoilerBox">
							<div class="spoiler-content">${item.descriptionHtml}</div>
							<div class="spoiler-overlay">
								<span class="spoiler-label">Spoiler Warning</span>
								<button type="button" class="btn-primary" id="revealSpoilerBtn">Reveal Review</button>
							</div>
						</div>
					`;
					document.getElementById('revealSpoilerBtn')?.addEventListener('click', () => {
						document.getElementById('spoilerBox')?.classList.add('revealed');
					});
				} else {
					els.readerProse.innerHTML = item.descriptionHtml;
				}
			} else {
				els.readerProse.innerHTML = `<p class="reader-log-note">${escapeHtml(item.plainText || 'Logged without a written review.')}</p>`;
			}
		}

		els.readerBackdrop.classList.add('open');
		document.body.classList.add('modal-open');

		if (pushHash && item.slug) {
			const targetHash = `#${item.slug}`;
			if (window.location.hash !== targetHash) {
				history.pushState({ modal: true }, '', targetHash);
			}
		}
	}

	function closeReader(updateHistory = true) {
		if (!els.readerBackdrop.classList.contains('open')) return;
		els.readerBackdrop.classList.remove('open');
		document.body.classList.remove('modal-open');
		if (updateHistory && window.location.hash) {
			history.replaceState(null, '', window.location.pathname + window.location.search);
		}
		resumeHeroAutoplay();
	}

	function openFromHash() {
		const slug = window.location.hash.replace(/^#/, '').trim();
		if (!slug) {
			closeReader(false);
			return;
		}
		const filmIdx = state.films.findIndex(f => f.slug === slug);
		if (filmIdx !== -1) {
			state.visibleItems = state.films;
			openReader(filmIdx, 'film', false);
			return;
		}
		const listIdx = state.lists.findIndex(l => l.slug === slug);
		if (listIdx !== -1) {
			state.visibleItems = state.lists;
			openReader(listIdx, 'list', false);
		}
	}

	// ── Events ──
	els.filterPills.addEventListener('click', e => {
		const pill = e.target.closest('.pill');
		if (!pill) return;
		els.filterPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
		pill.classList.add('active');
		state.filter = pill.dataset.filter;
		state.displayLimit = PAGE_SIZE;
		renderContent();
	});

	els.viewToggle?.addEventListener('click', e => {
		const btn = e.target.closest('.view-btn');
		if (!btn) return;
		state.view = btn.dataset.view;
		localStorage.setItem('diary_view', state.view);
		renderContent();
	});

	function resetAllFilters() {
		state.filter = 'all';
		state.year = 'all';
		state.month = 'all';
		state.rating = 'all';
		state.decade = 'all';
		state.sort = 'recent';
		state.query = '';
		state.displayLimit = PAGE_SIZE;
		els.searchInput.value = '';
		if (els.yearSelect) els.yearSelect.value = 'all';
		if (els.monthSelect) els.monthSelect.value = 'all';
		if (els.ratingSelect) els.ratingSelect.value = 'all';
		if (els.decadeSelect) els.decadeSelect.value = 'all';
		if (els.sortSelect) els.sortSelect.value = 'recent';
		els.filterPills.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p.dataset.filter === 'all'));
		renderContent();
	}

	els.filterDrawerToggle?.addEventListener('click', () => {
		if (!els.filterDrawer) return;
		const isOpen = !els.filterDrawer.hidden;
		els.filterDrawer.hidden = isOpen;
		els.filterDrawerToggle.setAttribute('aria-expanded', String(!isOpen));
	});

	els.yearSelect?.addEventListener('change', () => {
		state.year = els.yearSelect.value;
		state.displayLimit = PAGE_SIZE;
		renderContent();
	});

	els.monthSelect?.addEventListener('change', () => {
		state.month = els.monthSelect.value;
		state.displayLimit = PAGE_SIZE;
		renderContent();
	});

	els.ratingSelect?.addEventListener('change', () => {
		state.rating = els.ratingSelect.value;
		state.displayLimit = PAGE_SIZE;
		renderContent();
	});

	els.decadeSelect?.addEventListener('change', () => {
		state.decade = els.decadeSelect.value;
		state.displayLimit = PAGE_SIZE;
		renderContent();
	});

	els.resetFiltersBtn?.addEventListener('click', resetAllFilters);

	els.sortSelect.addEventListener('change', () => {
		state.sort = els.sortSelect.value;
		state.displayLimit = PAGE_SIZE;
		renderContent();
	});

	let searchTimer = null;
	els.searchInput.addEventListener('input', () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			state.query = els.searchInput.value;
			state.displayLimit = PAGE_SIZE;
			renderContent();
		}, 150);
	});

	document.getElementById('brandHome').addEventListener('click', e => {
		e.preventDefault();
		resetAllFilters();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	});

	els.closeReaderBtn.addEventListener('click', () => closeReader(true));
	els.readerBackdrop.addEventListener('click', e => {
		if (e.target === els.readerBackdrop) closeReader(true);
	});
	els.prevBtn.addEventListener('click', () => openReader(state.activeIndex - 1, state.activeKind));
	els.nextBtn.addEventListener('click', () => openReader(state.activeIndex + 1, state.activeKind));

	els.copyLinkBtn.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(window.location.href);
			showToast('Direct link copied to clipboard', 'success');
		} catch {
			showToast('Copy the URL from your address bar', 'error');
		}
	});

	window.addEventListener('hashchange', openFromHash);

	// ── Shareable Review / Diary Image Card (Canvas PNG Export) ──
	function wrapCanvasText(ctx, text, maxWidth, maxLines) {
		const words = text.split(/\s+/).filter(Boolean);
		const lines = [];
		let current = '';
		for (let i = 0; i < words.length; i++) {
			const candidate = current ? `${current} ${words[i]}` : words[i];
			if (ctx.measureText(candidate).width <= maxWidth) {
				current = candidate;
			} else {
				if (current) lines.push(current);
				current = words[i];
				if (lines.length === maxLines - 1) {
					// Pack remaining words on last line with ellipsis if needed
					let rest = [current, ...words.slice(i + 1)].join(' ');
					while (rest.length > 0 && ctx.measureText(rest + '…').width > maxWidth) {
						rest = rest.replace(/\s+\S*$/, '') || rest.slice(0, -1);
					}
					lines.push(rest + (i < words.length - 1 ? '…' : ''));
					return lines;
				}
			}
		}
		if (current && lines.length < maxLines) lines.push(current);
		return lines;
	}

	function drawRoundedRect(ctx, x, y, w, h, r) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	const canvasImageCache = new Map();

	async function loadImage(src) {
		if (!src) throw new Error('No src');
		if (canvasImageCache.has(src)) return canvasImageCache.get(src);

		const loadFromUrl = (url, useCors) => new Promise((resolve, reject) => {
			const img = new Image();
			if (useCors) img.crossOrigin = 'anonymous';
			img.onload = () => resolve(img);
			img.onerror = reject;
			img.src = url;
		});

		let img = null;
		if (/^https?:\/\//i.test(src)) {
			// Fetch as CORS blob first to bypass any non-CORS browser HTTP cache entry from normal <img> tags
			try {
				const res = await fetch(src, { mode: 'cors', credentials: 'omit', cache: 'reload' });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const blob = await res.blob();
				const objUrl = URL.createObjectURL(blob);
				img = await loadFromUrl(objUrl, false);
			} catch {
				const sep = src.includes('?') ? '&' : '?';
				img = await loadFromUrl(`${src}${sep}cors=1`, true);
			}
		} else {
			img = await loadFromUrl(src, false);
		}

		if (canvasImageCache.size > 40) {
			const firstKey = canvasImageCache.keys().next().value;
			canvasImageCache.delete(firstKey);
		}
		canvasImageCache.set(src, img);
		return img;
	}

	function drawPosterOrSleeve(ctx, posterImg, film, x, y, w, h, r, palette, isLight) {
		if (posterImg) {
			ctx.save();
			ctx.shadowColor = isLight ? 'rgba(23,22,20,0.22)' : 'rgba(0,0,0,0.65)';
			ctx.shadowBlur = 46;
			ctx.shadowOffsetY = 20;
			drawRoundedRect(ctx, x, y, w, h, r);
			ctx.fillStyle = palette.card;
			ctx.fill();
			ctx.restore();

			ctx.save();
			drawRoundedRect(ctx, x, y, w, h, r);
			ctx.clip();
			ctx.drawImage(posterImg, x, y, w, h);
			ctx.restore();

			ctx.strokeStyle = palette.border;
			ctx.lineWidth = 2;
			drawRoundedRect(ctx, x, y, w, h, r);
			ctx.stroke();
		} else {
			drawRoundedRect(ctx, x, y, w, h, r);
			ctx.fillStyle = palette.card;
			ctx.fill();
			ctx.strokeStyle = palette.border;
			ctx.lineWidth = 2;
			ctx.stroke();

			drawRoundedRect(ctx, x + 16, y + 16, w - 32, h - 32, Math.max(4, r - 6));
			ctx.stroke();

			ctx.textAlign = 'center';
			ctx.fillStyle = palette.muted;
			ctx.font = '500 22px "JetBrains Mono", monospace';
			ctx.fillText(String(film.year || 'FILM'), x + w / 2, y + 68);

			ctx.fillStyle = palette.ink;
			ctx.font = '500 36px "Newsreader", Georgia, serif';
			const sleeveLines = wrapCanvasText(ctx, film.title, w - 64, 4);
			let sy = y + h / 2 - ((sleeveLines.length - 1) * 22);
			for (const sl of sleeveLines) {
				ctx.fillText(sl, x + w / 2, sy);
				sy += 46;
			}
		}
	}

	function drawCenteredMetaRow(ctx, film, cx, y, palette) {
		const metaParts = [];
		if (film.year) metaParts.push({ text: String(film.year), color: palette.muted, font: '400 28px "JetBrains Mono", monospace' });
		if (film.stars) metaParts.push({ text: film.stars, color: palette.green, font: '600 38px "Plus Jakarta Sans", sans-serif' });
		if (film.liked) metaParts.push({ text: '♥', color: palette.coral, font: '600 34px "Plus Jakarta Sans", sans-serif' });
		if (film.rewatch) metaParts.push({ text: '↻', color: palette.muted, font: '500 30px "Plus Jakarta Sans", sans-serif' });
		if (!metaParts.length) return false;

		const gap = 24;
		const widths = metaParts.map(p => { ctx.font = p.font; return ctx.measureText(p.text).width; });
		const totalW = widths.reduce((a, b) => a + b, 0) + gap * (metaParts.length - 1);
		let mx = cx - totalW / 2;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		metaParts.forEach((p, idx) => {
			ctx.font = p.font;
			ctx.fillStyle = p.color;
			ctx.fillText(p.text, mx, y);
			mx += widths[idx] + gap;
		});
		return true;
	}

	async function renderShareCard() {
		const film = shareState.film;
		if (!film || !window.__EDITORIAL_SHARE_CARDS__) return;

		if (document.fonts && document.fonts.ready) {
			await document.fonts.ready;
		}

		const isStory = shareState.format === 'story';
		const style = shareState.style;
		const isLight = shareState.theme === 'light';
		const showReview = Boolean(shareState.includeReview && film.isReview && !film.hasSpoilers && film.plainText);
		const W = 1080;
		const H = isStory ? 1920 : 1350;
		const canvas = els.shareCanvas;
		canvas.width = W;
		canvas.height = H;
		const ctx = canvas.getContext('2d');

		const loadSafe = async (urls) => {
			for (const u of urls) {
				if (!u) continue;
				try { return await loadImage(u); } catch { /* try next */ }
			}
			return null;
		};

		const [posterImg, backdropImg] = await Promise.all([
			loadSafe([film.full, film.thumb]),
			film.backdrop ? loadSafe([film.backdrop]) : Promise.resolve(null)
		]);

		await window.__EDITORIAL_SHARE_CARDS__.renderEditorialCard({
			ctx, W, H, film, style, isStory, isLight, showReview, posterImg, backdropImg, formatDate: formatFullDate
		});
	}

	function syncReviewButton(canShowReview) {
		els.shareReviewBtn.disabled = !canShowReview;
		els.shareReviewBtn.classList.toggle('is-disabled', !canShowReview);
		els.shareReviewBtn.classList.toggle('active', canShowReview && shareState.includeReview);
		els.shareReviewBtn.setAttribute('aria-pressed', String(canShowReview && shareState.includeReview));
		els.shareReviewIcon.textContent = (canShowReview && shareState.includeReview) ? '✓' : '＋';
		els.shareReviewBtn.title = canShowReview
			? 'Toggle review text on card'
			: (shareState.film?.hasSpoilers ? 'Hidden on card (contains spoilers)' : 'No written review for this entry');
	}

	function openShareModal() {
		if (state.activeKind !== 'film' || state.activeIndex < 0) return;
		const film = state.visibleItems[state.activeIndex];
		shareState.film = film;
		shareState.theme = document.documentElement.getAttribute('data-theme') || 'dark';
		const canShowReview = Boolean(film.isReview && !film.hasSpoilers && film.plainText);
		shareState.includeReview = canShowReview;
		syncReviewButton(canShowReview);

		els.shareStyleToggle.querySelectorAll('.view-btn').forEach(b => {
			b.classList.toggle('active', b.dataset.style === shareState.style);
		});
		els.shareThemeToggle.querySelectorAll('.view-btn').forEach(b => {
			b.classList.toggle('active', b.dataset.cardTheme === shareState.theme);
		});
		els.shareFormatToggle.querySelectorAll('.view-btn').forEach(b => {
			b.classList.toggle('active', b.dataset.format === shareState.format);
		});
		els.shareBackdrop.classList.add('open');
		renderShareCard();
	}

	function closeShareModal() {
		els.shareBackdrop.classList.remove('open');
		resumeHeroAutoplay();
	}

	els.shareCardBtn?.addEventListener('click', openShareModal);
	els.closeShareBtn?.addEventListener('click', closeShareModal);
	els.shareBackdrop?.addEventListener('click', e => {
		if (e.target === els.shareBackdrop) closeShareModal();
	});

	els.shareStyleToggle?.addEventListener('click', e => {
		const btn = e.target.closest('.view-btn');
		if (!btn) return;
		shareState.style = btn.dataset.style;
		els.shareStyleToggle.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b === btn));
		renderShareCard();
	});

	els.shareFormatToggle?.addEventListener('click', e => {
		const btn = e.target.closest('.view-btn');
		if (!btn) return;
		shareState.format = btn.dataset.format;
		els.shareFormatToggle.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b === btn));
		renderShareCard();
	});

	els.shareThemeToggle?.addEventListener('click', e => {
		const btn = e.target.closest('.view-btn');
		if (!btn) return;
		shareState.theme = btn.dataset.cardTheme;
		els.shareThemeToggle.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b === btn));
		renderShareCard();
	});

	els.shareReviewBtn?.addEventListener('click', () => {
		if (els.shareReviewBtn.disabled) return;
		shareState.includeReview = !shareState.includeReview;
		syncReviewButton(true);
		renderShareCard();
	});

	els.downloadCardBtn?.addEventListener('click', () => {
		if (!shareState.film) return;
		try {
			const dataUrl = els.shareCanvas.toDataURL('image/png');
			const a = document.createElement('a');
			a.href = dataUrl;
			a.download = `${shareState.film.slug || 'film'}-${shareState.style}-${shareState.format}.png`;
			a.click();
			showToast('PNG card downloaded', 'success');
		} catch (err) {
			console.error(err);
			showToast('Download requires HTTP (open via GitHub Pages or localhost)', 'error');
		}
	});

	// Touch swipe helper (vertical-scroll safe: requires clear horizontal intent)
	function attachSwipe(el, { onLeft, onRight, shouldIgnore }) {
		if (!el) return;
		let startX = 0;
		let startY = 0;
		let tracking = false;

		el.addEventListener('touchstart', e => {
			if (e.touches.length !== 1 || (shouldIgnore && shouldIgnore(e))) {
				tracking = false;
				return;
			}
			startX = e.touches[0].clientX;
			startY = e.touches[0].clientY;
			tracking = true;
		}, { passive: true });

		el.addEventListener('touchend', e => {
			if (!tracking || !e.changedTouches.length) return;
			tracking = false;
			const dx = e.changedTouches[0].clientX - startX;
			const dy = e.changedTouches[0].clientY - startY;
			if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
			if (dx < 0 && onLeft) onLeft();
			else if (dx > 0 && onRight) onRight();
		}, { passive: true });

		el.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
	}

	attachSwipe(els.heroSection, {
		onLeft: () => {
			const total = state.recentReviews.length;
			if (total > 1) {
				state.heroIndex = (state.heroIndex + 1) % total;
				renderHero(true);
			}
		},
		onRight: () => {
			const total = state.recentReviews.length;
			if (total > 1) {
				state.heroIndex = (state.heroIndex - 1 + total) % total;
				renderHero(true);
			}
		}
	});

	attachSwipe(els.readerModal, {
		shouldIgnore: () => els.shareBackdrop?.classList.contains('open'),
		onLeft: () => {
			if (state.activeIndex < state.visibleItems.length - 1) {
				openReader(state.activeIndex + 1, state.activeKind);
			}
		},
		onRight: () => {
			if (state.activeIndex > 0) {
				openReader(state.activeIndex - 1, state.activeKind);
			}
		}
	});

	// Swipe-down to dismiss reader modal on mobile (bottom sheet feel)
	(() => {
		const modal = els.readerModal;
		if (!modal) return;
		let startX = 0;
		let startY = 0;
		let startTime = 0;
		let dragging = false;
		let currentDy = 0;

		const resetTransform = () => {
			modal.classList.remove('is-dragging');
			modal.style.transform = '';
			if (els.readerBackdrop) els.readerBackdrop.style.background = '';
		};

		modal.addEventListener('touchstart', e => {
			if (e.touches.length !== 1 || els.shareBackdrop?.classList.contains('open')) return;
			const atTop = (els.readerScroll?.scrollTop || 0) <= 2 && modal.scrollTop <= 2;
			if (!atTop) return;
			startX = e.touches[0].clientX;
			startY = e.touches[0].clientY;
			startTime = Date.now();
			dragging = false;
			currentDy = 0;
		}, { passive: true });

		modal.addEventListener('touchmove', e => {
			if (!startTime || e.touches.length !== 1) return;
			const dx = e.touches[0].clientX - startX;
			const dy = e.touches[0].clientY - startY;
			if (!dragging) {
				if (dy > 12 && dy > Math.abs(dx) * 1.35) {
					dragging = true;
					modal.classList.add('is-dragging');
				} else if (Math.abs(dx) > 12 || dy < -8) {
					startTime = 0;
					return;
				}
			}
			if (dragging && dy > 0) {
				currentDy = dy;
				modal.style.transform = `translateY(${dy}px)`;
			}
		}, { passive: true });

		modal.addEventListener('touchend', () => {
			if (!dragging) {
				startTime = 0;
				return;
			}
			const elapsed = Date.now() - startTime;
			const shouldClose = currentDy > 95 || (currentDy > 55 && elapsed < 220);
			dragging = false;
			startTime = 0;
			resetTransform();
			if (shouldClose) closeReader();
		}, { passive: true });

		modal.addEventListener('touchcancel', () => {
			dragging = false;
			startTime = 0;
			resetTransform();
		}, { passive: true });
	})();

	// Standalone PWA bottom navigation bar
	els.pwaTabbar?.addEventListener('click', e => {
		const tab = e.target.closest('.pwa-tab');
		if (!tab) return;
		const action = tab.dataset.pwaAction;
		if (action === 'grid' || action === 'diary') {
			state.view = action;
			localStorage.setItem('diary_view', state.view);
			renderContent();
			window.scrollTo({ top: 0, behavior: 'smooth' });
		} else if (action === 'search') {
			window.scrollTo({ top: 0, behavior: 'smooth' });
			setTimeout(() => els.searchInput?.focus(), 180);
		} else if (action === 'random') {
			const pool = state.visibleItems.length ? state.visibleItems : state.films;
			if (!pool.length) return;
			const preferred = pool
				.map((item, idx) => ({ item, idx }))
				.filter(({ item }) => item.isReview || (item.rating && item.rating >= 4));
			const source = preferred.length ? preferred : pool.map((item, idx) => ({ item, idx }));
			const pick = source[Math.floor(Math.random() * source.length)];
			openReader(pick.idx, state.activeKind || 'film');
		}
	});

	// Service worker registration + subtle editorial update toast
	function showUpdateToast(waitingWorker) {
		if (!els.toastStack || els.toastStack.querySelector('.toast-update')) return;
		const el = document.createElement('div');
		el.className = 'toast toast-update';
		el.innerHTML = `<span>Fresh journal update ready</span><button type="button" class="toast-action-btn">Refresh</button>`;
		el.querySelector('.toast-action-btn').addEventListener('click', () => {
			waitingWorker.postMessage({ type: 'SKIP_WAITING' });
		});
		els.toastStack.appendChild(el);
	}

	if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
		window.addEventListener('load', () => {
			let refreshing = false;
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				if (refreshing) return;
				refreshing = true;
				window.location.reload();
			});

			navigator.serviceWorker.register('./sw.js').then(reg => {
				if (reg.waiting && navigator.serviceWorker.controller) {
					showUpdateToast(reg.waiting);
				}
				reg.addEventListener('updatefound', () => {
					const installing = reg.installing;
					if (!installing) return;
					installing.addEventListener('statechange', () => {
						if (installing.state === 'installed' && navigator.serviceWorker.controller) {
							showUpdateToast(installing);
						}
					});
				});
			}).catch(() => {});
		});
	}

	// Keyboard shortcuts
	document.addEventListener('keydown', e => {
		const shareOpen = els.shareBackdrop.classList.contains('open');
		const readerOpen = els.readerBackdrop.classList.contains('open');
		if (e.key === '/' && document.activeElement !== els.searchInput && !readerOpen && !shareOpen) {
			e.preventDefault();
			els.searchInput.focus();
			return;
		}
		if (e.key === 'Escape') {
			if (shareOpen) { closeShareModal(); return; }
			if (readerOpen) closeReader(true);
			return;
		}
		if (readerOpen && !shareOpen) {
			if (e.key === 'ArrowLeft' && state.activeIndex > 0) openReader(state.activeIndex - 1, state.activeKind);
			if (e.key === 'ArrowRight' && state.activeIndex < state.visibleItems.length - 1) openReader(state.activeIndex + 1, state.activeKind);
		}
	});

	// ── Data Hydration (single gzipped JSON fetch over HTTP; dynamic script fallback ONLY on file://) ──
	function populateYears() {
		if (els.yearSelect) {
			const years = Array.from(new Set(state.films.map(f => (f.watchedDate || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y))))
				.sort((a, b) => b.localeCompare(a));
			els.yearSelect.innerHTML = `<option value="all">All Years</option>` + years.map(y => `<option value="${y}">${y}</option>`).join('');
		}
		if (els.decadeSelect) {
			const decades = Array.from(new Set(state.films.map(f => f.year ? `${Math.floor(f.year / 10) * 10}s` : '').filter(Boolean)))
				.sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
			els.decadeSelect.innerHTML = `<option value="all">All Decades</option>` + decades.map(d => `<option value="${d}">${d}</option>`).join('');
		}
	}

	function normTitle(s) {
		if (!s) return '';
		return String(s)
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/&/g, ' and ')
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	}

	function tmdbKey(f) {
		if (!f || !f.tmdbId) return null;
		return `${f.tmdbType || 'movie'}:${f.tmdbId}`;
	}

	function titleYearKey(f) {
		if (!f) return 't:|';
		return `t:${normTitle(f.title)}|${f.year || ''}`;
	}

	function resolvePoster(f, overridesMap) {
		const tk = tmdbKey(f);
		const tyk = titleYearKey(f);
		const ov = (tk && overridesMap[tk]) || overridesMap[tyk] || null;
		if (ov && ov.url) {
			return { thumb: ov.url, full: ov.url };
		}
		if (ov && ov.posterPath) {
			return {
				thumb: `https://image.tmdb.org/t/p/w500${ov.posterPath}`,
				full: `https://image.tmdb.org/t/p/w780${ov.posterPath}`
			};
		}
		if (f.posterPath) {
			return {
				thumb: `https://image.tmdb.org/t/p/w500${f.posterPath}`,
				full: `https://image.tmdb.org/t/p/w780${f.posterPath}`
			};
		}
		return {
			thumb: f.thumb || '',
			full: f.full || ''
		};
	}

	function hydrate(data, overridesData) {
		const overridesMap = (overridesData && typeof overridesData === 'object' && overridesData.overrides) || {};
		state.films = (data.films || []).map((f, i) => {
			const resolved = resolvePoster(f, overridesMap);
			return {
				...f,
				rating: typeof f.rating === 'number' ? f.rating : null,
				thumb: resolved.thumb,
				full: resolved.full,
				backdrop: f.backdropPath ? `https://image.tmdb.org/t/p/w1280${f.backdropPath}` : '',
				stars: formatStars(f.rating),
				order: i,
				_search: `${f.title || ''} ${f.director || ''} ${f.year || ''} ${f.plainText || ''}`.toLowerCase()
			};
		});
		state.lists = data.lists || [];
		state.recentReviews = state.films.filter(f => f.isReview).slice(0, 5);
		populateYears();
		updateCounts();
		renderContent();
		openFromHash();
	}

	function loadFileFallback() {
		const loadScript = (src, optional = false) => new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			s.onload = () => resolve();
			s.onerror = () => (optional ? resolve() : reject(new Error(`Failed to load ${src}`)));
			document.body.appendChild(s);
		});

		Promise.all([
			loadScript('data/archive.js', false),
			loadScript('data/poster-overrides.js', true)
		]).then(() => {
			if (window.__DIARY_DATA__) {
				hydrate(window.__DIARY_DATA__, window.__POSTER_OVERRIDES__ || null);
			}
		}).catch(() => {
			els.contentArea.innerHTML = `<div class="state-box">Could not load diary archive.</div>`;
		});
	}

	if (window.location.protocol === 'file:') {
		loadFileFallback();
	} else {
		const archiveReq = fetch('data/archive.json').then(res => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		});
		const overridesReq = fetch('data/poster-overrides.json', { cache: 'no-cache' })
			.then(res => (res.ok ? res.json() : null))
			.catch(() => null);

		Promise.all([archiveReq, overridesReq])
			.then(([data, overridesData]) => hydrate(data, overridesData))
			.catch(err => {
				console.warn('Falling back to archive.js:', err);
				loadFileFallback();
			});
	}
})();
