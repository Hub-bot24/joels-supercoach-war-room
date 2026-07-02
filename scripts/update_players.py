
from __future__ import annotations

import json
import re
from io import StringIO
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"

SOURCE_URLS = [
    "https://www.nrlsupercoachstats.com/TeamPricesAndBEs.php"
]

def clean_name(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text

VALID_POSITIONS = {"HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB"}

def normalise_positions(value: Any) -> list[str]:
    if value is None:
        return []
    parts: list[str] = []
    if isinstance(value, list):
        raw_values = value
    else:
        raw_values = [value]

    for raw in raw_values:
        for part in str(raw).upper().replace(",", "/").replace("|", "/").split("/"):
            pos = part.strip()
            if pos in VALID_POSITIONS and pos not in parts:
                parts.append(pos)
    return parts

def apply_position_fields(player: dict[str, Any], raw_pos: Any) -> None:
    positions = normalise_positions(raw_pos)
    if not positions:
        return
    joined = "/".join(positions)
    player["pos"] = joined
    player["position"] = joined
    player["positions"] = positions
    player["eligiblePositions"] = positions
    player["dualPositions"] = positions
    player["positionFixed"] = False

def norm_name(value: Any) -> str:
    text = clean_name(value).lower()
    text = re.sub(r"[^a-z\s'-]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def to_number(value: Any) -> float | int | None:
    if value is None:
        return None
    text = str(value)
    text = re.sub(r"[^0-9.-]", "", text)
    if not text:
        return None
    try:
        num = float(text)
        return int(num) if num.is_integer() else num
    except ValueError:
        return None

def to_money(value: Any) -> int | None:
    num = to_number(value)
    return int(num) if num is not None else None

def find_col(cols: list[str], needles: list[str]) -> str | None:
    for col in cols:
        low = str(col).strip().lower()
        if any(n in low for n in needles):
            return col
    return None

def fetch_tables() -> list[pd.DataFrame]:
    headers = {"User-Agent": "JoelSuperCoachWarRoom/2.0 personal-use updater"}
    all_tables: list[pd.DataFrame] = []

    for url in SOURCE_URLS:
        print(f"Fetching {url}")
        res = requests.get(url, headers=headers, timeout=30)
        res.raise_for_status()
        tables = pd.read_html(StringIO(res.text))
        print(f"Found {len(tables)} tables from {url}")
        all_tables.extend(tables)

    return all_tables

def name_from_source(value: Any) -> str:
    text = clean_name(value)
    if "," in text:
        last, first = [clean_name(x) for x in text.split(",", 1)]
        if first and last:
            return f"{first} {last}"
    return text

def parse_price_be_text(value: Any) -> tuple[int | None, float | int | None]:
    text = str(value or "")
    price = None
    be = None

    money = re.search(r"\$[\d,]+", text)
    if money:
        price = to_money(money.group(0))

    nums = re.findall(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    if nums:
        # In TeamPricesAndBEs.php cells, the first number is usually the price
        # and the final number is the BE.
        if len(nums) >= 2:
            be = to_number(nums[-1])
        elif price is None:
            be = to_number(nums[0])

    return price, be

def parse_rows_from_table(df: pd.DataFrame) -> list[dict[str, Any]]:
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    cols = list(df.columns)

    name_col = find_col(cols, ["player", "name"])
    price_col = find_col(cols, ["price"])
    be_col = find_col(cols, ["be", "break"])
    team_col = find_col(cols, ["team", "club"])
    pos_col = find_col(cols, ["pos"])
    avg_col = find_col(cols, ["avg", "average"])
    three_ra_col = find_col(cols, ["3ra", "3 ra", "3 round", "3-round"])

    rows = []

    # Format A: normal data table with useful column names.
    if name_col:
        for _, row in df.iterrows():
            name = name_from_source(row.get(name_col))
            if not name or name.lower() in {"nan", "player", "players"}:
                continue

            parsed = {
                "name": name,
                "norm": norm_name(name),
            }

            if price_col:
                parsed["price"] = to_money(row.get(price_col))
            if be_col:
                parsed["breakeven"] = to_number(row.get(be_col))
            if team_col:
                parsed["team"] = clean_name(row.get(team_col)).upper()
            if pos_col:
                parsed["pos"] = clean_name(row.get(pos_col)).upper()
            if avg_col:
                parsed["avg"] = to_number(row.get(avg_col))
            if three_ra_col:
                parsed["threeRoundAvg"] = to_number(row.get(three_ra_col))

            if parsed["norm"]:
                rows.append(parsed)

        return rows

    # Format B: NRL SuperCoach Stats team table.
    # Typical row: "Walsh, Reece" | blank | "$533,800   86"
    for _, row in df.iterrows():
        values = [row.get(c) for c in cols]
        clean_values = [clean_name(v) for v in values]

        name = ""
        for v in clean_values:
            if not v or v.lower() == "nan":
                continue
            if "$" in v:
                continue
            if re.search(r"[A-Za-z]+,\s*[A-Za-z]", v):
                name = name_from_source(v)
                break

        if not name:
            continue

        price = None
        be = None
        for v in clean_values:
            if "$" in v:
                price, be = parse_price_be_text(v)
                break

        parsed = {
            "name": name,
            "norm": norm_name(name),
        }

        if price is not None:
            parsed["price"] = price
        if be is not None:
            parsed["breakeven"] = be

        if parsed["norm"]:
            rows.append(parsed)

    return rows
def load_players() -> dict[str, Any]:
    if PLAYERS_JSON.exists():
        return json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    return {"players": []}

def merge_players(existing: dict[str, Any], source_rows: list[dict[str, Any]]) -> dict[str, Any]:
    players = existing.get("players", [])
    by_name = {norm_name(p.get("name")): p for p in players if p.get("name")}

    updated = 0
    added = 0

    for src in source_rows:
        key = src["norm"]
        if not key:
            continue

        if key in by_name:
            p = by_name[key]
            for field in ["price", "breakeven", "avg", "threeRoundAvg", "team"]:
                if src.get(field) not in (None, "", "NAN"):
                    p[field] = src[field]

            if src.get("pos") not in (None, "", "NAN"):
                apply_position_fields(p, src.get("pos"))

            if p.get("breakeven") is not None:
                p["breakevenStatus"] = "updated"
            p["dataSource"] = "nrlsupercoachstats-public"
            p["lastDataUpdate"] = datetime.now(timezone.utc).isoformat()
            updated += 1

        else:
            new_player = {
                "name": src["name"],
                "shortName": src["name"],
                "pos": src.get("pos", ""),
                "team": src.get("team", ""),
                "price": src.get("price"),
                "proj": src.get("avg") or 0,
                "avg": src.get("avg"),
                "threeRoundAvg": src.get("threeRoundAvg"),
                "ownership": None,
                "ownershipStatus": "needs_data",
                "bye": [],
                "breakeven": src.get("breakeven"),
                "breakevenStatus": "updated" if src.get("breakeven") is not None else "needs_data",
                "cPct": 0,
                "vcPct": 0,
                "captainOwnership": None,
                "vcOwnership": None,
                "risk": 30,
                "injuryStatus": "fit",
                "expectedReturnRound": 1,
                "playProbability": 100,
                "injuryNote": "",
                "selectedScoring": False,
                "dataSource": "nrlsupercoachstats-public",
                "lastDataUpdate": datetime.now(timezone.utc).isoformat(),
            }
            apply_position_fields(new_player, src.get("pos"))
            players.append(new_player)
            by_name[key] = new_player
            added += 1

    existing["players"] = players
    existing["lastAutomationRun"] = datetime.now(timezone.utc).isoformat()
    existing["automationStatus"] = "Data Pipeline V2 ran successfully."
    existing["dataPipeline"] = {
        "version": "v2-real-price-be",
        "sourceUrls": SOURCE_URLS,
        "rowsFound": len(source_rows),
        "playersUpdated": updated,
        "playersAdded": added,
        "stillMissing": [
            "ownership percentages",
            "captain percentages",
            "vice-captain percentages",
            "live scoring",
            "official injury return dates"
        ]
    }
    return existing

def main() -> None:
    existing = load_players()
    tables = fetch_tables()

    rows: list[dict[str, Any]] = []
    for table in tables:
        parsed = parse_rows_from_table(table)
        if len(parsed) >= 10:
            rows.extend(parsed)

    if not rows:
        raise RuntimeError("No usable player rows found. Public table format may have changed.")

    print(f"Parsed {len(rows)} player rows")
    merged = merge_players(existing, rows)
    PLAYERS_JSON.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    print("players.json updated")

if __name__ == "__main__":
    main()



