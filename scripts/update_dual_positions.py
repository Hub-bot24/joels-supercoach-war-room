#!/usr/bin/env python3
"""
Update dual_positions.json from players.json.

This script is intentionally conservative:
- It reads current player positions from players.json.
- It preserves any manual overrides already in dual_positions.json.
- It writes a clean dual_positions.json used by the app for drag/drop eligibility.

If your players.json later includes official dual positions, e.g.
  "pos": "CTW/FLB"
or
  "positions": ["CTW", "FLB"]
this script will capture them.

If a player needs a manual override, edit dual_positions.json:
  "Player Name": ["CTW", "FLB"]
"""

import json
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_PATH = ROOT / "players.json"
DUAL_PATH = ROOT / "dual_positions.json"

VALID = {"HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB"}

def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default

def extract_players(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("players"), list):
        return data["players"]
    return []

def normalise_positions(value):
    if value is None:
        return []
    if isinstance(value, list):
        raw = []
        for x in value:
            raw.extend(str(x).replace(",", "/").replace("|", "/").split("/"))
    else:
        raw = str(value).replace(",", "/").replace("|", "/").split("/")

    out = []
    for p in raw:
        p = p.strip().upper()
        if p in VALID and p not in out:
            out.append(p)
    return out

def main():
    players_data = load_json(PLAYERS_PATH, [])
    dual_data = load_json(DUAL_PATH, {})
    existing = dual_data.get("players", {}) if isinstance(dual_data, dict) else {}

    result = {}

    for p in extract_players(players_data):
        name = p.get("name")
        if not name:
            continue

        positions = []

        # Prefer explicit official fields if present.
        for key in ["positions", "eligiblePositions", "dualPositions", "pos", "position"]:
            if key in p:
                positions = normalise_positions(p.get(key))
                if positions:
                    break

        if positions:
            result[name] = positions

    # Manual overrides win.
    if isinstance(existing, dict):
        for name, positions in existing.items():
            norm = normalise_positions(positions)
            if norm:
                result[name] = norm

    out = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "players.json plus manual overrides",
        "note": "Manual entries in players override imported values. App uses this file for field drag/drop and bye-position eligibility.",
        "players": dict(sorted(result.items(), key=lambda kv: kv[0].lower()))
    }

    DUAL_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Updated {DUAL_PATH.name}: {len(out['players'])} players")

if __name__ == "__main__":
    main()
