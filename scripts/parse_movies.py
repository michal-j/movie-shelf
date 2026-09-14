#!/usr/bin/env python3
"""Parse the My Movies XML export into a clean movies.json for the prototype."""
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "movies_export_from_my_movies_2.xml"
OUT = ROOT / "data" / "movies.json"


def text(el, tag, default=""):
    child = el.find(tag)
    if child is None or child.text is None:
        return default
    return child.text.strip()


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "movie"


def parse_title(title_el):
    web_id = text(title_el, "WebServiceID")
    imdb = text(title_el, "IMDB")
    local_title = text(title_el, "LocalTitle")
    original_title = text(title_el, "OriginalTitle") or local_title
    year_raw = text(title_el, "ProductionYear")
    year = int(year_raw) if year_raw.isdigit() else None
    rating_raw = text(title_el, "Rating")
    try:
        imdb_rating = float(rating_raw)
    except ValueError:
        imdb_rating = None
    runtime_raw = text(title_el, "RunningTime")
    runtime = int(runtime_raw) if runtime_raw.isdigit() else None
    aspect_ratio = text(title_el, "AspectRatio")
    edition = text(title_el, "Edition")
    description = text(title_el, "Description")

    type_el = title_el.find("Type")
    format_ = (type_el.text or "").strip() if type_el is not None else ""

    genres = [g.text.strip() for g in title_el.findall("./Genres/Genre") if g.text]
    studios = [s.text.strip() for s in title_el.findall("./Studios/Studio") if s.text]

    directors, writers, cast = [], [], []
    for person in title_el.findall("./Persons/Person"):
        name = text(person, "Name")
        ptype = text(person, "Type")
        role = text(person, "Role")
        if not name:
            continue
        if ptype == "Director":
            directors.append(name)
        elif ptype == "Writer":
            writers.append(name)
        elif ptype == "Actor":
            cast.append({"name": name, "role": role})

    audio_langs = sorted({
        a.get("Language", "") for a in title_el.findall("./AudioTracks/AudioTrack") if a.get("Language")
    })
    subtitle_langs = sorted({
        s.get("Language", "") for s in title_el.findall("./Subtitles/Subtitle") if s.get("Language")
    })

    extras_el = title_el.find("ExtraFeatures")
    has_extras = bool(extras_el is not None and extras_el.text and extras_el.text.strip())

    added = text(title_el, "./Personal/Added")
    collection_number_raw = text(title_el, "./Personal/CollectionNumber")
    collection_number = int(collection_number_raw) if collection_number_raw.isdigit() else None

    movie_id = web_id or slugify(f"{original_title}-{year}")

    return {
        "id": movie_id,
        "imdbId": imdb,
        "imdbLink": f"https://www.imdb.com/title/{imdb}/" if imdb else None,
        "title": local_title or original_title,
        "originalTitle": original_title,
        "year": year,
        "imdbRating": imdb_rating,
        "runtimeMinutes": runtime,
        "genres": genres,
        "director": directors,
        "writers": writers,
        "cast": cast[:10],
        "studios": studios,
        "format": format_,
        "edition": edition,
        "aspectRatio": aspect_ratio,
        "audioLanguages": audio_langs,
        "subtitleLanguages": subtitle_langs,
        "hasExtras": has_extras,
        "description": description,
        "dateAdded": added,
        "collectionNumber": collection_number,
    }


def main():
    tree = ET.parse(SRC)
    root = tree.getroot()
    movies = []
    for title_el in root.findall("Title"):
        media_type = text(title_el, "MediaType")
        if media_type != "Movie":
            continue
        movies.append(parse_title(title_el))

    movies.sort(key=lambda m: (m["title"] or "").lower())

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(movies, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(movies)} movies to {OUT}")


if __name__ == "__main__":
    main()
