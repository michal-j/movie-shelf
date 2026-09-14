#!/usr/bin/env python3
"""Make TMDB the source of truth for year/runtime across the whole collection,
and resolve posters/IMDb IDs for movies that came in from the CSV merge.

Requires TMDB_API_KEY in the environment.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
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


def get_details(tmdb_id):
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={API_KEY}"
    return fetch_json(url)


def search_movie(title, year):
    params = {"api_key": API_KEY, "query": title}
    if year:
        params["year"] = year
    url = "https://api.themoviedb.org/3/search/movie?" + urllib.parse.urlencode(params)
    data = fetch_json(url)
    return data.get("results") or []


def apply_details(movie, details):
    if details.get("release_date"):
        try:
            movie["year"] = int(details["release_date"][:4])
        except ValueError:
            pass
    if details.get("runtime"):
        movie["runtimeMinutes"] = details["runtime"]
    if details.get("poster_path"):
        movie["posterUrl"] = f"{IMG_BASE}/w500{details['poster_path']}"
    if details.get("backdrop_path"):
        movie["backdropUrl"] = f"{IMG_BASE}/w1280{details['backdrop_path']}"
    if details.get("imdb_id"):
        movie["imdbId"] = details["imdb_id"]
        movie["imdbLink"] = f"https://www.imdb.com/title/{details['imdb_id']}/"
    if movie.get("imdbRating") is None and details.get("vote_average"):
        movie["imdbRating"] = round(details["vote_average"], 1)
    if not movie.get("description") and details.get("overview"):
        movie["description"] = details["overview"]
    movie["tmdbId"] = details.get("id", movie.get("tmdbId"))


def main():
    if not API_KEY:
        print("Set TMDB_API_KEY environment variable first.", file=sys.stderr)
        sys.exit(1)

    movies = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    unresolved = []
    updated = 0

    for i, movie in enumerate(movies, 1):
        try:
            if movie.get("tmdbId"):
                details = get_details(movie["tmdbId"])
                apply_details(movie, details)
                updated += 1
            else:
                results = search_movie(movie["originalTitle"] or movie["title"], movie.get("year"))
                if not results:
                    results = search_movie(movie["title"], movie.get("year"))
                if results:
                    details = get_details(results[0]["id"])
                    apply_details(movie, details)
                    updated += 1
                else:
                    unresolved.append(f"{movie['title']} ({movie.get('year')}) [{movie['id']}]")
        except urllib.error.HTTPError as e:
            print(f"[{i}/{len(movies)}] HTTP {e.code} for {movie['title']}", file=sys.stderr)
            time.sleep(0.3)
        except Exception as e:
            print(f"[{i}/{len(movies)}] error for {movie['title']}: {e}", file=sys.stderr)
            time.sleep(0.3)

        if i % 40 == 0:
            print(f"[{i}/{len(movies)}] updated={updated} unresolved={len(unresolved)}")
        time.sleep(0.05)

    DATA_PATH.write_text(json.dumps(movies, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Done. updated={updated} unresolved={len(unresolved)} total={len(movies)}")
    if unresolved:
        print("\nUnresolved (no TMDB match found):")
        for u in unresolved:
            print(" -", u)


if __name__ == "__main__":
    main()
