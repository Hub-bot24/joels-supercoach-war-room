from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TEAM_ROLES = ROOT / "team_roles.json"
PLAYERS_JSON = ROOT / "players.json"
SEED_JSON = ROOT / "players_seed_round14.json"
REPORT = ROOT / "team_roles_update_report.json"

TEAM_CODES = ["BRO","DOL","PEN","NQC","MEL","GLD","NEW","CBR","SYD","MAN","STH","WST","SHA","STG","CAN","PAR","NZL"]

def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    data = json.loads(path.read_text(encoding="utf-8"))
    return data

def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")

def norm_name(x: Any) -> str:
    return str(x or "").strip().lower()

def get_players_from(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = load_json(path, {"players": []})
    if isinstance(data, list):
        return data
    return data.get("players", [])

def merge_players() -> list[dict[str, Any]]:
    # Main players override seed players by name.
    merged = {}
    for p in get_players_from(SEED_JSON):
        if p.get("name"):
            merged[norm_name(p["name"])] = p
    for p in get_players_from(PLAYERS_JSON):
        if p.get("name"):
            merged[norm_name(p["name"])] = {**merged.get(norm_name(p["name"]), {}), **p}
    return list(merged.values())

def is_named_active(player: dict[str, Any]) -> bool:
    status = str(player.get("squadStatus") or "").lower()
    play_prob = player.get("playProbability", 100)

    try:
        play_prob = float(play_prob)
    except Exception:
        play_prob = 100

    if play_prob <= 0:
        return False

    # Seed list used statuses like named_17, named, reserve.
    if status in ("named_17", "named", "starting", "starter", "interchange", "bench"):
        return True

    if status in ("reserve", "extended", "dropped", "out", "injured", "suspended"):
        return False

    # If no squad status exists, assume active unless explicitly injured.
    injury = str(player.get("injuryStatus") or "fit").lower()
    if injury in ("injured", "suspended", "unavailable", "out"):
        return False

    return play_prob >= 50

def main():
    now = datetime.now(timezone.utc).isoformat()
    roles = load_json(TEAM_ROLES, {})
    players = merge_players()

    by_name = {norm_name(p.get("name")): p for p in players if p.get("name")}
    report = {
        "updated": now,
        "note": "This workflow validates primary/backup goal kickers against players.json + players_seed_round14.json. It cannot discover brand-new goal kickers unless the player is entered as primary/backup in team_roles.json.",
        "teams": {}
    }

    if not roles:
        roles["_note"] = "Created by update_team_roles.py. Add goalKicker and backupGoalKicker values."

    for team in TEAM_CODES:
        r = roles.setdefault(team, {
            "goalKicker": "",
            "backupGoalKicker": "",
            "useBackupGoalKicker": False
        })

        primary = r.get("goalKicker", "")
        backup = r.get("backupGoalKicker", "")
        primary_player = by_name.get(norm_name(primary))
        backup_player = by_name.get(norm_name(backup))

        primary_active = bool(primary_player and is_named_active(primary_player))
        backup_active = bool(backup_player and is_named_active(backup_player))

        old_use_backup = bool(r.get("useBackupGoalKicker", False))

        if primary_active:
            r["useBackupGoalKicker"] = False
            r["roleStatus"] = "primary_named"
            active = primary
        elif backup_active:
            r["useBackupGoalKicker"] = True
            r["roleStatus"] = "primary_not_named_backup_named"
            active = backup
        else:
            # Do not guess. Keep previous setting but flag it.
            r["roleStatus"] = "warning_no_named_primary_or_backup"
            active = backup if r.get("useBackupGoalKicker") else primary

        r["activeGoalKicker"] = active
        r["lastRoleCheck"] = now

        report["teams"][team] = {
            "primary": primary,
            "backup": backup,
            "primaryActive": primary_active,
            "backupActive": backup_active,
            "useBackupGoalKickerBefore": old_use_backup,
            "useBackupGoalKickerAfter": r.get("useBackupGoalKicker"),
            "activeGoalKicker": active,
            "roleStatus": r.get("roleStatus")
        }

    roles["_updatedBy"] = "GitHub Actions update-team-roles"
    roles["_lastUpdated"] = now

    save_json(TEAM_ROLES, roles)
    save_json(REPORT, report)

    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
