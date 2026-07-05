#!/usr/bin/env python3
"""CWeekly Position Master Update

What this does:
- Reads players.json / players_seed_round14.json.
- Extracts official/imported positions where available.
- Applies manual trusted overrides from position_overrides.json.
- Writes:
  - position_master.json
  - dual_positions.json
  - position_audit_report.json

Important:
- This script cannot magically know correct DPP if your upstream players.json does not contain it.
- If upstream misses a DPP, add it to position_overrides.json once. It will be protected forever.
"""

import json
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_PATH = ROOT / "players.json"
SEED_PATH = ROOT / "players_seed_round14.json"
OVERRIDES_PATH = ROOT / "position_overrides.json"
MASTER_PATH = ROOT / "position_master.json"
DUAL_PATH = ROOT / "dual_positions.json"
REPORT_PATH = ROOT / "position_audit_report.json"

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

def norm_name(name):
    return " ".join(str(name or "").lower().replace("’", "'").replace(".", "").split())

def pos_list(value):
    if value is None:
        return []
    raw = []
    if isinstance(value, list):
        for x in value:
            raw.extend(str(x).replace(",", "/").replace("|", "/").split("/"))
    else:
        raw = str(value).replace(",", "/").replace("|", "/").split("/")
    out = []
    for x in raw:
        x = x.strip().upper()
        if x in VALID and x not in out:
            out.append(x)
    return out

def player_name(p):
    return p.get("name") or p.get("player") or p.get("playerName") or p.get("fullName")

def player_positions(p):
    # Most trustworthy/common keys first.
    for key in [
        "positions",
        "eligiblePositions",
        "supercoachPositions",
        "dualPositions",
        "position",
        "pos",
        "role"
    ]:
        if key in p:
            got = pos_list(p.get(key))
            if got:
                return got
    return []

def merge_player_sources():
    merged = {}
    for path in [SEED_PATH, PLAYERS_PATH]:
        data = load_json(path, [])
        for p in extract_players(data):
            name = player_name(p)
            if not name:
                continue
            n = norm_name(name)
            old = merged.get(n, {})
            merged[n] = {**old, **p, "name": name}
    return merged

def main():
    players = merge_player_sources()
    overrides_data = load_json(OVERRIDES_PATH, {"players": {}})
    overrides = overrides_data.get("players", {}) if isinstance(overrides_data, dict) else {}

    master = {}
    report = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "total_players_seen": len(players),
        "positions_from_import": 0,
        "manual_overrides_applied": 0,
        "missing_positions": [],
        "conflicts_fixed_by_override": []
    }

    # 1. Import positions from player data.
    for _, p in players.items():
        name = player_name(p)
        if not name:
            continue
        pos = player_positions(p)
        if pos:
            master[name] = pos
            report["positions_from_import"] += 1
        else:
            report["missing_positions"].append(name)

    # 2. Apply overrides. Overrides win.
    for name, pos_raw in overrides.items():
        trusted = pos_list(pos_raw)
        if not trusted:
            continue

        existing_name = None
        existing_pos = None
        for m_name, m_pos in master.items():
            if norm_name(m_name) == norm_name(name):
                existing_name = m_name
                existing_pos = m_pos
                break

        if existing_name and set(existing_pos) != set(trusted):
            report["conflicts_fixed_by_override"].append({
                "player": existing_name,
                "imported": existing_pos,
                "trusted": trusted
            })
            del master[existing_name]

        master[name] = trusted
        report["manual_overrides_applied"] += 1

    # 3. Sort output.
    master = dict(sorted(master.items(), key=lambda kv: kv[0].lower()))

    master_out = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "players.json + players_seed_round14.json + protected position_overrides.json",
        "rule": "All app screens must read this file. Manual overrides win over imported data.",
        "players": master
    }

    dual_out = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "generated from position_master.json",
        "players": master
    }

    MASTER_PATH.write_text(json.dumps(master_out, indent=2, ensure_ascii=False), encoding="utf-8")
    DUAL_PATH.write_text(json.dumps(dual_out, indent=2, ensure_ascii=False), encoding="utf-8")
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Position master updated: {len(master)} players")
    print(f"Imported positions: {report['positions_from_import']}")
    print(f"Manual overrides applied: {report['manual_overrides_applied']}")
    print(f"Conflicts fixed by overrides: {len(report['conflicts_fixed_by_override'])}")
]}")
    print(f"Manual overrides applied: {report['manual_overrides_applied']}")
    print(f"Conflicts fixed by overrides: {len(report['conflicts_fixed_by_override'])}")
    print(f"Missing positions: {len(report['missing_positions'])}")

if __name__ == "__main__":
    main()
