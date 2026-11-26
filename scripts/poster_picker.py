"""
Local Poster Picker for letterboxd-viewer (Python standard library only).

Runs a loopback-only HTTP server at http://127.0.0.1:8765 that lets you browse
your film archive, view alternate TMDB posters for any film, save custom picks to
data/poster-overrides.json (+ data/poster-overrides.js), and pull/push to GitHub
without ever modifying archive.json or exposing your TMDB_API_KEY to the browser.

Usage:
    python scripts/poster_picker.py
    python scripts/poster_picker.py --port 8765 --no-open
"""

import argparse
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

SCRIPT_DIR = Path(__file__).parent
BASE_DIR = SCRIPT_DIR.parent
STATIC_DIR = SCRIPT_DIR / 'poster_picker'
DATA_DIR = BASE_DIR / 'data'
ARCHIVE_JSON = DATA_DIR / 'archive.json'
OVERRIDES_JSON = DATA_DIR / 'poster-overrides.json'
OVERRIDES_JS = DATA_DIR / 'poster-overrides.js'
ENV_PATH = BASE_DIR / '.env'

TMDB_IMG_W500 = 'https://image.tmdb.org/t/p/w500'
TMDB_IMAGE_LANGS = 'en,null,ja,fr,ko,zh,id,it,de,es,pt,ru,sv,da,no,pl'
OVERRIDES_LOCK = threading.Lock()


def load_tmdb_key():
    """Load TMDB_API_KEY from environment or local .env (kept server-side only)."""
    key = os.environ.get('TMDB_API_KEY', '').strip()
    if key:
        return key
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            if k.strip() == 'TMDB_API_KEY':
                return v.strip().strip('"').strip("'")
    return ''


def norm_title(s):
    """Normalize a title identically to assets/js/app.js normTitle()."""
    if not s:
        return ''
    s = unicodedata.normalize('NFKD', str(s))
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower().replace('&', ' and ')
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s


def tmdb_key(film):
    tid = film.get('tmdbId')
    if not tid:
        return None
    ttype = film.get('tmdbType') or 'movie'
    return f'{ttype}:{tid}'


def title_year_key(film):
    return f"t:{norm_title(film.get('title'))}|{film.get('year') or ''}"


def resolve_url(poster_path='', url='', legacy=''):
    if url:
        return url
    if poster_path:
        return f'{TMDB_IMG_W500}{poster_path}'
    if legacy:
        if legacy.startswith('assets/'):
            return '/' + legacy
        return legacy
    return ''


def read_overrides():
    if not OVERRIDES_JSON.exists():
        return {'version': 1, 'overrides': {}}
    try:
        data = json.loads(OVERRIDES_JSON.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('overrides'), dict):
            return {'version': 1, 'overrides': {}}
        return {'version': int(data.get('version', 1)), 'overrides': data['overrides']}
    except Exception:
        return {'version': 1, 'overrides': {}}


def atomic_write_text(path, text):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + f'.{os.getpid()}.tmp')
    tmp_path.write_text(text, encoding='utf-8')
    os.replace(tmp_path, path)


def write_overrides_locked(overrides_dict):
    """Pretty-print 1 override per line with sorted keys for clean git diffs."""
    sorted_items = sorted(overrides_dict.items(), key=lambda kv: kv[0])
    payload = {'version': 1, 'overrides': dict(sorted_items)}

    lines = ['{', '  "version": 1,']
    if not sorted_items:
        lines.append('  "overrides": {}')
    else:
        lines.append('  "overrides": {')
        for idx, (k, v) in enumerate(sorted_items):
            comma = ',' if idx < len(sorted_items) - 1 else ''
            k_str = json.dumps(k, ensure_ascii=False)
            v_str = json.dumps(v, ensure_ascii=False, separators=(', ', ': '))
            lines.append(f'    {k_str}: {v_str}{comma}')
        lines.append('  }')
    lines.append('}')
    pretty_json = '\n'.join(lines) + '\n'

    compact_json = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    js_wrapper = f'window.__POSTER_OVERRIDES__={compact_json};\n'

    atomic_write_text(OVERRIDES_JSON, pretty_json)
    atomic_write_text(OVERRIDES_JS, js_wrapper)
    return payload


def tmdb_request(endpoint, query_params=None):
    api_key = load_tmdb_key()
    if not api_key:
        raise RuntimeError('TMDB_API_KEY is not set in environment or .env')

    params = dict(query_params or {})
    headers = {'Accept': 'application/json'}
    if api_key.startswith('eyJ'):
        headers['Authorization'] = f'Bearer {api_key}'
    else:
        params['api_key'] = api_key

    qs = urllib.parse.urlencode(params)
    url = f'https://api.themoviedb.org/3/{endpoint}?{qs}' if qs else f'https://api.themoviedb.org/3/{endpoint}'

    for attempt in range(3):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                retry_after = float(e.headers.get('Retry-After', '1.5'))
                time.sleep(retry_after + 0.25)
                continue
            body = e.read().decode('utf-8', errors='replace')
            raise RuntimeError(f'TMDB HTTP {e.code}: {body[:200]}')
        except urllib.error.URLError as e:
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
                continue
            raise RuntimeError(f'TMDB network error: {e.reason}')
    raise RuntimeError('TMDB request failed after retries')


def build_films_catalog():
    if not ARCHIVE_JSON.exists():
        return []
    archive = json.loads(ARCHIVE_JSON.read_text(encoding='utf-8'))
    overrides_map = read_overrides().get('overrides', {})

    grouped = {}
    for idx, f in enumerate(archive.get('films', [])):
        tk = tmdb_key(f)
        tyk = title_year_key(f)
        key = tk or tyk

        ov = (tk and overrides_map.get(tk)) or overrides_map.get(tyk)
        ov_key = (tk if (tk and tk in overrides_map) else (tyk if tyk in overrides_map else None))

        if key not in grouped:
            default_path = f.get('posterPath') or ''
            default_url = resolve_url(poster_path=default_path, legacy=f.get('thumb') or '')
            current_url = resolve_url(
                poster_path=(ov or {}).get('posterPath') or default_path,
                url=(ov or {}).get('url') or '',
                legacy=f.get('thumb') or '',
            )
            grouped[key] = {
                'key': key,
                'fallbackKey': tyk,
                'overrideKey': ov_key,
                'title': f.get('title') or '',
                'director': f.get('director') or '',
                'year': f.get('year'),
                'rating': f.get('rating'),
                'liked': bool(f.get('liked')),
                'isReview': bool(f.get('isReview')),
                'isUnmatched': not bool(f.get('tmdbId')),
                'tmdbId': f.get('tmdbId'),
                'tmdbType': f.get('tmdbType') or 'movie',
                'defaultPosterPath': default_path,
                'defaultPosterUrl': default_url,
                'currentPosterUrl': current_url,
                'hasOverride': ov is not None,
                'override': ov,
                'lastWatched': f.get('watchedDate') or '',
                'logCount': 1,
                '_firstIdx': idx,
            }
        else:
            grouped[key]['logCount'] += 1
            wd = f.get('watchedDate') or ''
            if wd > grouped[key]['lastWatched']:
                grouped[key]['lastWatched'] = wd
            if f.get('rating') is not None:
                cur_r = grouped[key]['rating']
                if cur_r is None or f['rating'] > cur_r:
                    grouped[key]['rating'] = f['rating']
            if f.get('liked'):
                grouped[key]['liked'] = True
            if f.get('isReview'):
                grouped[key]['isReview'] = True
            if not grouped[key]['director'] and f.get('director'):
                grouped[key]['director'] = f['director']

    films = list(grouped.values())
    films.sort(key=lambda item: (item['lastWatched'], -item['_firstIdx']), reverse=True)
    for item in films:
        item.pop('_firstIdx', None)
    return films


def run_git(args):
    proc = subprocess.run(['git', *args], cwd=BASE_DIR, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or 'git command failed').strip()
        raise RuntimeError(err)
    return proc.stdout


def get_git_status():
    managed = ['data/poster-overrides.json', 'data/poster-overrides.js']
    existing = [p for p in managed if (BASE_DIR / p).exists()]
    dirty_files = []
    if existing:
        # Preserve leading space in porcelain two-char status code (" M data/...")
        raw = run_git(['status', '--porcelain', '--', *existing]).rstrip('\r\n')
        if raw:
            for line in raw.splitlines():
                if len(line) > 3:
                    dirty_files.append(line[3:].strip())

    unpushed = 0
    try:
        cnt = run_git(['rev-list', '--count', '@{u}..HEAD']).strip()
        unpushed = int(cnt) if cnt.isdigit() else 0
    except Exception:
        unpushed = 0

    return {
        'dirtyFiles': dirty_files,
        'dirtyCount': len(dirty_files),
        'unpushedCommits': unpushed,
        'pendingCount': len(dirty_files) if dirty_files else unpushed,
    }


def fetch_posters_for_tmdb(tmdb_type, tid):
    ttype = 'tv' if tmdb_type == 'tv' else 'movie'
    payload = tmdb_request(
        f'{ttype}/{tid}',
        {'append_to_response': 'images', 'include_image_language': TMDB_IMAGE_LANGS},
    )
    orig_lang = payload.get('original_language') or ''
    default_path = payload.get('poster_path') or ''
    raw_posters = (payload.get('images') or {}).get('posters') or []

    seen_paths = set()
    posters = []
    for p in raw_posters:
        fp = p.get('file_path') or ''
        if not fp or fp in seen_paths:
            continue
        seen_paths.add(fp)
        posters.append({
            'filePath': fp,
            'lang': p.get('iso_639_1'),
            'width': p.get('width') or 0,
            'height': p.get('height') or 0,
            'voteAverage': round(float(p.get('vote_average') or 0.0), 2),
            'voteCount': int(p.get('vote_count') or 0),
        })

    if default_path and default_path not in seen_paths:
        posters.insert(0, {
            'filePath': default_path,
            'lang': orig_lang or None,
            'width': 0,
            'height': 0,
            'voteAverage': 0.0,
            'voteCount': 0,
        })

    def sort_key(item):
        is_default = 1 if item['filePath'] == default_path else 0
        lang = item['lang']
        lang_score = 3 if lang is None else (2 if lang == orig_lang else (1 if lang == 'en' else 0))
        return (is_default, lang_score, item['voteAverage'], item['voteCount'])

    posters.sort(key=sort_key, reverse=True)
    return {
        'tmdbId': tid,
        'tmdbType': ttype,
        'originalLanguage': orig_lang,
        'defaultPosterPath': default_path,
        'posters': posters,
    }


class PosterPickerHandler(BaseHTTPRequestHandler):
    server_version = 'LetterboxdPosterPicker/1.0'

    def log_message(self, format, *args):
        pass  # Keep terminal clean unless errors occur

    def _ensure_loopback(self):
        host = self.client_address[0]
        if host not in ('127.0.0.1', '::1', '::ffff:127.0.0.1'):
            self._send_json({'error': 'Forbidden: loopback only'}, HTTPStatus.FORBIDDEN)
            return False
        return True

    def _send_json(self, obj, status=HTTPStatus.OK):
        raw = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def _send_file(self, path):
        if not path.exists() or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        ctype, _ = mimetypes.guess_type(str(path))
        if path.suffix == '.js':
            ctype = 'application/javascript; charset=utf-8'
        elif path.suffix == '.css':
            ctype = 'text/css; charset=utf-8'
        elif path.suffix == '.html':
            ctype = 'text/html; charset=utf-8'
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', ctype or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length') or '0')
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode('utf-8')
        return json.loads(raw) if raw else {}

    def do_GET(self):
        if not self._ensure_loopback():
            return

        parsed = urllib.parse.urlparse(self.path)
        req_path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        try:
            if req_path == '/':
                return self._send_file(STATIC_DIR / 'index.html')
            if req_path in ('/picker.css', '/picker.js'):
                return self._send_file(STATIC_DIR / req_path.lstrip('/'))
            if req_path.startswith('/assets/images/'):
                rel = req_path.lstrip('/')
                target = (BASE_DIR / rel).resolve()
                if str(target).startswith(str((BASE_DIR / 'assets' / 'images').resolve())):
                    return self._send_file(target)
                return self.send_error(HTTPStatus.FORBIDDEN)

            if req_path == '/api/films':
                films = build_films_catalog()
                customized = sum(1 for f in films if f['hasOverride'])
                return self._send_json({
                    'films': films,
                    'total': len(films),
                    'customized': customized,
                    'hasTmdbKey': bool(load_tmdb_key()),
                })

            if req_path.startswith('/api/films/') and req_path.endswith('/posters'):
                raw_key = urllib.parse.unquote(req_path[len('/api/films/'):-len('/posters')])
                m = re.match(r'^(movie|tv):(\d+)$', raw_key)
                if not m:
                    return self._send_json({'error': 'Film has no tmdbId; use TMDB search below.'}, HTTPStatus.BAD_REQUEST)
                ttype, tid = m.group(1), int(m.group(2))
                return self._send_json(fetch_posters_for_tmdb(ttype, tid))

            if req_path == '/api/tmdb/images':
                ttype = (qs.get('type', ['movie'])[0] or 'movie')
                tid_str = (qs.get('id', [''])[0] or '').strip()
                if not tid_str.isdigit():
                    return self._send_json({'error': 'Valid numeric TMDB id required'}, HTTPStatus.BAD_REQUEST)
                return self._send_json(fetch_posters_for_tmdb(ttype, int(tid_str)))

            if req_path == '/api/tmdb/search':
                query = (qs.get('q', [''])[0] or '').strip()
                year = (qs.get('year', [''])[0] or '').strip()
                if not query:
                    return self._send_json({'results': []})

                m_res = []
                if year.isdigit():
                    m_res = tmdb_request('search/movie', {'query': query, 'year': year, 'include_adult': 'false', 'page': '1'}).get('results', [])[:8]
                if len(m_res) < 5:
                    seen_m = {r.get('id') for r in m_res if r.get('id')}
                    broad = tmdb_request('search/movie', {'query': query, 'include_adult': 'false', 'page': '1'}).get('results', [])
                    for r in broad:
                        if r.get('id') and r['id'] not in seen_m:
                            m_res.append(r)
                            seen_m.add(r['id'])
                        if len(m_res) >= 8:
                            break

                tv_res = tmdb_request('search/tv', {'query': query, 'include_adult': 'false', 'page': '1'}).get('results', [])[:5]

                results = [{
                    'tmdbId': r.get('id'),
                    'tmdbType': 'movie',
                    'title': r.get('title') or '',
                    'year': (r.get('release_date') or '')[:4] or None,
                    'posterPath': r.get('poster_path') or '',
                } for r in m_res if r.get('id')] + [{
                    'tmdbId': r.get('id'),
                    'tmdbType': 'tv',
                    'title': r.get('name') or '',
                    'year': (r.get('first_air_date') or '')[:4] or None,
                    'posterPath': r.get('poster_path') or '',
                } for r in tv_res if r.get('id')]
                return self._send_json({'results': results})

            if req_path == '/api/git/status':
                return self._send_json(get_git_status())

            self.send_error(HTTPStatus.NOT_FOUND)
        except Exception as e:
            self._send_json({'error': str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_PUT(self):
        if not self._ensure_loopback():
            return
        parsed = urllib.parse.urlparse(self.path)
        req_path = parsed.path
        if not req_path.startswith('/api/overrides/'):
            return self.send_error(HTTPStatus.NOT_FOUND)

        key = urllib.parse.unquote(req_path[len('/api/overrides/'):]).strip()
        if not key:
            return self._send_json({'error': 'Override key required'}, HTTPStatus.BAD_REQUEST)

        try:
            body = self._read_json_body()
            poster_path = (body.get('posterPath') or '').strip()
            custom_url = (body.get('url') or '').strip()

            if custom_url:
                if not re.match(r'^https?://', custom_url, re.I):
                    return self._send_json({'error': 'URL must start with http:// or https://'}, HTTPStatus.BAD_REQUEST)
                val = {'url': custom_url}
            elif poster_path:
                if not poster_path.startswith('/'):
                    poster_path = '/' + poster_path
                val = {'posterPath': poster_path}
            else:
                return self._send_json({'error': 'posterPath or url required'}, HTTPStatus.BAD_REQUEST)

            with OVERRIDES_LOCK:
                data = read_overrides()
                ov_map = dict(data['overrides'])
                ov_map[key] = val
                write_overrides_locked(ov_map)

            return self._send_json({
                'ok': True,
                'key': key,
                'override': val,
                'currentPosterUrl': resolve_url(poster_path=val.get('posterPath', ''), url=val.get('url', '')),
                'gitStatus': get_git_status(),
            })
        except Exception as e:
            self._send_json({'error': str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_DELETE(self):
        if not self._ensure_loopback():
            return
        parsed = urllib.parse.urlparse(self.path)
        req_path = parsed.path
        if not req_path.startswith('/api/overrides/'):
            return self.send_error(HTTPStatus.NOT_FOUND)

        key = urllib.parse.unquote(req_path[len('/api/overrides/'):]).strip()
        qs = urllib.parse.parse_qs(parsed.query)
        fallback = (qs.get('fallback', [''])[0] or '').strip()

        try:
            with OVERRIDES_LOCK:
                data = read_overrides()
                ov_map = dict(data['overrides'])
                removed = ov_map.pop(key, None) is not None
                if fallback:
                    removed = (ov_map.pop(fallback, None) is not None) or removed
                write_overrides_locked(ov_map)

            return self._send_json({
                'ok': True,
                'removed': removed,
                'gitStatus': get_git_status(),
            })
        except Exception as e:
            self._send_json({'error': str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self):
        if not self._ensure_loopback():
            return
        parsed = urllib.parse.urlparse(self.path)
        req_path = parsed.path

        try:
            if req_path == '/api/git/pull':
                run_git(['pull', '--rebase', '--autostash', 'origin', 'main'])
                head = run_git(['rev-parse', '--short', 'HEAD']).strip()
                return self._send_json({
                    'success': True,
                    'message': f'Synced with GitHub ({head})',
                    'gitStatus': get_git_status(),
                })

            if req_path == '/api/git/push':
                status = get_git_status()
                dirty = status['dirtyFiles']
                committed = False

                if dirty:
                    run_git(['add', '--', 'data/poster-overrides.json', 'data/poster-overrides.js'])
                    staged = [s.strip() for s in run_git(['diff', '--cached', '--name-only']).splitlines() if s.strip()]
                    if staged:
                        count = len(read_overrides().get('overrides', {}))
                        run_git(['commit', '-m', f'chore(posters): update custom posters ({count})'])
                        committed = True

                status_after = get_git_status()
                if not committed and status_after['unpushedCommits'] == 0:
                    return self._send_json({
                        'success': True,
                        'message': 'Already up to date with GitHub.',
                        'gitStatus': status_after,
                    })

                run_git(['pull', '--rebase', '--autostash', 'origin', 'main'])
                run_git(['push', 'origin', 'main'])
                head = run_git(['rev-parse', '--short', 'HEAD']).strip()
                return self._send_json({
                    'success': True,
                    'commitHash': head,
                    'message': f'Pushed custom posters ({head}) — GitHub Pages deploying',
                    'gitStatus': get_git_status(),
                })

            self.send_error(HTTPStatus.NOT_FOUND)
        except Exception as e:
            self._send_json({'success': False, 'error': str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main():
    parser = argparse.ArgumentParser(description='Run the local letterboxd-viewer poster picker.')
    parser.add_argument('--port', type=int, default=8765, help='Loopback port to listen on (default: 8765)')
    parser.add_argument('--no-open', action='store_true', help='Do not open a browser tab automatically')
    args = parser.parse_args()

    server = ThreadingHTTPServer(('127.0.0.1', args.port), PosterPickerHandler)
    url = f'http://127.0.0.1:{args.port}/'
    print(f'Poster Picker running at {url}')
    print('Press Ctrl+C to stop.')

    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down Poster Picker...')
        server.shutdown()


if __name__ == '__main__':
    main()
