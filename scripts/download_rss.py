import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
import requests
from bs4 import BeautifulSoup
from PIL import Image

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

script_dir = Path(__file__).parent
if str(script_dir) not in sys.path:
    sys.path.insert(0, str(script_dir))

from archive_utils import write_archive
from backfill_posters import (
    fetch_tmdb_by_id,
    fetch_tmdb_details_by_id,
    load_tmdb_key,
    lookup_metadata,
)

url = os.environ.get('LETTERBOXD_RSS_URL', '').strip()

base_dir = script_dir.parent
data_dir = base_dir / 'data'
images_dir = base_dir / 'assets' / 'images'
thumbs_dir = images_dir / 'thumbs'

data_dir.mkdir(parents=True, exist_ok=True)


def sanitize_filename(title):
    """Sanitize a film title into a safe ASCII filename slug."""
    title = title.replace('(contains spoilers)', '').strip()
    title = title.replace('contains spoilers', '').strip()
    sanitized = title.lower().replace(' ', '-')
    sanitized = ''.join(c for c in sanitized if c.isalnum() or c == '-')
    while '--' in sanitized:
        sanitized = sanitized.replace('--', '-')
    return sanitized.strip('-').replace('½', '')


def save_fallback_thumbnail(raw_description, base_slug):
    """
    Fallback-only image downloader used when TMDB_API_KEY is unset or TMDB lacks a poster.
    Saves a single <=500px-wide JPEG (q=80, ~30 KB) into assets/images/thumbs/.
    """
    if not raw_description or not base_slug:
        return ''
    img_match = re.search(r'src="([^"]+)"', raw_description)
    if not img_match:
        return ''
    img_url = img_match.group(1)
    if 'letterboxd-list-' in img_url:
        return ''

    for token in ('-0-150-', '-0-230-', '-0-1000-', '-0-2000-'):
        img_url = img_url.replace(token, '-0-500-')

    thumbs_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = thumbs_dir / f'{base_slug}_thumb.jpg'
    rel_path = f'assets/images/thumbs/{base_slug}_thumb.jpg'
    if thumb_path.exists():
        return rel_path

    try:
        resp = requests.get(img_url, timeout=15)
        resp.raise_for_status()
        with Image.open(io.BytesIO(resp.content)) as img:
            if img.mode in ('RGBA', 'P', 'LA'):
                img = img.convert('RGB')
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            if img.width > 500:
                new_h = max(1, int(round(img.height * (500 / img.width))))
                img = img.resize((500, new_h), Image.Resampling.LANCZOS)
            img.save(thumb_path, 'JPEG', quality=80, optimize=True)
        print(f'Saved fallback poster ({thumb_path.stat().st_size // 1024} KB): {rel_path}')
        return rel_path
    except Exception as e:
        print(f'Warning: failed fallback poster download ({img_url}): {e}')
        return ''


def clean_description(description):
    """Clean HTML description content from the RSS feed."""
    try:
        if description.startswith('<![CDATA[') and description.endswith(']]>'):
            description = description[9:-3]
        if '&lt;' in description:
            from html import unescape
            description = unescape(description)

        soup = BeautifulSoup(description, 'html.parser')
        for img in soup.find_all('img'):
            img.decompose()
        for p in soup.find_all('p'):
            if not p.get_text(strip=True):
                p.decompose()

        allowed_tags = ['p', 'br', 'a', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'span', 'div']
        for tag in soup.find_all():
            if tag.name not in allowed_tags:
                tag.replace_with(soup.new_string(tag.get_text()))

        cleaned_html = str(soup).strip()
        return cleaned_html if cleaned_html else '<p>No content available</p>'
    except Exception as e:
        print(f'Error cleaning description: {e}')
        return description


def strip_identifying_links(html_text):
    """Remove any links pointing to Letterboxd profiles or items."""
    if not html_text:
        return ''
    soup = BeautifulSoup(html_text, 'html.parser')
    for a in soup.find_all('a'):
        href = (a.get('href') or '').lower()
        if 'letterboxd.com' in href:
            a.replace_with(a.get_text())
    return str(soup).strip()


def make_url_slug(title, year=None):
    base = f'{title}-{year}' if year else title
    slug = re.sub(r'[^\w\s-]', '', base.lower())
    slug = re.sub(r'[-\s]+', '-', slug).strip('-')
    return slug or 'entry'


def get_ns_text(item, local_name):
    for child in item:
        tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if tag == local_name and child.text:
            return child.text.strip()
    return ''


def extract_tmdb_ref(item):
    """Return (tmdb_id: int | None, tmdb_type: 'movie' | 'tv') from RSS namespace tags."""
    movie_id = get_ns_text(item, 'movieId')
    if movie_id.isdigit():
        return int(movie_id), 'movie'
    tv_id = get_ns_text(item, 'tvId')
    if tv_id.isdigit():
        return int(tv_id), 'tv'
    return None, 'movie'


def parse_pub_timestamp(pub_date):
    if not pub_date:
        return 0
    try:
        return int(parsedate_to_datetime(pub_date).timestamp())
    except Exception:
        return 0


def resolve_new_tmdb_data(session, tmdb_id, tmdb_type, film_title, film_year, tmdb_key):
    """Fetch (tmdb_id, tmdb_type, poster_path, director, rich_meta) for a newly logged film."""
    if not tmdb_key:
        return tmdb_id, tmdb_type, '', '', {}
    try:
        if tmdb_id:
            meta = fetch_tmdb_details_by_id(session, tmdb_id, tmdb_type, tmdb_key)
            poster_path = meta.get('posterPath') or ''
            director = meta.get('director') or ''
            if poster_path:
                return tmdb_id, tmdb_type, poster_path, director, meta
            m_id, m_type, m_poster, m_dir = lookup_metadata(session, film_title, film_year, tmdb_key)
            if m_id and not meta:
                meta = fetch_tmdb_details_by_id(session, m_id, m_type, tmdb_key)
            return tmdb_id, tmdb_type, m_poster or '', director or m_dir, meta
        m_id, m_type, m_poster, m_dir = lookup_metadata(session, film_title, film_year, tmdb_key)
        meta = fetch_tmdb_details_by_id(session, m_id, m_type, tmdb_key) if m_id else {}
        return m_id, m_type, m_poster, m_dir or meta.get('director') or '', meta
    except Exception as e:
        print(f'Warning: TMDB lookup failed for "{film_title}": {e}')
        return tmdb_id, tmdb_type, '', '', {}


def refresh_entry(entry, *, fields, session, tmdb_key):
    """
    Update ONLY mutable review/diary fields on an already-archived entry.
    Never modifies poster fields (tmdbId, tmdbType, posterPath, thumb, full).
    """
    entry['title'] = fields['title']
    entry['year'] = fields['year']
    entry['watchedDate'] = fields['watchedDate']
    entry['pubTimestamp'] = fields['pubTimestamp']
    entry['rating'] = fields['rating']
    entry['liked'] = fields['liked']
    entry['rewatch'] = fields['rewatch']
    entry['isReview'] = fields['isReview']
    entry['hasSpoilers'] = fields['hasSpoilers']
    entry['descriptionHtml'] = fields['descriptionHtml']
    entry['plainText'] = fields['plainText']

    if not entry.get('director') and tmdb_key:
        tid = entry.get('tmdbId') or fields['rssTmdbId']
        ttype = entry.get('tmdbType') or fields['rssTmdbType']
        if tid:
            try:
                _, director = fetch_tmdb_by_id(session, tid, ttype, tmdb_key)
                if director:
                    entry['director'] = director
            except Exception:
                pass
    return entry


def create_entry(*, guid, slug, fields, raw_description, img_base, session, tmdb_key):
    """Create a brand-new diary entry, linking its poster via TMDB or falling back locally."""
    tmdb_id, tmdb_type, poster_path, director, rich_meta = resolve_new_tmdb_data(
        session,
        fields['rssTmdbId'],
        fields['rssTmdbType'],
        fields['title'],
        fields['year'],
        tmdb_key,
    )

    entry = {
        'id': guid,
        'slug': slug,
        'title': fields['title'],
        'director': director,
        'year': fields['year'],
        'watchedDate': fields['watchedDate'],
        'pubTimestamp': fields['pubTimestamp'],
        'rating': fields['rating'],
        'liked': fields['liked'],
        'rewatch': fields['rewatch'],
        'isReview': fields['isReview'],
        'hasSpoilers': fields['hasSpoilers'],
        'descriptionHtml': fields['descriptionHtml'],
        'plainText': fields['plainText'],
        'tmdbId': tmdb_id,
        'tmdbType': tmdb_type,
        'posterPath': poster_path,
        'backdropPath': rich_meta.get('backdropPath') or '',
        'runtime': rich_meta.get('runtime'),
        'genres': rich_meta.get('genres'),
        'country': rich_meta.get('country') or '',
    }

    if not poster_path:
        fallback_rel = save_fallback_thumbnail(raw_description, img_base)
        if fallback_rel:
            entry['thumb'] = fallback_rel
            entry['full'] = fallback_rel

    return entry


def update_archive_json(tree, cleaned_descriptions=None, tmdb_key=None, session=None):
    """Merge RSS items into an accumulating, privacy-safe data/archive.json."""
    archive_path = data_dir / 'archive.json'
    existing_films = {}

    if tmdb_key is None:
        tmdb_key = load_tmdb_key()
    if session is None:
        session = requests.Session()

    if archive_path.exists():
        try:
            old = json.loads(archive_path.read_text(encoding='utf-8'))
            for f in old.get('films', []):
                if f.get('id'):
                    existing_films[f['id']] = f
        except Exception as e:
            print(f'Warning: could not read existing archive.json: {e}')

    used_slugs = {f.get('slug') for f in existing_films.values() if f.get('slug')}
    existing_by_triplet = {
        (f.get('title', '').strip().lower(), f.get('year'), f.get('watchedDate', '')): fid
        for fid, f in existing_films.items()
    }

    items = tree.findall('.//item')
    created_count = 0
    refreshed_count = 0

    for idx, item in enumerate(items):
        raw_title = (item.findtext('title') or '').strip()
        guid = (item.findtext('guid') or f'item-{idx}').strip()
        if 'letterboxd-list-' in guid:
            continue

        pub_date = (item.findtext('pubDate') or '').strip()
        raw_desc = item.findtext('description') or ''
        desc_html = cleaned_descriptions[guid] if (cleaned_descriptions and guid in cleaned_descriptions) else clean_description(raw_desc)
        desc_html = strip_identifying_links(desc_html)
        plain_text = BeautifulSoup(desc_html, 'html.parser').get_text(' ', strip=True)

        film_title = get_ns_text(item, 'filmTitle') or re.sub(r',\s*\d{4}.*$', '', raw_title).strip()
        year_str = get_ns_text(item, 'filmYear')
        film_year = int(year_str) if year_str.isdigit() else None
        watched_date = get_ns_text(item, 'watchedDate')
        rating_str = get_ns_text(item, 'memberRating')
        try:
            rating = float(rating_str) if rating_str else None
        except ValueError:
            rating = None
        liked = get_ns_text(item, 'memberLike').lower() == 'yes'
        rewatch = get_ns_text(item, 'rewatch').lower() == 'yes'

        has_spoilers = (
            'contains spoilers' in raw_title.lower()
            or 'this review may contain spoilers' in plain_text.lower()
        )
        if has_spoilers:
            soup = BeautifulSoup(desc_html, 'html.parser')
            for p in soup.find_all('p'):
                if 'this review may contain spoilers' in p.get_text(' ', strip=True).lower():
                    p.decompose()
            desc_html = str(soup).strip()
            plain_text = BeautifulSoup(desc_html, 'html.parser').get_text(' ', strip=True)

        is_review = (
            'letterboxd-review-' in guid
            or (len(plain_text) > 65 and not re.match(r'^Watched on\s', plain_text, re.I))
        )

        rss_tmdb_id, rss_tmdb_type = extract_tmdb_ref(item)
        fields = {
            'title': film_title,
            'year': film_year,
            'watchedDate': watched_date,
            'pubTimestamp': parse_pub_timestamp(pub_date),
            'rating': rating,
            'liked': liked,
            'rewatch': rewatch,
            'isReview': is_review,
            'hasSpoilers': has_spoilers,
            'descriptionHtml': desc_html,
            'plainText': plain_text,
            'rssTmdbId': rss_tmdb_id,
            'rssTmdbType': rss_tmdb_type,
        }

        triplet = (film_title.strip().lower(), film_year, watched_date)
        existing_entry = existing_films.get(guid)
        if existing_entry is None:
            matched_old_id = existing_by_triplet.get(triplet)
            if matched_old_id and matched_old_id != guid and matched_old_id in existing_films:
                # Upgrade older CSV/export entry in place while preserving its poster fields & slug
                existing_entry = existing_films.pop(matched_old_id)
                existing_entry['id'] = guid
                existing_films[guid] = existing_entry

        if existing_entry is not None:
            refresh_entry(existing_entry, fields=fields, session=session, tmdb_key=tmdb_key)
            refreshed_count += 1
            continue

        candidate = make_url_slug(film_title, film_year)
        slug = candidate
        n = 2
        while slug in used_slugs:
            slug = f'{candidate}-{n}'
            n += 1
        used_slugs.add(slug)

        img_base = sanitize_filename(raw_title).rstrip('-') or slug
        existing_films[guid] = create_entry(
            guid=guid,
            slug=slug,
            fields=fields,
            raw_description=raw_desc,
            img_base=img_base,
            session=session,
            tmdb_key=tmdb_key,
        )
        existing_by_triplet[triplet] = guid
        created_count += 1

    films_sorted = sorted(
        existing_films.values(),
        key=lambda f: (f.get('watchedDate') or '', f.get('pubTimestamp') or 0),
        reverse=True,
    )

    archive_data = {
        'updatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'films': films_sorted,
        'lists': [],
    }

    write_archive(archive_data, data_dir)
    print(f'Successfully updated {archive_path} ({len(films_sorted)} total: {created_count} new, {refreshed_count} refreshed)')


def download_rss():
    if not url:
        print('Error: LETTERBOXD_RSS_URL environment variable is not set.', file=sys.stderr)
        sys.exit(1)

    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        print('Successfully fetched RSS feed in memory')

        tree = ET.fromstring(response.content)
        cleaned_descriptions = {}
        for item in tree.findall('.//item'):
            try:
                guid_elem = item.find('guid')
                desc_elem = item.find('description')
                if guid_elem is None or not guid_elem.text:
                    continue
                cleaned_descriptions[guid_elem.text.strip()] = clean_description(desc_elem.text if desc_elem is not None and desc_elem.text else '')
            except Exception as e:
                print(f'Error cleaning item description: {e}')

        update_archive_json(tree, cleaned_descriptions)
    except requests.RequestException as e:
        print(f'Failed to fetch RSS feed: {e}', file=sys.stderr)
        sys.exit(1)
    except ET.ParseError as e:
        print(f'Failed to parse RSS feed: {e}', file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f'Unexpected error: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    if '--build-archive-only' in sys.argv:
        cleaned_rss_path = data_dir / 'cleaned_rss.xml'
        tree = ET.parse(cleaned_rss_path).getroot()
        update_archive_json(tree)
    else:
        download_rss()
