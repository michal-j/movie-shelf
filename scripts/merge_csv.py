#!/usr/bin/env python3
"""Merge the Polish CSV disc catalog into data/movies.json.

Produces a "copies" array per movie (one entry per physical disc/edition),
unions genres/directors, and creates new movie entries for CSV rows that
don't match anything already in the collection.

Policy decisions (per user, 2026-09-14):
- 7 titles matched between CSV and existing collection but with a different
  year are treated as the same movie; existing (IMDb-sourced) year wins for
  now (a later TMDB pass re-derives year/runtime for everything anyway).
- Multiple physical copies are modeled as one movie with a `copies` list.
- 3 CSV rows with zero disc detail (The Lost World 1925, The Phantom of the
  Opera 1925, Carnival of Souls 1962) are added as owned DVDs.
"""
import csv
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOVIES_PATH = ROOT / "data" / "movies.json"
CSV_PATH = ROOT / "Spis filmów DVD i Blu-ray - Sheet1.csv"

FORCE_DVD_NO_DETAIL = {
    ("thelostworld", 1925),
    ("thephantomoftheopera", 1925),
    ("carnivalofsouls", 1962),
}


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def normalize_title(t):
    t = t.strip()
    m = re.match(r"^(.*),\s*(The|A|An)$", t)
    if m:
        t = f"{m.group(2)} {m.group(1)}"
    return t


def title_key(t):
    t = strip_accents(normalize_title(t))
    return re.sub(r"[^a-z0-9]+", "", t.lower())


def split_list(s):
    if not s:
        return []
    return [p.strip() for p in s.split(",") if p.strip()]


def parse_runtime(s):
    s = (s or "").strip()
    h = re.search(r"(\d+)h", s)
    m = re.search(r"(\d+)min", s)
    total = 0
    if h:
        total += int(h.group(1)) * 60
    if m:
        total += int(m.group(1))
    return total or None


def simplify_format(raw):
    if not raw:
        return "DVD"
    r = raw.lower()
    if "4k" in r:
        return "4K Ultra HD"
    if "blu-ray" in r or "bluray" in r:
        return "Blu-ray"
    if "dvd" in r:
        return "DVD"
    return raw


FORMAT_RANK = {"DVD": 0, "Blu-ray": 1, "4K Ultra HD": 2, "Digital": 1}


def best_format(formats):
    return max(formats, key=lambda f: FORMAT_RANK.get(f, 0)) if formats else "DVD"


def load_csv_rows():
    rows = []
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            orig_title = normalize_title(r["Tytuł oryginalny"])
            year_raw = r["Rok"].strip()
            year = int(year_raw) if year_raw.isdigit() else None
            licencja = r["Licencja"].strip().lower()
            rows.append({
                "originalTitle": orig_title,
                "polishTitle": r["Tytuł polski"].strip(),
                "year": year,
                "genres": split_list(r["Gatunek"]),
                "directors": split_list(r["Reżyseria"]),
                "runtimeMinutes": parse_runtime(r["Czas trwania"]),
                "distributor": r["Dystrybutor"].strip(),
                "polishLicensedRelease": (licencja == "tak") if licencja in ("tak", "nie") else None,
                "aspectRatio": r["Obraz"].strip(),
                "audioLanguages": split_list(r["Ścieżka audio"]),
                "subtitleLanguages": split_list(r["Napisy"]),
                "edition": r["Wydanie"].strip(),
                "formatRaw": r["Nośnik"].strip(),
                "extras": r["Dodatki"].strip(),
                "notes": r["Uwagi"].strip(),
            })
    return rows


def csv_row_to_copy(row):
    return {
        "format": simplify_format(row["formatRaw"]) if row["formatRaw"] else "DVD",
        "formatDetail": row["formatRaw"] or None,
        "edition": row["edition"] or None,
        "distributor": row["distributor"] or None,
        "aspectRatio": row["aspectRatio"] or None,
        "audioLanguages": row["audioLanguages"],
        "subtitleLanguages": row["subtitleLanguages"],
        "extras": row["extras"] or None,
        "polishLicensedRelease": row["polishLicensedRelease"],
        "notes": row["notes"] or None,
        "source": "csv",
    }


def xml_movie_to_copy(m):
    return {
        "format": m.get("format") or "DVD",
        "formatDetail": None,
        "edition": m.get("edition") or None,
        "distributor": ", ".join(m.get("studios") or []) or None,
        "aspectRatio": m.get("aspectRatio") or None,
        "audioLanguages": m.get("audioLanguages") or [],
        "subtitleLanguages": m.get("subtitleLanguages") or [],
        "extras": "Yes" if m.get("hasExtras") else None,
        "polishLicensedRelease": None,
        "notes": None,
        "source": "my-movies",
    }


def dedupe_names(names):
    seen = {}
    for n in names:
        key = re.sub(r"\s*\([IVX]+\)\s*$", "", n)  # strip IMDb disambiguation suffix like (II)
        key = strip_accents(key).lower().strip()
        if key not in seen:
            seen[key] = n
    return list(seen.values())


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "movie"


YEAR_TOLERANCE = 3


def main():
    movies = json.loads(MOVIES_PATH.read_text(encoding="utf-8"))
    csv_rows = load_csv_rows()

    # Phase A: group CSV rows into units by EXACT (title, year) — this is what
    # identifies genuinely duplicate owned copies, without conflating same-title
    # movies from different eras (e.g. King Kong 1933 vs King Kong 2005).
    csv_units = {}
    for row in csv_rows:
        unit_key = (title_key(row["originalTitle"]), row["year"])
        csv_units.setdefault(unit_key, []).append(row)

    # Index existing movies by title key (a title key can have >1 base movie,
    # e.g. remakes: "The Italian Job" 1969 and 2003 both exist already).
    base_by_key = {}
    for m in movies:
        base_by_key.setdefault(title_key(m["originalTitle"] or m["title"]), []).append(m)

    matched_ids = set()
    stats = {"enriched_single": 0, "enriched_multi": 0, "new_single": 0, "new_multi": 0}
    ambiguous = []

    # Phase B: match each CSV unit to the closest base movie by year (within tolerance).
    for (tkey, year), rows in csv_units.items():
        candidates = base_by_key.get(tkey, [])
        target = None
        if candidates:
            target = min(candidates, key=lambda m: abs((m["year"] or 0) - (year or 0)))
            if year is not None and target["year"] is not None and abs(target["year"] - year) > YEAR_TOLERANCE:
                target = None
            if len(candidates) > 1:
                ambiguous.append((rows[0]["originalTitle"], year, [c["year"] for c in candidates]))

        if target is not None:
            matched_ids.add(target["id"])
            if len(rows) >= 2:
                target["copies"] = [csv_row_to_copy(r) for r in rows]
                stats["enriched_multi"] += 1
            else:
                row = rows[0]
                copy = xml_movie_to_copy(target)
                copy["formatDetail"] = row["formatRaw"] or None
                copy["distributor"] = copy["distributor"] or row["distributor"] or None
                copy["aspectRatio"] = copy["aspectRatio"] or row["aspectRatio"] or None
                copy["audioLanguages"] = copy["audioLanguages"] or row["audioLanguages"]
                copy["subtitleLanguages"] = copy["subtitleLanguages"] or row["subtitleLanguages"]
                copy["edition"] = copy["edition"] or row["edition"] or None
                copy["extras"] = copy["extras"] or (row["extras"] or None)
                copy["polishLicensedRelease"] = row["polishLicensedRelease"]
                copy["notes"] = row["notes"] or None
                copy["source"] = "my-movies+csv"
                target["copies"] = [copy]
                stats["enriched_single"] += 1

            target["format"] = best_format([c["format"] for c in target["copies"]])
            target["genres"] = list(dict.fromkeys(target.get("genres", []) + [g for r in rows for g in r["genres"]]))
            target["director"] = dedupe_names((target.get("director") or []) + [d for r in rows for d in r["directors"]])
            if not target.get("polishTitle"):
                target["polishTitle"] = rows[0]["polishTitle"] or None
            target["hasExtras"] = target.get("hasExtras") or any(c["extras"] for c in target["copies"])
            continue

        # No base match within tolerance -> brand-new movie.
        first = rows[0]
        copies = [csv_row_to_copy(r) for r in rows]
        if (tkey, year) in FORCE_DVD_NO_DETAIL:
            for c in copies:
                c["format"] = "DVD"

        if len(rows) >= 2:
            stats["new_multi"] += 1
        else:
            stats["new_single"] += 1

        new_movie = {
            "id": f"csv-{slugify(first['originalTitle'])}-{year or 'na'}",
            "imdbId": None,
            "imdbLink": None,
            "title": first["originalTitle"],
            "originalTitle": first["originalTitle"],
            "polishTitle": first["polishTitle"] or None,
            "year": year,
            "imdbRating": None,
            "runtimeMinutes": first["runtimeMinutes"],
            "genres": list(dict.fromkeys([g for r in rows for g in r["genres"]])),
            "director": dedupe_names([d for r in rows for d in r["directors"]]),
            "writers": [],
            "cast": [],
            "studios": list(dict.fromkeys([r["distributor"] for r in rows if r["distributor"]])),
            "format": best_format([c["format"] for c in copies]),
            "edition": first["edition"] or None,
            "aspectRatio": first["aspectRatio"] or None,
            "audioLanguages": first["audioLanguages"],
            "subtitleLanguages": first["subtitleLanguages"],
            "hasExtras": any(c["extras"] for c in copies),
            "description": "",
            "dateAdded": None,
            "collectionNumber": None,
            "posterUrl": None,
            "backdropUrl": None,
            "tmdbId": None,
            "copies": copies,
        }
        movies.append(new_movie)

    # Any base movie that never got a copies list (no CSV row matched it at all)
    for m in movies:
        if "copies" not in m:
            m["copies"] = [xml_movie_to_copy(m)]

    movies.sort(key=lambda m: (m["title"] or "").lower())

    MOVIES_PATH.write_text(json.dumps(movies, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Existing movies enriched (1 copy): {stats['enriched_single']}")
    print(f"Existing movies enriched (multi-copy): {stats['enriched_multi']}")
    print(f"New movies added (1 copy): {stats['new_single']}")
    print(f"New movies added (multi-copy): {stats['new_multi']}")
    print(f"Total movies now: {len(movies)}")
    if ambiguous:
        print()
        print("Ambiguous title matches (multiple base candidates, picked nearest year):")
        for title, year, cand_years in ambiguous:
            print(f"  {title} ({year}) -> base candidates at {cand_years}")


if __name__ == "__main__":
    main()
