from __future__ import annotations

from datetime import datetime, timezone
from html import unescape
import json
from pathlib import Path
import re
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"
REPORT_JSON = ROOT / "level3_enrichment_report.json"

STATS_URL = "https://www.nrlsupercoachstats.com/stats.php?year=2026&grid_id=list1"
MINUTES_URL = "https://www.nrlsupercoachstats.com/minutes.php?year=2026&grid_id=list1"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; JoelSuperCoachWarRoom/3.0)",
    "Accept": "application/json, text/javascript, */*; q=0.01",
}

NAME_ALIASES = {
    "nicho hynes": {"nicholas hynes"},
    "nicholas hynes": {"nicho hynes"},
    "tom duncan": {"tallis duncan"},
    "tallis duncan": {"tom duncan"},
}


def clean_text(value: Any) -> str:
    text = re.sub(r"<[^>]+>", "", str(value or ""))
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def source_display_name(value: Any) -> str:
    name = clean_text(value)
    if "," in name:
        last, first = [clean_text(part) for part in name.split(",", 1)]
        name = f"{first} {last}".strip()
    return name


def norm_name(value: Any) -> str:
    text = clean_text(value).lower().replace("’", "'")
    text = re.sub(r"[^a-z0-9\s'-]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def match_keys(value: Any) -> set[str]:
    base = norm_name(value)
    if not base:
        return set()

    keys = {base}
    keys.update(NAME_ALIASES.get(base, set()))

    if "te maire" in base:
        keys.add(base.replace("te maire", "temaire"))
    if "temaire" in base:
        keys.add(base.replace("temaire", "te maire"))

    expanded = set(keys)
    for key in list(keys):
        expanded.add(key.replace(" ", "").replace("'", "").replace("-", ""))
    return {key for key in expanded if key}


def clean_number(value: Any) -> float | int | None:
    if value is None:
        return None
    text = str(value).strip()
    if text in ("", "-", "nan", "None", "null"):
        return None
    text = text.replace("$", "").replace(",", "").replace("%", "")
    text = re.sub(r"[^\d.\-]", "", text)
    if text in ("", "-", "."):
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return int(number) if number.is_integer() else round(number, 2)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"players": data} if isinstance(data, list) else data


def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def fetch_jqgrid_rows(url: str, rows: int, sidx: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    params = {
        "_search": "false",
        "nd": str(int(time.time() * 1000)),
        "rows": str(rows),
        "jqgrid_page": "1",
        "sidx": sidx,
        "sord": "ASC",
    }
    request_url = f"{url}&{urlencode(params)}"
    request = Request(request_url, headers=HEADERS)

    with urlopen(request, timeout=60) as response:
        raw = response.read().decode("utf-8", errors="replace")
        status = getattr(response, "status", None)

    payload = json.loads(raw)
    return payload.get("rows", []), {
        "url": url,
        "requestUrl": request_url,
        "httpStatus": status,
        "records": payload.get("records"),
        "totalPages": payload.get("total"),
        "returnedRows": len(payload.get("rows", [])),
    }


def row_round(row: dict[str, Any]) -> int:
    value = clean_number(row.get("Rd"))
    return int(value) if value is not None else -1


def latest_stats_by_player(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}

    for row in rows:
        name = source_display_name(row.get("Name2") or row.get("Name"))
        if not name:
            continue

        current = latest.get(norm_name(name))
        if current is None or row_round(row) >= row_round(current):
            latest[norm_name(name)] = row

    out: dict[str, dict[str, Any]] = {}
    for row in latest.values():
        name = source_display_name(row.get("Name2") or row.get("Name"))
        rec: dict[str, Any] = {}

        field_map = {
            "AvgScore": "avg",
            "BE": "breakeven",
            "ThreeRdAvg": "last3Avg",
            "FiveRdAvg": "last5Avg",
            "AvgMins": "expectedMinutes",
            "PPM": "ppm",
            "Price": "price",
        }

        for source_field, target_field in field_map.items():
            value = clean_number(row.get(source_field))
            if value is not None:
                rec[target_field] = value

        if "last3Avg" in rec:
            rec["threeRoundAvg"] = rec["last3Avg"]
        if "last5Avg" in rec:
            rec["fiveRoundAvg"] = rec["last5Avg"]
        if "expectedMinutes" in rec:
            rec["minutes"] = rec["expectedMinutes"]
            rec["roleConfidence"] = "Medium"
            rec["roleNote"] = "Average minutes imported from NRL SuperCoach Stats jqGrid."
        if rec.get("avg") is not None:
            rec["proj"] = rec["avg"]
            rec["projectionSource"] = "nrlsupercoachstats jqGrid AvgScore"

        if rec:
            rec["statsSourceRound"] = row.get("Rd")
            rec["statsSourceName"] = name
            out[norm_name(name)] = rec

    return out


def minutes_backup_by_player(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}

    for row in rows:
        name = source_display_name(row.get("Name"))
        if not name:
            continue

        minutes = []
        for round_number in range(1, 28):
            value = clean_number(row.get(f"Rd{round_number}"))
            if value is not None and value > 0:
                minutes.append(value)

        if minutes:
            avg_minutes = round(sum(minutes) / len(minutes), 1)
            out[norm_name(name)] = {
                "expectedMinutes": avg_minutes,
                "minutes": avg_minutes,
                "roleConfidence": "Medium",
                "roleNote": "Average minutes imported from NRL SuperCoach Stats minutes jqGrid.",
            }

    return out


def find_enrichment(player: dict[str, Any], enrich: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    candidate_names = [player.get("name"), player.get("sourceName"), player.get("statsSourceName")]
    for name in candidate_names:
        for key in match_keys(name):
            if key in enrich:
                return enrich[key]
    return None


def missing_fields(player: dict[str, Any]) -> list[str]:
    checks = [
        ("avg", "season average"),
        ("last3Avg", "last 3"),
        ("last5Avg", "last 5"),
        ("ownership", "ownership"),
        ("breakeven", "BE"),
        ("expectedMinutes", "minutes/role"),
    ]
    return [label for field, label in checks if player.get(field) in (None, "", [])]


def apply_enrichment(players_doc: dict[str, Any], enrich: dict[str, dict[str, Any]], minutes_backup: dict[str, dict[str, Any]]) -> dict[str, Any]:
    players = players_doc.get("players", [])
    updated = 0
    matched_with_fields = {
        "avg": 0,
        "breakeven": 0,
        "last3Avg": 0,
        "last5Avg": 0,
        "expectedMinutes": 0,
    }

    unmatched = []

    for player in players:
        before = json.dumps(player, sort_keys=True)
        rec = find_enrichment(player, enrich)

        if rec:
            player.update(rec)
        else:
            unmatched.append(player.get("name"))

        if player.get("expectedMinutes") in (None, "", []):
            backup = find_enrichment(player, minutes_backup)
            if backup:
                player.update(backup)

        if "last3Avg" in player:
            player["threeRoundAvg"] = player["last3Avg"]
        if "last5Avg" in player:
            player["fiveRoundAvg"] = player["last5Avg"]

        # Premium-decision fields are not available from these sources.
        for field in ["ownership", "captainOwnership", "vcOwnership"]:
            if player.get(field) == "":
                player[field] = None

        player["level3MissingData"] = missing_fields(player)
        player["level3Ready"] = len(player["level3MissingData"]) <= 2

        for field in matched_with_fields:
            if player.get(field) not in (None, "", []):
                matched_with_fields[field] += 1

        if before != json.dumps(player, sort_keys=True):
            updated += 1

    return {
        "updated": updated,
        "total": len(players),
        "unmatched": unmatched,
        "matchedWithFields": matched_with_fields,
    }


def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    report: dict[str, Any] = {
        "updated": now,
        "sources": {
            "stats_jqgrid": STATS_URL,
            "minutes_jqgrid": MINUTES_URL,
        },
        "source_debug": {},
        "premium_data_roadmap": {
            "ownership": "unavailable from current reliable sources; left null",
            "captainOwnership": "unavailable from current reliable sources; left null",
            "vcOwnership": "unavailable from current reliable sources; left null",
            "officialInjuryReturnStatus": "unavailable from current reliable sources; left unchanged/null",
            "roleNewsLateMail": "unavailable from current reliable sources; left null",
        },
    }

    stats_rows, stats_info = fetch_jqgrid_rows(STATS_URL, rows=5000, sidx="Name")
    minutes_rows, minutes_info = fetch_jqgrid_rows(MINUTES_URL, rows=1000, sidx="MIN(Jersey+0) ")

    stats_enrich = latest_stats_by_player(stats_rows)
    minutes_enrich = minutes_backup_by_player(minutes_rows)

    players_doc = load_json(PLAYERS_JSON, {"players": []})
    result = apply_enrichment(players_doc, stats_enrich, minutes_enrich)

    players_doc["level3AutoEnrichment"] = {
        "updated": now,
        "source": STATS_URL,
        "playersUpdated": result["updated"],
        "totalPlayersInFile": result["total"],
        "matchedWithFields": result["matchedWithFields"],
        "premiumFieldsUnavailable": [
            "ownership",
            "captainOwnership",
            "vcOwnership",
            "officialInjuryReturnStatus",
            "roleNewsLateMail",
        ],
    }

    report["source_debug"]["stats_jqgrid"] = {
        **stats_info,
        "uniquePlayers": len(stats_enrich),
        "sampleFields": ["AvgScore", "BE", "ThreeRdAvg", "FiveRdAvg", "AvgMins", "PPM", "Price"],
    }
    report["source_debug"]["minutes_jqgrid"] = {
        **minutes_info,
        "uniquePlayers": len(minutes_enrich),
        "usage": "backup for expectedMinutes only",
    }
    report["status"] = {
        "stats_jqgrid": "ok",
        "minutes_jqgrid": "ok",
    }
    report["counts"] = {
        "stats_rows": len(stats_rows),
        "stats_unique_players": len(stats_enrich),
        "minutes_rows": len(minutes_rows),
        "minutes_unique_players": len(minutes_enrich),
        "players_json_updated": result["updated"],
        "players_json_total": result["total"],
        **{f"players_with_{field}": count for field, count in result["matchedWithFields"].items()},
        "players_unmatched_to_stats": len(result["unmatched"]),
    }
    report["unmatched_players"] = result["unmatched"]
    report["note"] = "Ownership, captain ownership, VC ownership, injury/return status and late mail are not faked."

    save_json(PLAYERS_JSON, players_doc)
    save_json(REPORT_JSON, report)

    print(json.dumps(report, indent=2, ensure_ascii=False))
    print("Level 3 enrichment complete.")


if __name__ == "__main__":
    main()
