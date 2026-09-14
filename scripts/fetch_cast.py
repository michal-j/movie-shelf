#!/usr/bin/env python3
"""Make TMDB credits the authoritative cast source for every movie, so all
entries get a full cast list with character names (not just the ~3-4 bare
names OMDb provides for the CSV-added movies).

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

CAST_LIMIT = 10


def fetch_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_credits(tmdb_id):
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/credits?api_key={API_KEY}"
    return fetch_json(url)


def main():
    if not API_KEY:
        print("Set TMDB_API_KEY environment variable first.", file=sys.stderr)
        sys.exit(1)

    movies = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    updated = 0
    errors = []

    for i, movie in enumerate(movies, 1):
        tmdb_id = movie.get("tmdbId")
        if not tmdb_id:
            continue

        try:
            credits = get_credits(tmdb_id)
        except urllib.error.HTTPError as e:
            errors.append(f"{movie['title']} ({tmdb_id}): HTTP {e.code}")
            time.sleep(0.3)
            continue
        except Exception as e:
            errors.append(f"{movie['title']} ({tmdb_id}): {e}")
            time.sleep(0.3)
            continue

        cast = sorted(credits.get("cast") or [], key=lambda c: c.get("order", 999))[:CAST_LIMIT]
        if cast:
            movie["cast"] = [{"name": c["name"], "role": c.get("character", "")} for c in cast]
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


if __name__ == "__main__":
    main()
