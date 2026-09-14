#!/usr/bin/env python3
"""Enrich data/movies.json with poster/backdrop URLs from TMDB, keyed by IMDb ID.

Requires the TMDB_API_KEY environment variable (v3 API key).
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
IMG_BASE = "https://image.tmdb.org/t/p"


def fetch_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def find_by_imdb(imdb_id):
    url = (
        f"https://api.themoviedb.org/3/find/{imdb_id}"
        f"?api_key={API_KEY}&external_source=imdb_id"
    )
    data = fetch_json(url)
    results = data.get("movie_results") or []
    if not results:
        return None
    return results[0]


def main():
    if not API_KEY:
        print("Set TMDB_API_KEY environment variable first.", file=sys.stderr)
        sys.exit(1)

    movies = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    hits, misses, skipped = 0, 0, 0

    for i, movie in enumerate(movies, 1):
        if movie.get("posterUrl"):
            skipped += 1
            continue
        imdb_id = movie.get("imdbId")
        if not imdb_id:
            misses += 1
            continue
        try:
            result = find_by_imdb(imdb_id)
        except urllib.error.HTTPError as e:
            print(f"[{i}/{len(movies)}] HTTP {e.code} for {imdb_id} ({movie['title']})", file=sys.stderr)
            time.sleep(0.3)
            continue
        except Exception as e:
            print(f"[{i}/{len(movies)}] error for {imdb_id} ({movie['title']}): {e}", file=sys.stderr)
            time.sleep(0.3)
            continue

        if result and result.get("poster_path"):
            movie["posterUrl"] = f"{IMG_BASE}/w500{result['poster_path']}"
            movie["backdropUrl"] = (
                f"{IMG_BASE}/w1280{result['backdrop_path']}" if result.get("backdrop_path") else None
            )
            movie["tmdbId"] = result.get("id")
            hits += 1
        else:
            movie["posterUrl"] = None
            misses += 1

        if i % 20 == 0:
            print(f"[{i}/{len(movies)}] hits={hits} misses={misses}")
        time.sleep(0.05)

    DATA_PATH.write_text(json.dumps(movies, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Done. hits={hits} misses={misses} skipped={skipped} total={len(movies)}")


if __name__ == "__main__":
    main()
