#!/usr/bin/env python3
"""Make TMDB's title/original_title authoritative:
- movie.title      = TMDB's English (en-US default) release title
- movie.originalTitle = TMDB's original_title (native language, natural order)

Also drops the polishTitle field entirely (per user: only English + original
titles are kept, unless the movie's original language IS Polish, in which
case originalTitle already covers it).

Requires TMDB_API_KEY in the environment.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "movies.json"
API_KEY = os.environ.get("TMDB_API_KEY")


def fetch_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_details(tmdb_id):
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={API_KEY}"
    return fetch_json(url)


def main():
    if not API_KEY:
        print("Set TMDB_API_KEY environment variable first.", file=sys.stderr)
        sys.exit(1)

    movies = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    updated = 0
    errors = []
    foreign_english_title = []  # title == original_title but not English (e.g. "Das Boot")
    title_changed = []

    for i, movie in enumerate(movies, 1):
        movie.pop("polishTitle", None)

        tmdb_id = movie.get("tmdbId")
        if not tmdb_id:
            continue

        try:
            details = get_details(tmdb_id)
        except urllib.error.HTTPError as e:
            errors.append(f"{movie['title']} ({tmdb_id}): HTTP {e.code}")
            time.sleep(0.3)
            continue
        except Exception as e:
            errors.append(f"{movie['title']} ({tmdb_id}): {e}")
            time.sleep(0.3)
            continue

        new_title = details.get("title")
        new_original = details.get("original_title")
        orig_lang = details.get("original_language")

        if new_title and new_title != movie["title"]:
            title_changed.append((movie["title"], new_title))
        if new_title:
            movie["title"] = new_title
        if new_original:
            movie["originalTitle"] = new_original
        if orig_lang:
            movie["originalLanguage"] = orig_lang

        if new_title and new_original and new_title == new_original and orig_lang and orig_lang != "en":
            foreign_english_title.append(f"{new_title} ({movie.get('year')}) [{orig_lang}]")

        updated += 1
        if i % 60 == 0:
            print(f"[{i}/{len(movies)}] updated={updated}")
        time.sleep(0.05)

    DATA_PATH.write_text(json.dumps(movies, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Done. updated={updated} errors={len(errors)} total={len(movies)}")

    if errors:
        print("\nErrors:")
        for e in errors:
            print(" -", e)

    print(f"\nTitles changed: {len(title_changed)}")

    print(f"\nMovies whose English-market title stayed in the original (non-English) language ({len(foreign_english_title)}):")
    for x in sorted(set(foreign_english_title)):
        print(" -", x)


if __name__ == "__main__":
    main()
