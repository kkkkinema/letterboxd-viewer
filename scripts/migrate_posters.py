"""
One-time migration script to backfill tmdbId, tmdbType, and posterPath across the entire
data/archive.json and optionally delete migrated local image files from assets/images/thumbs & fulls.

Usage:
    python scripts/migrate_posters.py --dry-run
    python scripts/migrate_posters.py --apply --delete-images
"""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
import requests

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

SCRIPT_DIR = Path(__file__).parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from backfill_posters import (
    ARCHIVE_JS,
    ARCHIVE_JSON,
    BASE_DIR,
    extract_tmdb_poster_path,
    get_thread_session,
    load_tmdb_key,
    lookup_metadata,
)

THUMBS_DIR = BASE_DIR / 'assets' / 'images' / 'thumbs'
FULLS_DIR = BASE_DIR / 'assets' / 'images' / 'fulls'


def verify_tmdb_auth(session, api_key):
    """Quick sanity check against TMDB /configuration to catch 401/403 before running."""
    is_bearer = api_key.startswith('eyJ')
    headers = {'Authorization': f'Bearer {api_key}'} if is_bearer else {}
    params = {} if is_bearer else {'api_key': api_key}
    resp = session.get('https://api.themoviedb.org/3/configuration', params=params, headers=headers, timeout=10)
    if resp.status_code in (401, 403):
        raise RuntimeError(f'TMDB authentication failed with HTTP {resp.status_code}')
    resp.raise_for_status()


def list_local_poster_files():
    files = []
    for folder in (THUMBS_DIR, FULLS_DIR):
        if folder.exists():
            for p in folder.iterdir():
                if p.is_file():
                    files.append(p)
    return files


def simulate_or_apply(apply=False, delete_images=False):
    api_key = load_tmdb_key()
    if not api_key:
        print('Error: TMDB_API_KEY not found in environment or .env', file=sys.stderr)
        sys.exit(1)

    data = json.loads(ARCHIVE_JSON.read_text(encoding='utf-8'))
    films = data.get('films', [])

    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=16, pool_maxsize=16)
    session.mount('https://', adapter)

    try:
        verify_tmdb_auth(session, api_key)
    except Exception as e:
        print(f'Error verifying TMDB_API_KEY: {e}', file=sys.stderr)
        sys.exit(2)

    # Collect every unique (title, year) lacking tmdbId or posterPath
    needed = {}
    for f in films:
        if f.get('tmdbId') and f.get('posterPath'):
            continue
        k = (f.get('title', '').strip(), f.get('year'))
        if k[0]:
            # Only fetch director from TMDB credits if this film still lacks one
            needed[k] = needed.get(k, False) or (not f.get('director'))

    # Load local dry-run cache if available (gitignored under data/archive.backup*.json)
    cache_path = BASE_DIR / 'data' / 'archive.backup.tmdb-cache.json'
    cached_results = {}
    if cache_path.exists():
        try:
            cached_results = json.loads(cache_path.read_text(encoding='utf-8'))
        except Exception:
            cached_results = {}

    found_map = {}
    to_fetch = {}
    for k, nd in needed.items():
        ck = f"{k[0]}|{k[1] or ''}"
        if ck in cached_results:
            tid, ttype, pp, dname = cached_results[ck]
            if tid and (not nd or dname):
                found_map[k] = (tid, ttype, pp, dname)
                continue
        to_fetch[k] = nd

    print(f'Archive entries: {len(films)} | Unique films to resolve: {len(needed)} ({len(found_map)} cached, {len(to_fetch)} to query)', flush=True)

    if to_fetch:
        done = 0
        matched_ids = 0
        t0 = time.time()

        def worker(pair):
            title, year, need_dir = pair
            return lookup_metadata(get_thread_session(), title, year, api_key, need_director=need_dir)

        with ThreadPoolExecutor(max_workers=12) as pool:
            futures = {pool.submit(worker, (t, y, nd)): (t, y) for (t, y), nd in to_fetch.items()}
            for fut in as_completed(futures):
                k = futures[fut]
                done += 1
                try:
                    tmdb_id, tmdb_type, poster_path, director = fut.result()
                    ck = f"{k[0]}|{k[1] or ''}"
                    if tmdb_id:
                        found_map[k] = (tmdb_id, tmdb_type, poster_path, director)
                        cached_results[ck] = [tmdb_id, tmdb_type, poster_path, director]
                        matched_ids += 1
                    else:
                        cached_results[ck] = [None, 'movie', '', '']
                except Exception:
                    pass
                if done % 250 == 0 or done == len(to_fetch):
                    print(f'Progress: {done}/{len(to_fetch)} checked | {matched_ids} matched ({time.time() - t0:.1f}s)', flush=True)

        cache_path.write_text(json.dumps(cached_results, ensure_ascii=False), encoding='utf-8')

    # Build transformed copy (in memory first so dry-run checks the exact final references)
    migrated_films = []
    matched_entries = 0
    unmatched_pairs = {}
    local_matched = 0
    local_kept = 0

    for orig in films:
        f = dict(orig)
        had_local = (f.get('thumb') or '').startswith('assets/') or (f.get('full') or '').startswith('assets/')
        k = (f.get('title', '').strip(), f.get('year'))

        if f.get('tmdbId') and f.get('posterPath'):
            matched_entries += 1
            f.pop('thumb', None)
            f.pop('full', None)
            if had_local:
                local_matched += 1
            migrated_films.append(f)
            continue

        resolved = found_map.get(k)
        if resolved:
            tmdb_id, tmdb_type, poster_path, director = resolved
            if not poster_path:
                poster_path = extract_tmdb_poster_path(f.get('thumb'))

            f['tmdbId'] = tmdb_id
            f['tmdbType'] = tmdb_type
            f['posterPath'] = poster_path or ''
            if director and not f.get('director'):
                f['director'] = director

            if poster_path:
                f.pop('thumb', None)
                f.pop('full', None)
                if had_local:
                    local_matched += 1
            elif had_local:
                local_kept += 1

            matched_entries += 1
        else:
            unmatched_pairs[k] = f.get('thumb') or ''
            if had_local:
                local_kept += 1

        migrated_films.append(f)

    # Determine which local files in thumbs/ and fulls/ remain referenced after migration
    still_referenced = set()
    for f in migrated_films:
        for field in ('thumb', 'full'):
            val = f.get(field) or ''
            if val.startswith('assets/images/'):
                still_referenced.add((BASE_DIR / val).resolve())

    all_local_files = list_local_poster_files()
    deletable_files = [p for p in all_local_files if p.resolve() not in still_referenced]
    kept_files = [p for p in all_local_files if p.resolve() in still_referenced]
    deletable_bytes = sum(p.stat().st_size for p in deletable_files)
    kept_bytes = sum(p.stat().st_size for p in kept_files)

    unique_total = len({(f.get('title', '').strip(), f.get('year')) for f in films if f.get('title', '').strip()})
    unmatched_count = len(unmatched_pairs)
    unmatched_pct = (unmatched_count / unique_total * 100.0) if unique_total else 0.0

    print('\n=== Migration Summary ===')
    print(f'Entries matched with tmdbId : {matched_entries}/{len(films)} ({matched_entries * 100 / max(1, len(films)):.1f}%)')
    print(f'Unique films unmatched      : {unmatched_count}/{unique_total} ({unmatched_pct:.2f}%)')
    print(f'Local entries migrated      : {local_matched} (kept fallback: {local_kept})')
    print(f'Local files to delete       : {len(deletable_files)} files ({deletable_bytes / (1024 * 1024):.1f} MB)')
    print(f'Local files kept            : {len(kept_files)} files ({kept_bytes / (1024 * 1024):.1f} MB)')

    if unmatched_pairs:
        print('\nSample unmatched unique films (up to 25):')
        for (t, y) in sorted(unmatched_pairs.keys(), key=lambda x: (x[0].lower(), x[1] or 0))[:25]:
            print(f'  - {t} ({y or "?"})')

    if not apply:
        print('\nDry-run complete. No files were modified.')
        return

    # Write backup before mutating archive.json
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    backup_path = BASE_DIR / 'data' / f'archive.backup.{stamp}.json'
    backup_path.write_text(ARCHIVE_JSON.read_text(encoding='utf-8'), encoding='utf-8')
    print(f'\nBackup saved to {backup_path}')

    data['films'] = migrated_films
    json_str = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    ARCHIVE_JSON.write_text(json_str, encoding='utf-8')
    ARCHIVE_JS.write_text(f'window.__DIARY_DATA__={json_str};\n', encoding='utf-8')
    print(f'Updated {ARCHIVE_JSON} and {ARCHIVE_JS}')

    if delete_images and deletable_files:
        removed = 0
        for p in deletable_files:
            try:
                p.unlink()
                removed += 1
            except OSError as e:
                print(f'Warning: failed to remove {p}: {e}')
        print(f'Deleted {removed} unreferenced local poster files ({deletable_bytes / (1024 * 1024):.1f} MB freed).')


def main():
    parser = argparse.ArgumentParser(description='Migrate letterboxd-viewer posters to TMDB links.')
    parser.add_argument('--dry-run', action='store_true', help='Preview matches and deletions without writing changes (default).')
    parser.add_argument('--apply', action='store_true', help='Write updated tmdbId/posterPath fields to archive.json & archive.js.')
    parser.add_argument('--delete-images', action='store_true', help='With --apply, delete orphaned local files in thumbs/ and fulls/.')
    args = parser.parse_args()

    simulate_or_apply(apply=args.apply, delete_images=args.delete_images)


if __name__ == '__main__':
    main()
