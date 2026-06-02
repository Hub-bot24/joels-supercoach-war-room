from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"

def main():
    data = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    data["lastAutomationRun"] = datetime.now(timezone.utc).isoformat()
    data["automationStatus"] = "GitHub Actions pipeline is working. Real data source still required."
    PLAYERS_JSON.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print("players.json updated successfully")

if __name__ == "__main__":
    main()
