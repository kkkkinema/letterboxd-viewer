"""Enrich data/archive.json with TMDB backdropPath, runtime, genres, country, and missing directors.

Uses existing tmdbId/tmdbType on entries, caches responses locally in
data/archive.backup.enrich-cache.json (gitignored) so it is safely resumable,
and writes compacted data/archive.json + data/archive.js via archive_utils.
"""

from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from archive_utils import write_archive
from backfill_posters import (
    BASE_DIR,
    fetch_tmdb_details_by_id,
    get_thread_session,
    load_tmdb_key,
)

DATA_DIR = BASE_DIR / 'data'
ARCHIVE_JSON = DATA_DIR / 'archive.json'
CACHE_FILE = DATA_DIR / 'archive.backup.scenes-cache.json'


def load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text(encoding='utf-8'))
        except Exception:
            return {}
    return {}


def save_cache(cache: dict) -> None:
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding='utf-8')


def main() -> int:
    api_key = load_tmdb_key()
    if not api_key:
        print('Error: TMDB_API_KEY not found in environment or .env', file=sys.stderr)
        return 1

    data = json.loads(ARCHIVE_JSON.read_text(encoding='utf-8'))
    films = data.get('films') or []
    cache = load_cache()

    unique_targets: dict[str, tuple[int, str]] = {}
    for f in films:
        tid = f.get('tmdbId')
        if not tid:
            continue
        ttype = f.get('tmdbType') or 'movie'
        key = f'{ttype}:{tid}'
        if key not in cache and key not in unique_targets:
            unique_targets[key] = (tid, ttype)

    total_to_fetch = len(unique_targets)
    print(f'Archive films: {len(films)} | Cached: {len(cache)} | To fetch from TMDB: {total_to_fetch}')

    if total_to_fetch > 0:
        started = time.time()
        completed = 0

        def worker(item):
            key, (tid, ttype) = item
            sess = get_thread_session()
            meta = fetch_tmdb_details_by_id(sess, tid, ttype, api_key)
            return key, meta

        with ThreadPoolExecutor(max_workers=12) as pool:
            futures = [pool.submit(worker, item) for item in unique_targets.items()]
            for fut in as_completed(futures):
                key, meta = fut.result()
                cache[key] = meta or {}
                completed += 1
                if completed % 250 == 0 or completed == total_to_fetch:
                    save_cache(cache)
                    elapsed = time.time() - started
                    rate = completed / elapsed if elapsed > 0 else 0
                    print(f'  [{completed}/{total_to_fetch}] {rate:.1f} films/sec')

    enriched_backdrop = 0
    upgraded_scenes = 0
    enriched_runtime = 0
    enriched_genres = 0
    enriched_director = 0

    for f in films:
        tid = f.get('tmdbId')
        if not tid:
            continue
        ttype = f.get('tmdbType') or 'movie'
        meta = cache.get(f'{ttype}:{tid}') or {}
        if not meta:
            continue

        if meta.get('backdropPath'):
            if f.get('backdropPath') and f.get('backdropPath') != meta['backdropPath']:
                upgraded_scenes += 1
            f['backdropPath'] = meta['backdropPath']
            enriched_backdrop += 1
        if meta.get('runtime'):
            f['runtime'] = meta['runtime']
            enriched_runtime += 1
        if meta.get('genres'):
            f['genres'] = meta['genres']
            enriched_genres += 1
        if meta.get('country'):
            f['country'] = meta['country']
        if not f.get('director') and meta.get('director'):
            f['director'] = meta['director']
            enriched_director += 1

    size_bytes, count = write_archive(data, DATA_DIR)
    print(
        f'Done! Wrote {count} films ({size_bytes/1024:.1f} KB) | '
        f'scenes: {enriched_backdrop} ({upgraded_scenes} swapped to textless stills), '
        f'runtimes: {enriched_runtime}, genres: {enriched_genres}, directors filled: {enriched_director}'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
