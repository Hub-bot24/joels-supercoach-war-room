"""
Starter updater for Joel's SuperCoach War Room.

This script is intentionally safe:
- It does NOT scrape paid/member-only sites.
- It creates/updates players.json from local source files or future allowed APIs.

Future inputs can be:
1. An allowed API response
2. A CSV export you are allowed to use
3. A public fixtures/team-list feed
"""

from __future__ import annotations
import json
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"

def main() -> None:
    if PLAYERS_JSON.exists():
        data = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    else:
        data = {"players": []}

    data["updated"] = datetime.now(timezone.utc).isoformat()
    data["source"] = "safe-updater-placeholder"

    # TODO:
    # Plug in allowed data source here.
    # Example:
    # - fetch NRL draw/team lists from approved API
    # - merge injuries into matching players
    # - update bye rounds
    # - update projections

    PLAYERS_JSON.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Updated {PLAYERS_JSON}")

if __name__ == "__main__":
    main()