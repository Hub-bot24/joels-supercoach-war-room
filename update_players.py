"""
Joel's SuperCoach War Room - Data Pipeline V1

Purpose:
- Pull public NRL SuperCoach price/BE style tables where available.
- Merge matching rows into players.json.
- Keep existing Joel-team fields such as selectedScoring, bye, injuryStatus.

Important:
- This does NOT scrape Ballr or any private/login site.
- It uses public pages only.
- If the source table changes, the script will fail safely instead of corrupting players.json.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"

PUBLIC_PRICE_BE_URLS = [
    "https://www.nrlsupercoachstats.com/TeamPricesAndBEs.php",
]

TEAM_ALIAS = {
    "MEL": "MEL",
    "STG": "STG",
    "CBR": "CBR",
    "STH": "STH",
    "NQC": "NQC",
    "DOL": "DOL",
    "NEW": "NEW",
    "SHA": "SHA",
    "NZL": "NZL",
    "WST": "WST",
    "BRO": "BRO",
    "BRI": "BRO",
}

def clean_name(name: Any) -> str:
    s = str(name or "").strip()
    s = re.sub(r"\s+", " ", s)
    return s

def norm_name(name: Any) -> str:
    s = clean_name(name).lower()
    s = re.sub(r"[^a-z\s'-]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def money_to_int(x: Any) -> int | None:
    if x is None:
        return None
    s = str(x)
    s = re.sub(r"[^0-9.-]", "", s)
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None

def number_or_none(x: Any) -> float | int | None:
    if x is None:
        return None
    s = str(x).strip()
    s = re.sub(r"[^0-9.-]", "", s)
    if not s:
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() else f
    except ValueError:
        return None

def find_column(cols: list[str], options: list[str]) -> str | None:
    low = {str(c).strip().lower(): c for c in cols}
    for opt in options:
        for k, original in low.items():
            if opt in k:
                return original
    return None

def fetch_public_tables() -> list[pd.DataFrame]:
    tables: list[pd.DataFrame] = []
    headers = {
        "User-Agent": "JoelSuperCoachWarRoom/1.0 personal-use data updater"
    }
    for url in PUBLIC_PRICE_BE_URLS:
        print(f"Fetching {url}")
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        found = pd.read_html(response.text)
        print(f"Found {len(found)} tables")
        tables.extend(found)
    return tables

def normalise_table(df: pd.DataFrame) -> list[dict[str, Any]]:
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    cols = list(df.columns)

    name_col = find_column(cols, ["player", "name"])
    team_col = find_column(cols, ["team", "club"])
    pos_col = find_column(cols, ["pos"])
    price_col = find_column(cols, ["price"])
    be_col = find_column(cols, ["be", "break"])
    avg_col = find_column(cols, ["avg", "average"])
    proj_col = find_column(cols, ["proj"])

    if not name_col:
        return []

    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        name = clean_name(row.get(name_col))
        if not name or name.lower() in {"nan", "player"}:
            continue

        item = {
            "name": name,
            "norm": norm_name(name),
        }

        if team_col:
            item["team"] = clean_name(row.get(team_col)).upper()
        if pos_col:
            item["pos"] = clean_name(row.get(pos_col)).upper()
        if price_col:
            item["price"] = money_to_int(row.get(price_col))
        if be_col:
            item["breakeven"] = number_or_none(row.get(be_col))
        if avg_col:
            item["avg"] = number_or_none(row.get(avg_col))
        if proj_col:
            item["proj"] = number_or_none(row.get(proj_col))

        rows.append(item)
    return rows

def load_players() -> dict[str, Any]:
    if not PLAYERS_JSON.exists():
        return {"players": []}
    return json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))

def merge(existing: dict[str, Any], source_rows: list[dict[str, Any]]) -> dict[str, Any]:
    players = existing.get("players", [])
    by_name = {norm_name(p.get("name")): p for p in players}

    updates = 0
    added = 0

    for src in source_rows:
        key = src["norm"]
        if not key:
            continue

        if key in by_name:
            p = by_name[key]
            for field in ["price", "breakeven", "avg", "proj", "pos", "team"]:
                if src.get(field) not in (None, "", "NAN"):
                    p[field] = src[field]
            p["dataSource"] = "nrlsupercoachstats-public-table"
            p["lastDataUpdate"] = datetime.now(timezone.utc).isoformat()
            updates += 1
        else:
            new_player = {
                "name": src["name"],
                "pos": src.get("pos", ""),
                "team": src.get("team", ""),
                "price": src.get("price"),
                "breakeven": src.get("breakeven"),
                "avg": src.get("avg"),
                "proj": src.get("proj") or src.get("avg") or 0,
                "ownership": None,
                "bye": [],
                "cPct": 0,
                "vcPct": 0,
                "risk": 30,
                "injuryStatus": "fit",
                "expectedReturnRound": 1,
                "playProbability": 100,
                "injuryNote": "",
                "selectedScoring": False,
                "dataSource": "nrlsupercoachstats-public-table",
                "lastDataUpdate": datetime.now(timezone.utc).isoformat(),
            }
            players.append(new_player)
            by_name[key] = new_player
            added += 1

    existing["players"] = players
    existing["updated"] = datetime.now(timezone.utc).isoformat()
    existing["dataPipeline"] = {
        "version": "v1",
        "source": PUBLIC_PRICE_BE_URLS,
        "updatedRows": updates,
        "addedRows": added,
        "warning": "Ownership and captain/VC percentages are not updated by this pipeline.",
    }
    return existing

def main() -> None:
    existing = load_players()
    tables = fetch_public_tables()

    all_rows: list[dict[str, Any]] = []
    for table in tables:
        rows = normalise_table(table)
        # Ignore tiny/navigation tables
        if len(rows) >= 10:
            all_rows.extend(rows)

    if not all_rows:
        raise RuntimeError("No usable player rows found. Source table may have changed.")

    print(f"Usable player rows: {len(all_rows)}")
    merged = merge(existing, all_rows)
    PLAYERS_JSON.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    print(f"Updated {PLAYERS_JSON}")

if __name__ == "__main__":
    main()