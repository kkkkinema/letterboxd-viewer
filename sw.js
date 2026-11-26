const SW_VERSION = '__SW_VERSION__';
const CACHE_NAME = `film-diary-${SW_VERSION}`;
const POSTER_CACHE = 'film-diary-posters-v2';
const MAX_POSTER_ENTRIES = 150;

const APP_SHELL = [
	'./',
	'./index.html',
	'./about.html',
	'./manifest.json',
	'./assets/images/icon.svg',
	'./assets/images/icon-192.png',
	'./assets/images/apple-touch-icon.png',
	'./assets/css/editorial.css?v=18',
	'./assets/js/share-cards.js?v=6',
	'./assets/js/app.js?v=20'
];

async function trimPosterCache() {
	try {
		const cache = await caches.open(POSTER_CACHE);
		const keys = await cache.keys();
		if (keys.length > MAX_POSTER_ENTRIES) {
			const excess = keys.length - MAX_POSTER_ENTRIES;
			await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
		}
	} catch (_) {}
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => cache.addAll(APP_SHELL))
			.catch(() => {})
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(
				keys
					.filter((k) => k !== CACHE_NAME && k !== POSTER_CACHE)
					.map((k) => caches.delete(k))
			))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);

	// Cache-first for immutable TMDB posters (CORS-enabled so canvas Share Card works cleanly)
	if (url.hostname === 'image.tmdb.org') {
		event.respondWith(
			caches.open(POSTER_CACHE).then(async (cache) => {
				const cached = await cache.match(req.url);
				if (cached && (req.mode !== 'cors' || cached.type !== 'opaque')) {
					return cached;
				}
				try {
					const corsReq = new Request(req.url, { mode: 'cors', credentials: 'omit' });
					const res = await fetch(corsReq);
					if (res && res.ok) {
						cache.put(req.url, res.clone()).then(trimPosterCache);
						return res;
					}
					return res;
				} catch (_) {
					return cached || fetch(req).catch(() => Response.error());
				}
			})
		);
		return;
	}

	if (url.origin !== self.location.origin) return;

	const isDocumentOrData =
		req.mode === 'navigate' ||
		url.pathname.endsWith('.html') ||
		url.pathname.endsWith('.json') ||
		url.pathname === '/';

	if (isDocumentOrData) {
		// Network-first so new reviews and custom posters appear immediately when online
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (res && res.ok) {
						const copy = res.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
					}
					return res;
				})
				.catch(() => caches.match(req))
		);
		return;
	}

	// Stale-while-revalidate for CSS, JS, and static icons
	event.respondWith(
		caches.match(req).then((cached) => {
			const networkFetch = fetch(req)
				.then((res) => {
					if (res && res.ok) {
						const copy = res.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
					}
					return res;
				})
				.catch(() => cached);
			return cached || networkFetch;
		})
	);
});
