from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"
SEED_JSON = ROOT / "players_seed_round14.json"
CSV_FILE = ROOT / "level3_player_stats.csv"

NUMERIC_FIELDS = {
    "avg",
    "last3Avg",
    "last5Avg",
    "ownership",
    "breakeven",
    "expectedMinutes",
    "minutes",
    "ppm",
    "captainOwnership",
    "vcOwnership",
    "projectionOverride",
    "playProbability",
}

TEXT_FIELDS = {
    "roleConfidence",
    "roleNote",
    "injuryStatus",
}

def clean(value):
    if value is None:
        return None
    value = str(value).strip()
    if value == "":
        return None
    return value

def to_number(value):
    value = clean(value)
    if value is None:
        return None
    value = value.replace("%", "").replace("$", "").replace(",", "")
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return None

def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")

def get_players_container(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    data = load_json(path, {"players": []})
    if isinstance(data, list):
        data = {"players": data}
    players = data.get("players", [])
    return data, players

def apply_row_to_player(player: dict[str, Any], row: dict[str, str]) -> bool:
    changed = False

    for field in NUMERIC_FIELDS:
        if field in row:
            val = to_number(row.get(field))
            if val is not None:
                if field == "projectionOverride":
                    player["proj"] = val
                    player["projectionSource"] = "level3_player_stats.csv projectionOverride"
                else:
                    player[field] = val
                changed = True

    for field in TEXT_FIELDS:
        if field in row:
            val = clean(row.get(field))
            if val is not None:
                player[field] = val
                changed = True

    if "last3Avg" in player:
        player["threeRoundAvg"] = player["last3Avg"]
    if "last5Avg" in player:
        player["fiveRoundAvg"] = player["last5Avg"]

    if player.get("expectedMinutes") not in (None, ""):
        player["roleConfidence"] = player.get("roleConfidence") or "Medium"
        if not player.get("roleNote"):
            player["roleNote"] = "Expected minutes provided via level3_player_stats.csv"

    return changed

def import_into(path: Path, rows: list[dict[str, str]]) -> tuple[int, list[str]]:
    data, players = get_players_container(path)
    by_name = {str(p.get("name", "")).strip().lower(): p for p in players if p.get("name")}

    updated = 0
    skipped = []

    for row in rows:
        name = clean(row.get("name"))
        if not name:
            continue
        player = by_name.get(name.lower())
        if not player:
            skipped.append(name)
            continue
        if apply_row_to_player(player, row):
            updated += 1

    data["players"] = players
    data["level3CsvImport"] = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "level3_player_stats.csv",
        "playersUpdated": updated,
        "playersSkippedNotFoundInThisFile": skipped,
        "warning": "Only non-empty CSV cells overwrite existing data. Blank cells are ignored."
    }

    save_json(path, data)
    return updated, skipped

def main():
    if not CSV_FILE.exists():
        raise FileNotFoundError("level3_player_stats.csv not found")

    with CSV_FILE.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    players_updated, players_skipped = import_into(PLAYERS_JSON, rows)

    seed_updated = 0
    seed_skipped = []
    if SEED_JSON.exists():
        seed_updated, seed_skipped = import_into(SEED_JSON, rows)

    print(f"players.json updated: {players_updated}")
    print(f"players_seed_round14.json updated: {seed_updated}")

    if players_skipped:
        print("Skipped in players.json:", ", ".join(players_skipped))
    if seed_skipped:
        print("Skipped in seed:", ", ".join(seed_skipped))

    if players_updated == 0 and seed_updated == 0:
        raise RuntimeError("No players updated. Check player names in level3_player_stats.csv.")

if __name__ == "__main__":
    main()
