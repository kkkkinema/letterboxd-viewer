"""
Import a full Letterboxd data export (.zip or extracted folder) into data/archive.json and data/archive.js.

Usage:
    python scripts/import_export.py path/to/letterboxd-export.zip
    python scripts/import_export.py path/to/letterboxd-export.zip --fresh

Options:
    --fresh   Ignore any existing entries in data/archive.json (recommended for a fresh fork).
"""

import csv
import html
import io
import json
import re
import sys
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / 'data'
ARCHIVE_JSON = DATA_DIR / 'archive.json'
ARCHIVE_JS = DATA_DIR / 'archive.js'


def make_slug(title, year=None):
    text = f'{title} {year}' if year else str(title)
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return text or 'entry'


def text_to_html(text):
    text = (text or '').strip()
    if not text:
        return ''
    paragraphs = [p.strip() for p in re.split(r'\r?\n\s*\r?\n', text) if p.strip()]
    return ''.join(f'<p>{html.escape(p).replace(chr(10), "<br />")}</p>' for p in paragraphs)


def parse_year(val):
    val = (val or '').strip()
    return int(val) if val.isdigit() else None


def parse_rating(val):
    val = (val or '').strip()
    if not val:
        return None
    try:
        return float(val)
    except ValueError:
        return None


def read_csv_from_source(source_path, rel_name):
    """Read a CSV file by relative path from either a .zip archive or an extracted folder."""
    if source_path.is_file() and source_path.suffix.lower() == '.zip':
        with zipfile.ZipFile(source_path, 'r') as zf:
            names = {n.replace('\\', '/').lstrip('./'): n for n in zf.namelist()}
            target = names.get(rel_name)
            if not target:
                return []
            raw = zf.read(target).decode('utf-8-sig', errors='replace')
            return list(csv.DictReader(io.StringIO(raw)))
    else:
        file_path = source_path / rel_name
        if not file_path.exists():
            return []
        with file_path.open('r', encoding='utf-8-sig', newline='') as f:
            return list(csv.DictReader(f))


def main():
    args = [a for a in sys.argv[1:] if a != '--fresh']
    fresh = '--fresh' in sys.argv[1:]

    if not args:
        print('Usage: python scripts/import_export.py <path-to-letterboxd-export.zip> [--fresh]')
        sys.exit(1)

    source = Path(args[0]).expanduser().resolve()
    if not source.exists():
        print(f'Error: path not found: {source}')
        sys.exit(1)

    diary_rows = read_csv_from_source(source, 'diary.csv')
    review_rows = read_csv_from_source(source, 'reviews.csv')
    like_rows = read_csv_from_source(source, 'likes/films.csv')

    if not diary_rows and not review_rows:
        print('Error: neither diary.csv nor reviews.csv was found in the provided export.')
        sys.exit(1)

    liked_keys = {
        ((r.get('Name') or '').strip().lower(), parse_year(r.get('Year')))
        for r in like_rows
        if (r.get('Name') or '').strip()
    }

    # Index reviews by (title, year, watchedDate) and fallback by (title, year)
    reviews_exact = {}
    reviews_by_film = {}
    for r in review_rows:
        title = (r.get('Name') or '').strip()
        year = parse_year(r.get('Year'))
        watched = (r.get('Watched Date') or r.get('Date') or '').strip()
        body = (r.get('Review') or '').strip()
        if not title or not body:
            continue
        rec = {
            'body': body,
            'rating': parse_rating(r.get('Rating')),
            'rewatch': (r.get('Rewatch') or '').strip().lower() == 'yes',
            'watchedDate': watched,
            'date': (r.get('Date') or '').strip(),
        }
        reviews_exact[(title.lower(), year, watched)] = rec
        reviews_by_film.setdefault((title.lower(), year), []).append(rec)

    # Load existing archive (unless --fresh)
    existing_films = {}
    if not fresh and ARCHIVE_JSON.exists():
        try:
            old = json.loads(ARCHIVE_JSON.read_text(encoding='utf-8'))
            for f in old.get('films', []):
                if f.get('id'):
                    existing_films[f['id']] = f
        except Exception:
            pass

    existing_triplets = {
        (f.get('title', '').strip().lower(), f.get('year'), f.get('watchedDate', ''))
        for f in existing_films.values()
    }
    used_slugs = {f.get('slug') for f in existing_films.values() if f.get('slug')}

    def alloc_slug(title, year):
        base = make_slug(title, year)
        slug = base
        n = 2
        while slug in used_slugs:
            slug = f'{base}-{n}'
            n += 1
        used_slugs.add(slug)
        return slug

    imported = 0
    matched_reviews = 0

    for idx, row in enumerate(diary_rows):
        title = (row.get('Name') or '').strip()
        if not title:
            continue
        year = parse_year(row.get('Year'))
        watched = (row.get('Watched Date') or row.get('Date') or '').strip()
        triplet = (title.lower(), year, watched)
        if triplet in existing_triplets:
            continue

        rating = parse_rating(row.get('Rating'))
        rewatch = (row.get('Rewatch') or '').strip().lower() == 'yes'
        liked = (title.lower(), year) in liked_keys

        rev = reviews_exact.pop(triplet, None)
        body = rev['body'] if rev else ''
        if rev:
            matched_reviews += 1

        desc_html = text_to_html(body) if body else ''
        plain_text = body if body else (f'Watched on {watched}.' if watched else '')

        entry_id = f'export-diary-{idx}-{make_slug(title, year)}'
        existing_films[entry_id] = {
            'id': entry_id,
            'slug': alloc_slug(title, year),
            'title': title,
            'director': '',
            'year': year,
            'watchedDate': watched,
            'pubTimestamp': 0,
            'rating': rating,
            'liked': liked,
            'rewatch': rewatch,
            'isReview': bool(body),
            'hasSpoilers': False,
            'descriptionHtml': desc_html,
            'plainText': plain_text,
            'tmdbId': None,
            'tmdbType': 'movie',
            'posterPath': '',
        }
        existing_triplets.add(triplet)
        imported += 1

    # Add any remaining standalone reviews not in diary.csv
    for idx, ((t_low, year, watched), rev) in enumerate(reviews_exact.items()):
        if (t_low, year, watched) in existing_triplets:
            continue
        # Recover original-case title from review_rows
        orig_title = next(
            ((r.get('Name') or '').strip() for r in review_rows
             if (r.get('Name') or '').strip().lower() == t_low and parse_year(r.get('Year')) == year),
            t_low.title(),
        )
        entry_id = f'export-review-{idx}-{make_slug(orig_title, year)}'
        existing_films[entry_id] = {
            'id': entry_id,
            'slug': alloc_slug(orig_title, year),
            'title': orig_title,
            'director': '',
            'year': year,
            'watchedDate': watched,
            'pubTimestamp': 0,
            'rating': rev['rating'],
            'liked': (t_low, year) in liked_keys,
            'rewatch': rev['rewatch'],
            'isReview': True,
            'hasSpoilers': False,
            'descriptionHtml': text_to_html(rev['body']),
            'plainText': rev['body'],
            'tmdbId': None,
            'tmdbType': 'movie',
            'posterPath': '',
        }
        existing_triplets.add((t_low, year, watched))
        imported += 1
        matched_reviews += 1

    films_sorted = sorted(
        existing_films.values(),
        key=lambda f: (f.get('watchedDate') or '', f.get('pubTimestamp') or 0),
        reverse=True,
    )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    archive_data = {
        'updatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'films': films_sorted,
        'lists': [],
    }
    json_str = json.dumps(archive_data, ensure_ascii=False, separators=(',', ':'))
    ARCHIVE_JSON.write_text(json_str, encoding='utf-8')
    ARCHIVE_JS.write_text(f'window.__DIARY_DATA__={json_str};\n', encoding='utf-8')

    print(f'Imported {imported} entries ({matched_reviews} reviews). Total archive: {len(films_sorted)} films.')
    print('Next step: run `python scripts/backfill_posters.py` with TMDB_API_KEY set to fetch posters & directors.')


if __name__ == '__main__':
    main()
