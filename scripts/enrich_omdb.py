#!/usr/bin/env python3
"""Make OMDb (i.e. IMDb's own data) the source of truth for rating, runtime,
genre, plot, director/writers, and Metascore. TMDB posters/backdrops are left
untouched — OMDb's own poster images are lower quality.

Requires OMDB_API_KEY in the environment. Looks up each movie by its IMDb ID
(already resolved via TMDB), so there's no title-matching ambiguity.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "movies.json"
API_KEY = os.environ.get("OMDB_API_KEY")

SKIP_IDS = {"csv-mortal-kombat-conquest-1998"}  # left as-is per user


def fetch_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def omdb_by_id(imdb_id):
    url = "http://www.omdbapi.com/?" + urllib.parse.urlencode({"apikey": API_KEY, "i": imdb_id, "plot": "full"})
    return fetch_json(url)


def parse_runtime(s):
    if not s or s == "N/A":
        return None
    m = re.search(r"(\d+)", s)
    return int(m.group(1)) if m else None


def split_credit(s):
    if not s or s == "N/A":
        return []
    parts = [p.strip() for p in s.split(",")]
    cleaned = []
    for p in parts:
        p = re.sub(r"\s*\([^)]*\)\s*$", "", p).strip()
        if p:
            cleaned.append(p)
    return cleaned


def main():
    if not API_KEY:
        print("Set OMDB_API_KEY environment variable first.", file=sys.stderr)
        sys.exit(1)

    movies = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    updated = 0
    skipped_no_id = 0
    errors = []

    for i, movie in enumerate(movies, 1):
        if movie["id"] in SKIP_IDS:
            continue
        imdb_id = movie.get("imdbId")
        if not imdb_id:
            skipped_no_id += 1
            continue

        try:
            data = omdb_by_id(imdb_id)
        except Exception as e:
            errors.append(f"{movie['title']} ({imdb_id}): {e}")
            time.sleep(0.3)
            continue

        if data.get("Response") != "True":
            errors.append(f"{movie['title']} ({imdb_id}): {data.get('Error')}")
            time.sleep(0.05)
            continue

        if data.get("imdbRating") not in (None, "N/A"):
            movie["imdbRating"] = float(data["imdbRating"])
        if data.get("imdbVotes") not in (None, "N/A"):
            movie["imdbVotes"] = int(data["imdbVotes"].replace(",", ""))
        if data.get("Metascore") not in (None, "N/A"):
            movie["metascore"] = int(data["Metascore"])
        else:
            movie.setdefault("metascore", None)

        rt = parse_runtime(data.get("Runtime"))
        if rt:
            movie["runtimeMinutes"] = rt

        if data.get("Genre") not in (None, "N/A"):
            movie["genres"] = split_credit(data["Genre"])

        if data.get("Country") not in (None, "N/A"):
            movie["countries"] = split_credit(data["Country"])

        directors = split_credit(data.get("Director"))
        if directors:
            movie["director"] = directors

        writers = split_credit(data.get("Writer"))
        if writers:
            movie["writers"] = writers

        if not movie.get("cast"):
            actors = split_credit(data.get("Actors"))
            if actors:
                movie["cast"] = [{"name": a, "role": ""} for a in actors]

        if data.get("Plot") not in (None, "N/A"):
            movie["description"] = data["Plot"]

        updated += 1
        if i % 40 == 0:
            print(f"[{i}/{len(movies)}] updated={updated} errors={len(errors)}")
        time.sleep(0.05)

    DATA_PATH.write_text(json.dumps(movies, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Done. updated={updated} skipped_no_id={skipped_no_id} errors={len(errors)} total={len(movies)}")
    if errors:
        print("\nErrors:")
        for e in errors:
            print(" -", e)


if __name__ == "__main__":
    main()
