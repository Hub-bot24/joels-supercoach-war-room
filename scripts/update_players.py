
from __future__ import annotations

import json
import re
from io import StringIO
from html import unescape
from urllib.parse import unquote
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"
DPP_IMPORT_STATUS_JSON = ROOT / "dpp_import_status.json"
DPP_LAST_KNOWN_GOOD_JSON = ROOT / "dpp_last_known_good.json"
DPP_IMPORT_HISTORY_JSONL = ROOT / "dpp_import_history.jsonl"

SOURCE_URLS = [
    "https://www.nrlsupercoachstats.com/TeamPricesAndBEs.php"
]
DPP_URL_TEMPLATE = "https://www.nrlsupercoachstats.com/dualposngrid.php?year={year}"
DPP_MIN_PLAYERS_FOUND = 10
DPP_MIN_MATCH_RATE = 0.5
DPP_MAX_DROP_RATE = 0.5
DPP_CONFIDENCE_THRESHOLD = 70
DPP_MAX_SNAPSHOT_AGE_DAYS = 14

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

    position_pattern = re.compile(r"\b(?:HOK|FRF|2RF|HFB|5/8|CTW|FLB)\b", re.I)
    for raw in raw_values:
        for match in position_pattern.finditer(str(raw).upper()):
            pos = match.group(0).upper()
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

def merge_position_fields(player: dict[str, Any], raw_pos: Any) -> None:
    merged: list[str] = []
    for key in ["positions", "eligiblePositions", "dualPositions", "position", "pos"]:
        for pos in normalise_positions(player.get(key)):
            if pos not in merged:
                merged.append(pos)
    for pos in normalise_positions(raw_pos):
        if pos not in merged:
            merged.append(pos)
    apply_position_fields(player, merged)

def norm_name(value: Any) -> str:
    text = clean_name(value).lower()
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", clean_name(value)).lower()
    text = re.sub(r"[^a-z\s'-]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def compact_name_key(value: Any) -> str:
    return re.sub(r"[^a-z]", "", norm_name(value))

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

        row_text = " ".join(v for v in clean_values if v and v.lower() != "nan")

        name = ""
        name_match = re.search(r"\b([A-Za-z][A-Za-z'’.-]+(?:\s+[A-Za-z][A-Za-z'’.-]+)*),\s*([A-Za-z][A-Za-z'’.-]+(?:\s+[A-Za-z][A-Za-z'’.-]+)*)\b", row_text)
        if name_match:
            name = name_from_source(name_match.group(0))

        if not name:
            continue

        price, be = parse_price_be_text(row_text)

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

def html_to_text(value: Any) -> str:
    text = unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\xa0", " ")
    text = text.replace("&nbsp", " ")
    return clean_name(text)

def parse_rows_from_html(html: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    # The TeamPricesAndBEs page is malformed as a table, but player profile links are stable:
    # ./index.php?player=Walsh%2C%20Reece followed shortly by a price/BE cell.
    player_link_re = re.compile(
        r'<a\s+[^>]*href=["\'][^"\']*index\.php\?player=([^"\']+)["\'][^>]*>.*?</a>(?P<tail>.{0,700})',
        re.I | re.S
    )

    for m in player_link_re.finditer(html):
        raw_name = unquote(unescape(m.group(1)))
        name = name_from_source(raw_name)
        key = norm_name(name)

        if not key or key in seen:
            continue

        tail_text = html_to_text(m.group("tail"))
        price, be = parse_price_be_text(tail_text)

        parsed = {
            "name": name,
            "norm": key,
        }

        if price is not None:
            parsed["price"] = price
        if be is not None:
            parsed["breakeven"] = be

        # Only keep real price/BE rows, not menu/profile links.
        if "price" in parsed or "breakeven" in parsed:
            rows.append(parsed)
            seen.add(key)

    return rows

def fetch_source_rows() -> list[dict[str, Any]]:
    headers = {"User-Agent": "JoelSuperCoachWarRoom/2.0 personal-use updater"}
    all_rows: list[dict[str, Any]] = []

    for url in SOURCE_URLS:
        print(f"Fetching {url}")
        res = requests.get(url, headers=headers, timeout=30)
        res.raise_for_status()

        html_rows = parse_rows_from_html(res.text)
        print(f"Parsed {len(html_rows)} direct HTML player rows from {url}")
        all_rows.extend(html_rows)

        if len(html_rows) >= 10:
            continue

        tables = pd.read_html(StringIO(res.text))
        print(f"Found {len(tables)} tables from {url}")
        for table in tables:
            parsed = parse_rows_from_table(table)
            if parsed:
                all_rows.extend(parsed)

    return all_rows

def source_name_to_player_name(value: str) -> str:
    text = clean_name(value)
    if "," not in text:
        return text
    last, first = [clean_name(x) for x in text.split(",", 1)]
    return clean_name(f"{first} {last}")

def normalise_position_heading(value: Any) -> str:
    text = clean_name(value).upper()
    return text if text in VALID_POSITIONS else ""

def parse_dpp_names(value: Any) -> list[str]:
    text = clean_name(value)
    names = []
    pattern = re.compile(r"\b([A-Za-z][A-Za-z'’.-]+(?:-[A-Za-z'’.-]+)?),\s*([A-Za-z][A-Za-z'’.-]+(?:\s+[A-Za-z][A-Za-z'’.-]+)?)")
    for match in pattern.finditer(text):
        name = source_name_to_player_name(match.group(0))
        if name and name not in names:
            names.append(name)
    return names

def add_dpp_position(out: dict[str, list[str]], name: str, positions: list[str]) -> None:
    key = norm_name(name)
    if not key:
        return
    current = out.setdefault(key, [])
    for pos in positions:
        if pos in VALID_POSITIONS and pos not in current:
            current.append(pos)

def parse_dpp_table(df: pd.DataFrame) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    table = df.fillna("")
    columns = [normalise_position_heading(col) for col in table.columns]
    data = table

    if sum(1 for col in columns if col) < 2 and len(table.index):
        first_row = [normalise_position_heading(value) for value in table.iloc[0].tolist()]
        if sum(1 for col in first_row if col) >= 2:
            columns = first_row
            data = table.iloc[1:]

    if sum(1 for col in columns if col) < 2:
        return out

    for _, row in data.iterrows():
        values = row.tolist()
        if not values:
            continue
        row_pos = normalise_position_heading(values[0])
        if not row_pos:
            continue
        for idx, cell in enumerate(values[1:], start=1):
            col_pos = columns[idx] if idx < len(columns) else ""
            if not col_pos or col_pos == row_pos:
                continue
            for name in parse_dpp_names(cell):
                add_dpp_position(out, name, [col_pos, row_pos])
    return out

def load_json_file(path: Path) -> Any:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

def load_dpp_import_status() -> dict[str, Any]:
    data = load_json_file(DPP_IMPORT_STATUS_JSON)
    return data if isinstance(data, dict) else {}

def load_dpp_last_known_good() -> dict[str, Any]:
    data = load_json_file(DPP_LAST_KNOWN_GOOD_JSON)
    return data if isinstance(data, dict) else {}

def write_dpp_import_status(status: dict[str, Any]) -> None:
    DPP_IMPORT_STATUS_JSON.write_text(json.dumps(status, indent=2), encoding="utf-8")

def write_dpp_last_known_good(snapshot: dict[str, Any]) -> None:
    DPP_LAST_KNOWN_GOOD_JSON.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")

def append_dpp_import_history(status: dict[str, Any]) -> None:
    history = {
        "timestamp": status.get("timestamp"),
        "season": status.get("season"),
        "source_url": status.get("source_url"),
        "ok": status.get("ok", False),
        "validation_ok": status.get("validation_ok", False),
        "accepted": status.get("accepted", False),
        "confidence": status.get("confidence", 0),
        "dpp_players_found": status.get("dpp_players_found", 0),
        "dpp_players_matched": status.get("dpp_players_matched", 0),
        "dpp_players_unmatched": status.get("dpp_players_unmatched", 0),
        "change_summary": status.get("change_summary", {}),
        "warning": status.get("warning", "")
    }
    with DPP_IMPORT_HISTORY_JSONL.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(history, ensure_ascii=False) + "\n")

def snapshot_age_days(snapshot: dict[str, Any]) -> int | None:
    timestamp = snapshot.get("timestamp")
    if not timestamp:
        return None
    try:
        parsed = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - parsed).days
    except Exception:
        return None

def detect_dpp_changes(current: dict[str, list[str]], previous_snapshot: dict[str, Any]) -> dict[str, Any]:
    previous = previous_snapshot.get("players", {}) if isinstance(previous_snapshot, dict) else {}
    if not isinstance(previous, dict):
        previous = {}
    current_keys = set(current.keys())
    previous_keys = set(previous.keys())
    changed = []
    for key in current_keys & previous_keys:
        if set(current.get(key, [])) != set(previous.get(key, [])):
            changed.append(key)
    return {
        "added": len(current_keys - previous_keys),
        "removed": len(previous_keys - current_keys),
        "changed": len(changed),
        "unchanged": len(current_keys & previous_keys) - len(changed),
        "previous_count": len(previous_keys),
        "current_count": len(current_keys)
    }

def dpp_confidence_score(status: dict[str, Any], change_summary: dict[str, Any], include_match_rate: bool = True) -> int:
    score = 100
    found = int(status.get("dpp_players_found") or 0)
    matched = int(status.get("dpp_players_matched") or 0)
    unmatched = int(status.get("dpp_players_unmatched") or 0)
    previous_count = int(change_summary.get("previous_count") or 0)
    removed = int(change_summary.get("removed") or 0)

    if not status.get("ok"):
        score -= 100
    if found < DPP_MIN_PLAYERS_FOUND:
        score -= 40
    if include_match_rate and found:
        match_rate = matched / found
        if match_rate < DPP_MIN_MATCH_RATE:
            score -= 40
        if unmatched > matched:
            score -= 20
    if previous_count and removed > previous_count * DPP_MAX_DROP_RATE:
        score -= 30
    return max(0, min(100, score))

def validate_dpp_positions(dpp_positions: dict[str, list[str]], status: dict[str, Any], previous_status: dict[str, Any]) -> bool:
    warnings: list[str] = []
    found = len(dpp_positions)
    previous_found = int(previous_status.get("dpp_players_found") or 0) if previous_status.get("ok") else 0

    if found < DPP_MIN_PLAYERS_FOUND:
        warnings.append(f"DPP import rejected: found {found} players, below minimum {DPP_MIN_PLAYERS_FOUND}.")

    for name, positions in dpp_positions.items():
        invalid = [pos for pos in positions if pos not in VALID_POSITIONS]
        if invalid:
            warnings.append(f"DPP import rejected: invalid positions for {name}: {invalid}.")
            break

    if previous_found and found < previous_found * (1 - DPP_MAX_DROP_RATE):
        warnings.append(f"DPP import rejected: player count dropped from {previous_found} to {found}.")

    if warnings:
        status["ok"] = False
        status["validation_ok"] = False
        status["warning"] = " ".join(warnings)
        return False

    status["validation_ok"] = True
    return True

def fetch_dpp_positions(year: int | None = None) -> tuple[dict[str, list[str]], dict[str, Any]]:
    season = year or datetime.now(timezone.utc).year
    url = DPP_URL_TEMPLATE.format(year=season)
    previous_status = load_dpp_import_status()
    last_known_good = load_dpp_last_known_good()
    status: dict[str, Any] = {
        "source_url": url,
        "season": season,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ok": False,
        "validation_ok": False,
        "dpp_players_found": 0,
        "dpp_players_matched": 0,
        "dpp_players_unmatched": 0,
        "warning": "",
        "confidence": 0,
        "accepted": False,
        "change_summary": {},
        "last_known_good_age_days": snapshot_age_days(last_known_good),
        "snapshot_age_warning": ""
    }
    headers = {"User-Agent": "JoelSuperCoachWarRoom/2.0 personal-use updater"}
    try:
        print(f"Fetching DPP grid {url}")
        res = requests.get(url, headers=headers, timeout=30)
        res.raise_for_status()
        tables = pd.read_html(StringIO(res.text))
    except Exception as exc:
        status["warning"] = f"DPP source fetch failed; existing player positions were preserved. {type(exc).__name__}: {exc}"
        write_dpp_import_status(status)
        print(status["warning"])
        return {}, status

    merged: dict[str, list[str]] = {}
    for table in tables:
        parsed = parse_dpp_table(table)
        for key, positions in parsed.items():
            current = merged.setdefault(key, [])
            for pos in positions:
                if pos not in current:
                    current.append(pos)
    status["dpp_players_found"] = len(merged)

    change_summary = detect_dpp_changes(merged, last_known_good)
    status["change_summary"] = change_summary
    age_days = status.get("last_known_good_age_days")
    if isinstance(age_days, int) and age_days > DPP_MAX_SNAPSHOT_AGE_DAYS:
        status["snapshot_age_warning"] = f"Last known good DPP snapshot is {age_days} days old."

    if not validate_dpp_positions(merged, status, previous_status):
        status["confidence"] = dpp_confidence_score(status, change_summary)
        append_dpp_import_history(status)
        write_dpp_import_status(status)
        print(status["warning"])
        return {}, status

    status["ok"] = True
    status["confidence"] = dpp_confidence_score(status, change_summary, include_match_rate=False)
    write_dpp_import_status(status)
    print(f"Parsed {len(merged)} DPP players from {url}")
    return merged, status

def load_players() -> dict[str, Any]:
    if PLAYERS_JSON.exists():
        return json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    return {"players": []}

def merge_players(existing: dict[str, Any], source_rows: list[dict[str, Any]], dpp_positions: dict[str, list[str]] | None = None, dpp_status: dict[str, Any] | None = None) -> dict[str, Any]:
    players = existing.get("players", [])
    by_name = {norm_name(p.get("name")): p for p in players if p.get("name")}
    by_compact_name = {compact_name_key(p.get("name")): p for p in players if p.get("name")}
    dpp_positions = dpp_positions or {}
    dpp_status = dpp_status or {}

    updated = 0
    added = 0
    dpp_matched = 0
    dpp_unmatched = 0

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
            by_compact_name[compact_name_key(src["name"])] = new_player
            added += 1

    dpp_matches: list[tuple[dict[str, Any], list[str]]] = []
    for key, dpp in dpp_positions.items():
        p = by_name.get(key) or by_compact_name.get(compact_name_key(key))
        if not p:
            dpp_unmatched += 1
            continue
        dpp_matches.append((p, dpp))
        dpp_matched += 1

    if dpp_status:
        dpp_status["dpp_players_matched"] = dpp_matched
        dpp_status["dpp_players_unmatched"] = dpp_unmatched
        found = int(dpp_status.get("dpp_players_found") or 0)
        if dpp_status.get("ok") and found:
            matched_rate = dpp_matched / found
            dpp_status["matched_rate"] = matched_rate
            if matched_rate < DPP_MIN_MATCH_RATE:
                dpp_status["ok"] = False
                dpp_status["validation_ok"] = False
                dpp_status["accepted"] = False
                dpp_status["warning"] = f"DPP import rejected: matched {dpp_matched} of {found} players, below minimum match rate {DPP_MIN_MATCH_RATE}."
        change_summary = dpp_status.get("change_summary", {})
        dpp_status["confidence"] = dpp_confidence_score(dpp_status, change_summary if isinstance(change_summary, dict) else {})
        if dpp_status.get("ok") and dpp_status["confidence"] < DPP_CONFIDENCE_THRESHOLD:
            dpp_status["ok"] = False
            dpp_status["validation_ok"] = False
            dpp_status["accepted"] = False
            dpp_status["warning"] = f"DPP import rejected: confidence {dpp_status['confidence']} below minimum {DPP_CONFIDENCE_THRESHOLD}."
        if dpp_status.get("ok"):
            dpp_status["accepted"] = True
            for p, dpp in dpp_matches:
                merge_position_fields(p, dpp)
            if dpp_positions:
                write_dpp_last_known_good({
                    "season": dpp_status.get("season"),
                    "source_url": dpp_status.get("source_url"),
                    "timestamp": dpp_status.get("timestamp"),
                    "confidence": dpp_status.get("confidence", 0),
                    "dpp_players_found": len(dpp_positions),
                    "players": dpp_positions
                })
        append_dpp_import_history(dpp_status)
        write_dpp_import_status(dpp_status)

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
    rows = fetch_source_rows()
    dpp_positions, dpp_status = fetch_dpp_positions()

    if not rows:
        raise RuntimeError("No usable player rows found. Public table format may have changed.")

    print(f"Parsed {len(rows)} player rows")
    merged = merge_players(existing, rows, dpp_positions, dpp_status)
    PLAYERS_JSON.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    print("players.json updated")

if __name__ == "__main__":
    main()





