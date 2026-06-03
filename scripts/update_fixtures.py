from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures.json"
REPORT = ROOT / "fixtures_update_report.json"

YEAR = 2026
URLS = [
    f"https://www.nrlsupercoachstats.com/drawV2.php?year={YEAR}",
    f"https://www.nrlsupercoachstats.com/draw.php?year={YEAR}",
]

TEAMS = {
    "BRO":["broncos","brisbane"],
    "DOL":["dolphins"],
    "PEN":["panthers","penrith"],
    "NQC":["cowboys","north queensland"],
    "MEL":["storm","melbourne"],
    "GLD":["titans","gold coast"],
    "NEW":["knights","newcastle"],
    "CBR":["raiders","canberra"],
    "SYD":["roosters","sydney roosters"],
    "MAN":["sea eagles","manly"],
    "STH":["rabbitohs","south sydney"],
    "WST":["tigers","wests tigers"],
    "SHA":["sharks","cronulla"],
    "STG":["dragons","st george"],
    "CAN":["bulldogs","canterbury"],
    "PAR":["eels","parramatta"],
    "NZL":["warriors","new zealand"],
}

VENUE_CITY = {
    "Suncorp Stadium": ("Brisbane", -27.4648, 153.0095, "Australia/Brisbane"),
    "Queensland Country Bank Stadium": ("Townsville", -19.2564, 146.8183, "Australia/Brisbane"),
    "AAMI Park": ("Melbourne", -37.8240, 144.9834, "Australia/Melbourne"),
    "Accor Stadium": ("Sydney", -33.8472, 151.0634, "Australia/Sydney"),
    "Allianz Stadium": ("Sydney", -33.8890, 151.2250, "Australia/Sydney"),
    "McDonald Jones Stadium": ("Newcastle", -32.9188, 151.7260, "Australia/Sydney"),
    "GIO Stadium": ("Canberra", -35.2509, 149.1013, "Australia/Sydney"),
    "4 Pines Park": ("Sydney", -33.7855, 151.2847, "Australia/Sydney"),
    "PointsBet Stadium": ("Sydney", -34.0417, 151.1403, "Australia/Sydney"),
    "WIN Stadium": ("Wollongong", -34.4269, 150.9027, "Australia/Sydney"),
    "CommBank Stadium": ("Sydney", -33.8081, 150.9996, "Australia/Sydney"),
    "Go Media Stadium": ("Auckland", -36.9183, 174.8120, "Pacific/Auckland"),
    "Cbus Super Stadium": ("Gold Coast", -28.0064, 153.3783, "Australia/Brisbane"),
}

HEADERS = {"User-Agent": "Mozilla/5.0"}

def code_from_text(text: Any) -> str:
    low = str(text or "").lower()
    for code, aliases in TEAMS.items():
        if any(a in low for a in aliases):
            return code
    return ""

def clean(v: Any) -> str:
    return "" if v is None else str(v).strip()

def norm_col(c: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(c or "").lower())

def find_col(df: pd.DataFrame, names: list[str]) -> str | None:
    lookup = {norm_col(c): c for c in df.columns}
    for n in names:
        if norm_col(n) in lookup:
            return lookup[norm_col(n)]
    for c in df.columns:
        nc = norm_col(c)
        if any(norm_col(n) in nc for n in names):
            return c
    return None

def parse_tables(html: str) -> list[pd.DataFrame]:
    return pd.read_html(StringIO(html))

def add_venue_meta(f: dict[str, Any]) -> None:
    venue = f.get("venue", "")
    for key, meta in VENUE_CITY.items():
        if key.lower() in venue.lower():
            city, lat, lon, tz = meta
            f.setdefault("city", city)
            f.setdefault("lat", lat)
            f.setdefault("lon", lon)
            f.setdefault("timezone", tz)
            return
    f.setdefault("city", "")
    f.setdefault("lat", None)
    f.setdefault("lon", None)
    f.setdefault("timezone", "Australia/Brisbane")

def extract_from_table(df: pd.DataFrame) -> list[dict[str, Any]]:
    out = []
    round_col = find_col(df, ["Round", "Rnd", "Rd"])
    home_col = find_col(df, ["Home", "Home Team"])
    away_col = find_col(df, ["Away", "Away Team"])
    match_col = find_col(df, ["Match", "Game", "Fixture"])
    venue_col = find_col(df, ["Venue", "Stadium", "Ground"])
    date_col = find_col(df, ["Date", "Kickoff", "Kick Off", "Time"])

    for _, row in df.iterrows():
        text = " ".join(clean(row.get(c)) for c in df.columns)
        if not text or text.lower().startswith("round"):
            continue

        home = code_from_text(row.get(home_col)) if home_col else ""
        away = code_from_text(row.get(away_col)) if away_col else ""

        match_text = clean(row.get(match_col)) if match_col else text
        if not (home and away):
            found = []
            for code, aliases in TEAMS.items():
                if any(a in match_text.lower() for a in aliases):
                    found.append(code)
            found = list(dict.fromkeys(found))
            if len(found) >= 2:
                home, away = found[0], found[1]

        if not (home and away):
            continue

        rnd_raw = clean(row.get(round_col)) if round_col else ""
        rnd_match = re.search(r"\d+", rnd_raw or text)
        rnd = int(rnd_match.group()) if rnd_match else None

        venue = clean(row.get(venue_col)) if venue_col else ""
        kickoff = clean(row.get(date_col)) if date_col else ""

        f = {
            "round": rnd,
            "match": f"{home} v {away}",
            "homeTeam": home,
            "awayTeam": away,
            "venue": venue,
            "kickoffLocal": kickoff,
        }
        add_venue_meta(f)
        out.append(f)
    return out

def main():
    report = {"updated": datetime.now(timezone.utc).isoformat(), "sources": [], "fixturesFound": 0, "warnings": []}
    fixtures = []

    for url in URLS:
        src = {"url": url}
        try:
            r = requests.get(url, headers=HEADERS, timeout=40)
            src["http_status"] = r.status_code
            src["content_length"] = len(r.text)
            r.raise_for_status()
            tables = parse_tables(r.text)
            src["tables"] = len(tables)
            for df in tables:
                fixtures.extend(extract_from_table(df))
            src["fixtures_after"] = len(fixtures)
        except Exception as e:
            src["error"] = str(e)
        report["sources"].append(src)

    # de-dupe
    seen = set()
    clean_fixtures = []
    for f in fixtures:
        key = (f.get("round"), f.get("homeTeam"), f.get("awayTeam"))
        if key in seen:
            continue
        seen.add(key)
        clean_fixtures.append(f)

    rounds = sorted({int(f["round"]) for f in clean_fixtures if f.get("round")})
    byes = {}
    for rnd in rounds:
        teams_playing = set()
        for f in clean_fixtures:
            if f.get("round") == rnd:
                teams_playing.add(f.get("homeTeam"))
                teams_playing.add(f.get("awayTeam"))
        byes[str(rnd)] = sorted(set(TEAMS.keys()) - teams_playing)

    if not clean_fixtures:
        report["warnings"].append("No fixtures parsed. You may need to use fixtures_full_draw.csv importer instead.")

    data = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "auto update fixtures from public draw tables",
        "year": YEAR,
        "rounds": rounds,
        "fixtures": clean_fixtures,
        "byes": byes,
        "note": "If venue/kickoff is missing, next-5 model will lower confidence and refuse fake full averages."
    }

    report["fixturesFound"] = len(clean_fixtures)
    report["roundsFound"] = rounds
    OUT.write_text(json.dumps(data, indent=2), encoding="utf-8")
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
