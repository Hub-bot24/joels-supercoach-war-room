from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"
CSV_FILE = ROOT / "level3_player_stats.csv"

NUMERIC_FIELDS = {
    "avg",
    "last3Avg",
    "last5Avg",
    "ownership",
    "breakeven",
    "expectedMinutes",
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

def load_players():
    data = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    players = data.get("players", [])
    return data, players

def main():
    if not CSV_FILE.exists():
        raise FileNotFoundError("level3_player_stats.csv not found")

    data, players = load_players()
    by_name = {p.get("name", "").strip().lower(): p for p in players if p.get("name")}

    updated = 0
    skipped = []

    with CSV_FILE.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = clean(row.get("name"))
            if not name:
                continue

            player = by_name.get(name.lower())
            if not player:
                skipped.append(name)
                continue

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

            # keep old and new naming compatible
            if "last3Avg" in player:
                player["threeRoundAvg"] = player["last3Avg"]
            if "last5Avg" in player:
                player["fiveRoundAvg"] = player["last5Avg"]

            if changed:
                updated += 1

    data["level3CsvImport"] = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "level3_player_stats.csv",
        "playersUpdated": updated,
        "playersSkippedNotFound": skipped,
        "warning": "Only non-empty CSV cells overwrite players.json. Blank cells are ignored."
    }

    PLAYERS_JSON.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Imported Level 3 stats for {updated} players.")
    if skipped:
        print("Skipped not found:", ", ".join(skipped))

if __name__ == "__main__":
    main()
