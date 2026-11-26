"""Shared helpers for compacting and writing data/archive.json and data/archive.js."""

import json
from pathlib import Path


def compact_film(film: dict) -> dict:
    """Return a copy of a film dict with empty, null, False, and default values omitted.

    Frontend (assets/js/app.js) and local tools treat missing booleans as False,
    missing strings as '', and missing tmdbType as 'movie'.
    """
    out = {}
    for k, v in film.items():
        if v is None or v == '' or v is False:
            continue
        if k == 'tmdbType' and v == 'movie':
            continue
        out[k] = v
    return out


def write_archive(archive_data: dict, data_dir: Path) -> tuple[int, int]:
    """Compact film entries and write both data/archive.json and data/archive.js.

    Returns (json_bytes, film_count).
    """
    films = archive_data.get('films') or []
    compacted = {
        'updatedAt': archive_data.get('updatedAt', ''),
        'films': [compact_film(f) for f in films],
        'lists': archive_data.get('lists') or [],
    }
    json_str = json.dumps(compacted, ensure_ascii=False, separators=(',', ':'))

    archive_json = data_dir / 'archive.json'
    archive_js = data_dir / 'archive.js'
    archive_json.write_text(json_str, encoding='utf-8')
    archive_js.write_text(f'window.__DIARY_DATA__={json_str};\n', encoding='utf-8')
    return len(json_str.encode('utf-8')), len(films)


if __name__ == '__main__':
    base_dir = Path(__file__).resolve().parent.parent
    data_dir = base_dir / 'data'
    archive_path = data_dir / 'archive.json'
    before = archive_path.stat().st_size
    data = json.loads(archive_path.read_text(encoding='utf-8'))
    after, count = write_archive(data, data_dir)
    saved_kb = (before - after) / 1024
    pct = (1 - after / before) * 100 if before else 0
    print(f'Compacted {count} films: {before/1024:.1f} KB -> {after/1024:.1f} KB (saved {saved_kb:.1f} KB / {pct:.1f}%)')
