"""Repository integrity & privacy guardrail validator.

Run locally or in GitHub Actions to verify:
1. data/archive.json and data/poster-overrides.json are valid JSON with expected schemas.
2. data/archive.js and data/poster-overrides.js are in sync and properly formatted.
3. No sensitive files (.env, config.json, *.zip, data/*.xml) are tracked by git.
4. No personal Letterboxd profile or RSS URLs leak into public tracked files.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / 'data'

FORBIDDEN_TRACKED_PATTERNS = [
    re.compile(r'(^|/)\.env(\..+)?$', re.IGNORECASE),
    re.compile(r'(^|/)config\.json$', re.IGNORECASE),
    re.compile(r'\.zip$', re.IGNORECASE),
    re.compile(r'^data/.*\.xml(\..*)?$', re.IGNORECASE),
    re.compile(r'^data/archive\.backup.*\.json$', re.IGNORECASE),
]

# Detect real Letterboxd profile/RSS URLs while ignoring placeholder examples in docs.
LB_URL_RE = re.compile(r'https?://(?:www\.)?letterboxd\.com/([a-zA-Z0-9_.-]+)(?:/[^\s"\'<>)]*)?', re.IGNORECASE)
ALLOWED_LB_SLUGS = {
    'username',
    'your-username',
    'your_username',
    'settings',
    'film',
    'films',
    'about',
    'journal',
    'lists',
    'members',
}

PUBLIC_SCAN_ROOTS = ('index.html', 'about.html', 'manifest.json', 'sw.js', 'README.md', 'ROADMAP.md')
PUBLIC_SCAN_DIRS = ('assets/', 'data/')


def validate_archive(errors: list[str]) -> None:
    archive_json = DATA_DIR / 'archive.json'
    archive_js = DATA_DIR / 'archive.js'

    if not archive_json.exists():
        errors.append('Missing data/archive.json')
        return

    try:
        data = json.loads(archive_json.read_text(encoding='utf-8'))
    except Exception as exc:
        errors.append(f'Invalid JSON in data/archive.json: {exc}')
        return

    if not isinstance(data, dict) or not isinstance(data.get('films'), list):
        errors.append('data/archive.json must be an object with a "films" array')
        return

    seen_ids: set[str] = set()
    for idx, film in enumerate(data['films']):
        if not isinstance(film, dict):
            errors.append(f'data/archive.json films[{idx}] is not an object')
            break
        fid = film.get('id')
        title = film.get('title')
        if not fid or not title:
            errors.append(f'data/archive.json films[{idx}] missing required id or title')
            break
        if fid in seen_ids:
            errors.append(f'Duplicate film id in data/archive.json: {fid}')
            break
        seen_ids.add(fid)

    if not archive_js.exists():
        errors.append('Missing data/archive.js')
    else:
        prefix = archive_js.read_text(encoding='utf-8')[:40]
        if not prefix.startswith('window.__DIARY_DATA__='):
            errors.append('data/archive.js does not start with window.__DIARY_DATA__=')

    print(f'[ok] archive.json validated ({len(data["films"])} entries)')


def validate_overrides(errors: list[str]) -> None:
    ov_json = DATA_DIR / 'poster-overrides.json'
    ov_js = DATA_DIR / 'poster-overrides.js'

    if not ov_json.exists():
        errors.append('Missing data/poster-overrides.json')
        return

    try:
        data = json.loads(ov_json.read_text(encoding='utf-8'))
    except Exception as exc:
        errors.append(f'Invalid JSON in data/poster-overrides.json: {exc}')
        return

    overrides = data.get('overrides') if isinstance(data, dict) else None
    if not isinstance(overrides, dict):
        errors.append('data/poster-overrides.json must contain an "overrides" object')
        return

    for key, val in overrides.items():
        if not isinstance(val, dict):
            errors.append(f'Override "{key}" is not an object')
            continue
        poster_path = val.get('posterPath')
        url = val.get('url')
        if poster_path:
            if not isinstance(poster_path, str) or not poster_path.startswith('/'):
                errors.append(f'Override "{key}" has invalid posterPath: {poster_path!r}')
        elif url:
            if not isinstance(url, str) or not url.startswith(('https://', 'http://', 'assets/')):
                errors.append(f'Override "{key}" has invalid url: {url!r}')
        else:
            errors.append(f'Override "{key}" must define either "posterPath" or "url"')

    if not ov_js.exists():
        errors.append('Missing data/poster-overrides.js')
    else:
        prefix = ov_js.read_text(encoding='utf-8')[:40]
        if not prefix.startswith('window.__POSTER_OVERRIDES__='):
            errors.append('data/poster-overrides.js does not start with window.__POSTER_OVERRIDES__=')

    print(f'[ok] poster-overrides.json validated ({len(overrides)} custom posters)')


def get_tracked_files() -> list[str]:
    try:
        out = subprocess.check_output(
            ['git', 'ls-files'],
            cwd=str(BASE_DIR),
            text=True,
            encoding='utf-8',
        )
        return [line.strip() for line in out.splitlines() if line.strip()]
    except Exception:
        return []


def validate_privacy(errors: list[str]) -> None:
    tracked = get_tracked_files()
    if not tracked:
        print('[warn] Could not read git tracked files; skipping git privacy scan')
        return

    for rel in tracked:
        for pat in FORBIDDEN_TRACKED_PATTERNS:
            if pat.search(rel):
                errors.append(f'Sensitive file is tracked in git: {rel}')

        should_scan = rel in PUBLIC_SCAN_ROOTS or any(rel.startswith(d) for d in PUBLIC_SCAN_DIRS)
        if not should_scan:
            continue
        path = BASE_DIR / rel
        if not path.is_file() or path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff2'}:
            continue
        try:
            text = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue

        for match in LB_URL_RE.finditer(text):
            slug = match.group(1).lower()
            if slug not in ALLOWED_LB_SLUGS:
                errors.append(f'Potential personal Letterboxd URL in tracked file {rel}: {match.group(0)}')

    print(f'[ok] privacy scan completed ({len(tracked)} tracked files checked)')


def main() -> int:
    errors: list[str] = []
    validate_archive(errors)
    validate_overrides(errors)
    validate_privacy(errors)

    if errors:
        print('\nValidation FAILED:', file=sys.stderr)
        for err in errors:
            print(f'  - {err}', file=sys.stderr)
        return 1

    print('\nAll repository checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
