#!/usr/bin/env python3
"""
Position Audit Guard

Purpose:
- Compare players.json imported positions against trusted position_master.json.
- Manual/trusted positions always win.
- Writes position_audit_report.json.
- Updates dual_positions.json from position_master.json.
- Exits 0 by default so GitHub Actions does not destroy your site deploy.
  Change FAIL_ON_CONFLICT to True if you want workflow failure on conflicts.
"""

import json
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_PATH = ROOT / "players.json"
MASTER_PATH = ROOT / "position_master.json"
DUAL_PATH = ROOT / "dual_positions.json"
REPORT_PATH = ROOT / "position_audit_report.json"

VALID = {"HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB"}
FAIL_ON_CONFLICT = False

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

def player_positions(p):
    for key in ["positions", "eligiblePositions", "dualPositions", "pos", "position"]:
        if key in p:
            got = pos_list(p.get(key))
            if got:
                return got
    return []

def same_positions(a, b):
    return set(a) == set(b)

def main():
    players_data = load_json(PLAYERS_PATH, [])
    master_data = load_json(MASTER_PATH, {"players": {}})
    master = master_data.get("players", {}) if isinstance(master_data, dict) else {}

    master_by_norm = {norm_name(k): (k, pos_list(v)) for k, v in master.items()}

    conflicts = []
    fixed_count = 0
    checked_count = 0

    for p in extract_players(players_data):
        name = p.get("name")
        if not name:
            continue
        n = norm_name(name)
        if n not in master_by_norm:
            continue

        checked_count += 1
        master_name, trusted = master_by_norm[n]
        imported = player_positions(p)

        if trusted and not same_positions(imported, trusted):
            conflicts.append({
                "player": name,
                "trusted_name": master_name,
                "imported": imported,
                "trusted": trusted,
                "action": "trusted position used; imported data ignored"
            })

        if trusted:
            p["pos"] = "/".join(trusted)
            p["position"] = "/".join(trusted)
            p["positions"] = trusted
            p["eligiblePositions"] = trusted
            p["dualPositions"] = trusted
            p["positionFixed"] = True
            fixed_count += 1

    dual_out = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "generated from position_master.json by audit_positions.py",
        "players": {name: pos_list(pos) for name, pos in sorted(master.items(), key=lambda kv: kv[0].lower())}
    }

    report = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "checked_master_players_found_in_players_json": checked_count,
        "positions_forced_from_master": fixed_count,
        "conflict_count": len(conflicts),
        "conflicts": conflicts
    }

    PLAYERS_PATH.write_text(json.dumps(players_data, indent=2, ensure_ascii=False), encoding="utf-8")
    DUAL_PATH.write_text(json.dumps(dual_out, indent=2, ensure_ascii=False), encoding="utf-8")
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Position audit complete. Conflicts: {len(conflicts)}. Fixed: {fixed_count}.")
    for c in conflicts[:20]:
        print(f"CONFLICT: {c['player']} imported={c['imported']} trusted={c['trusted']}")

    if FAIL_ON_CONFLICT and conflicts:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
