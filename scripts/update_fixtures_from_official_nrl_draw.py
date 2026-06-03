from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pdfplumber
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures.json"
REPORT = ROOT / "fixtures_update_report.json"
PDF_PATH = ROOT / "nrl_draw_2026_final.pdf"

PDF_URL = "https://www.nrl.com/globalassets/nrl-draw-2026---final.pdf"

TEAM_ALIASES = {
    "BRO": ["Broncos", "Brisbane Broncos"],
    "DOL": ["Dolphins"],
    "PEN": ["Panthers", "Penrith Panthers"],
    "NQC": ["Cowboys", "North Queensland Cowboys"],
    "MEL": ["Storm", "Melbourne Storm"],
    "GLD": ["Titans", "Gold Coast Titans"],
    "NEW": ["Knights", "Newcastle Knights"],
    "CBR": ["Raiders", "Canberra Raiders"],
    "SYD": ["Roosters", "Sydney Roosters"],
    "MAN": ["Sea Eagles", "Manly Sea Eagles", "Manly Warringah Sea Eagles"],
    "STH": ["Rabbitohs", "South Sydney Rabbitohs"],
    "WST": ["Tigers", "Wests Tigers"],
    "SHA": ["Sharks", "Cronulla Sharks"],
    "STG": ["Dragons", "St George Illawarra Dragons"],
    "CAN": ["Bulldogs", "Canterbury Bulldogs", "Canterbury-Bankstown Bulldogs"],
    "PAR": ["Eels", "Parramatta Eels"],
    "NZL": ["Warriors", "New Zealand Warriors"],
}

TEAM_NAME = {
    "BRO": "Broncos", "DOL": "Dolphins", "PEN": "Panthers", "NQC": "Cowboys",
    "MEL": "Storm", "GLD": "Titans", "NEW": "Knights", "CBR": "Raiders",
    "SYD": "Roosters", "MAN": "Sea Eagles", "STH": "Rabbitohs", "WST": "Tigers",
    "SHA": "Sharks", "STG": "Dragons", "CAN": "Bulldogs", "PAR": "Eels", "NZL": "Warriors",
}

VENUE_META = {
    "Suncorp Stadium": ("Brisbane", -27.4648, 153.0095, "Australia/Brisbane"),
    "Qld Country Bank Stadium": ("Townsville", -19.2564, 146.8183, "Australia/Brisbane"),
    "Queensland Country Bank Stadium": ("Townsville", -19.2564, 146.8183, "Australia/Brisbane"),
    "Accor Stadium": ("Sydney", -33.8472, 151.0634, "Australia/Sydney"),
    "Allianz Stadium": ("Sydney", -33.8890, 151.2250, "Australia/Sydney"),
    "Commbank Stadium": ("Sydney", -33.8081, 150.9996, "Australia/Sydney"),
    "CommBank Stadium": ("Sydney", -33.8081, 150.9996, "Australia/Sydney"),
    "4 Pines Park": ("Sydney", -33.7855, 151.2847, "Australia/Sydney"),
    "Sharks Stadium": ("Sydney", -34.0417, 151.1403, "Australia/Sydney"),
    "PointsBet Stadium": ("Sydney", -34.0417, 151.1403, "Australia/Sydney"),
    "Netstrata Jubilee Stadium": ("Sydney", -33.9859, 151.1358, "Australia/Sydney"),
    "Leichhardt Oval": ("Sydney", -33.8794, 151.1567, "Australia/Sydney"),
    "Campbelltown Stadium": ("Sydney", -34.0537, 150.8334, "Australia/Sydney"),
    "AAMI Park": ("Melbourne", -37.8240, 144.9834, "Australia/Melbourne"),
    "McDonald Jones Stadium": ("Newcastle", -32.9188, 151.7260, "Australia/Sydney"),
    "GIO Stadium": ("Canberra", -35.2509, 149.1013, "Australia/Sydney"),
    "Cbus Super Stadium": ("Gold Coast", -28.0064, 153.3783, "Australia/Brisbane"),
    "Go Media Stadium": ("Auckland", -36.9183, 174.8120, "Pacific/Auckland"),
    "One NZ Stadium": ("Christchurch", -43.5330, 172.6203, "Pacific/Auckland"),
    "WIN Stadium": ("Wollongong", -34.4269, 150.9027, "Australia/Sydney"),
    "Kayo Stadium": ("Brisbane", -27.2322, 153.1001, "Australia/Brisbane"),
    "Polytec Stadium": ("Sunshine Coast", -26.7398, 153.1247, "Australia/Brisbane"),
    "SKY Stadium": ("Wellington", -41.2733, 174.7859, "Pacific/Auckland"),
}

MONTHS = {
    "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9,
}

def code_from_name(name: str) -> str:
    low = name.lower()
    for code, aliases in TEAM_ALIASES.items():
        for alias in aliases:
            if alias.lower() == low or alias.lower() in low:
                return code
    return ""

def add_venue_meta(f: dict[str, Any]) -> None:
    venue = f.get("venue", "")
    for key, meta in VENUE_META.items():
        if key.lower() in venue.lower():
            city, lat, lon, tz = meta
            f["city"] = city
            f["lat"] = lat
            f["lon"] = lon
            f["timezone"] = tz
            return
    f["city"] = ""
    f["lat"] = None
    f["lon"] = None
    f["timezone"] = "Australia/Sydney"

def download_pdf() -> None:
    r = requests.get(PDF_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    PDF_PATH.write_bytes(r.content)

def extract_text() -> str:
    if not PDF_PATH.exists():
        download_pdf()
    pages = []
    with pdfplumber.open(str(PDF_PATH)) as pdf:
        for p in pdf.pages:
            pages.append(p.extract_text() or "")
    return "\n".join(pages)

def clean_line(line: str) -> str:
    line = re.sub(r"\s+", " ", line.strip())
    return line

def parse_round_name(line: str) -> int | None:
    # Handles Round Fourteen, Round 14, etc.
    nums = {
        "One":1,"Two":2,"Three":3,"Four":4,"Five":5,"Six":6,"Seven":7,"Eight":8,"Nine":9,"Ten":10,
        "Eleven":11,"Twelve":12,"Thirteen":13,"Fourteen":14,"Fifteen":15,"Sixteen":16,"Seventeen":17,
        "Eighteen":18,"Nineteen":19,"Twenty":20,"Twenty-One":21,"Twenty-Two":22,"Twenty-Three":23,
        "Twenty-Four":24,"Twenty-Five":25,"Twenty-Six":26,"Twenty-Seven":27
    }
    m = re.search(r"\bRound\s+(\d+)\b", line, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"\bRound\s+([A-Za-z\-]+)\b", line)
    if m:
        return nums.get(m.group(1))
    return None

def parse_time_token(text: str) -> str:
    # Return last PM/AM time if present.
    times = re.findall(r"\b(\d{1,2}:\d{2})\s*(AM|PM)\b", text, re.I)
    if not times:
        return ""
    hhmm, ap = times[-1]
    h, m = map(int, hhmm.split(":"))
    ap = ap.upper()
    if ap == "PM" and h != 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return f"{h:02d}:{m:02d}:00"

def parse_date_context(line: str, year: int = 2026) -> str:
    m = re.search(r"\b(?:Thursday|Friday|Saturday|Sunday|Monday|Tuesday|Wednesday),?\s+([A-Z][a-z]{2})\s+(\d{1,2})\b", line)
    if not m:
        return ""
    mon = MONTHS.get(m.group(1))
    day = int(m.group(2))
    if not mon:
        return ""
    return f"{year}-{mon:02d}-{day:02d}"

def identify_match(line: str) -> tuple[str, str] | None:
    # Find "Team A vs. Team B" or "Team A vs Team B"
    m = re.search(r"(.+?)\s+vs\.?\s+(.+?)(?:\s{2,}|$)", line, re.I)
    if not m:
        return None
    left = m.group(1).strip()
    right_and_rest = m.group(2).strip()

    # Right team may be followed by venue. Find best alias at start.
    left_code = code_from_name(left)
    right_code = ""
    for code, aliases in TEAM_ALIASES.items():
        for alias in aliases:
            if right_and_rest.lower().startswith(alias.lower()):
                right_code = code
                return left_code, right_code
    return None

def extract_venue(line: str) -> str:
    for venue in sorted(VENUE_META.keys(), key=len, reverse=True):
        if venue.lower() in line.lower():
            return venue
    # fallback: between away team and (Fox/Nine) is messy; leave blank if unknown.
    return ""

def parse_fixtures(text: str) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    fixtures = []
    byes_by_round: dict[str, list[str]] = {}
    current_round = None
    current_date = ""

    for raw in text.splitlines():
        line = clean_line(raw)
        if not line:
            continue

        rnd = parse_round_name(line)
        if rnd:
            current_round = rnd
            current_date = ""
            continue

        dt = parse_date_context(line)
        if dt:
            current_date = dt

        if current_round and line.startswith("Byes:"):
            names = line.replace("Byes:", "").strip()
            bye_codes = []
            for part in re.split(r",| and ", names):
                c = code_from_name(part.strip())
                if c:
                    bye_codes.append(c)
            byes_by_round[str(current_round)] = sorted(set(bye_codes))
            continue

        if not current_round:
            continue

        match = identify_match(line)
        if not match:
            continue
        home, away = match
        if not home or not away:
            continue

        venue = extract_venue(line)
        time = parse_time_token(line)
        kickoff = f"{current_date}T{time}" if current_date and time else ""

        f = {
            "round": current_round,
            "match": f"{TEAM_NAME[home]} v {TEAM_NAME[away]}",
            "homeTeam": home,
            "awayTeam": away,
            "venue": venue,
            "kickoffLocal": kickoff,
        }
        add_venue_meta(f)
        fixtures.append(f)

    # fill byes when not explicitly parsed: teams not playing in that round.
    all_teams = set(TEAM_NAME.keys())
    rounds = sorted({f["round"] for f in fixtures})
    for rnd in rounds:
        playing = set()
        for f in fixtures:
            if f["round"] == rnd:
                playing.add(f["homeTeam"])
                playing.add(f["awayTeam"])
        byes_by_round.setdefault(str(rnd), sorted(all_teams - playing))

    return fixtures, byes_by_round

def main():
    report = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": PDF_URL,
        "status": "started",
    }

    try:
        text = extract_text()
        fixtures, byes = parse_fixtures(text)
        rounds = sorted({f["round"] for f in fixtures})

        data = {
            "updated": datetime.now(timezone.utc).isoformat(),
            "source": "Official NRL 2026 draw PDF",
            "sourceUrl": PDF_URL,
            "year": 2026,
            "rounds": rounds,
            "fixtures": fixtures,
            "byes": byes,
            "note": "Parsed from official NRL draw PDF. Venue/kickoff missing rows reduce projection confidence."
        }
        OUT.write_text(json.dumps(data, indent=2), encoding="utf-8")

        report.update({
            "status": "ok",
            "fixturesFound": len(fixtures),
            "roundsFound": rounds,
            "byesRounds": sorted(byes.keys(), key=lambda x: int(x)),
            "sample": fixtures[:5],
        })
    except Exception as e:
        report.update({
            "status": "failed",
            "error": str(e),
            "message": "Official PDF import failed. Use fixtures_full_draw.csv fallback."
        })

    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))

    if report["status"] != "ok" or report.get("fixturesFound", 0) < 50:
        raise RuntimeError("Fixture import did not produce enough fixtures. Check fixtures_update_report.json.")

if __name__ == "__main__":
    main()
