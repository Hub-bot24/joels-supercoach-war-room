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
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"
SEED_JSON = ROOT / "players_seed_round14.json"
REPORT_JSON = ROOT / "level3_enrichment_report.json"

SOURCES = {
    "stats_table": "https://www.nrlsupercoachstats.com/stats.php?year=2026",
    "minutes": "https://www.nrlsupercoachstats.com/minutes.php?year=2026",
    "prices_bes": "https://www.nrlsupercoachstats.com/TeamPricesAndBEs.php",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

def norm_name(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9\s'-]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text

def norm_col(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "", text)
    return text

def clean_number(value: Any):
    if value is None:
        return None
    text = str(value).strip()
    if text in ("", "-", "nan", "None"):
        return None
    text = text.replace("$", "").replace(",", "").replace("%", "")
    text = re.sub(r"[^\d\.\-]", "", text)
    if text in ("", "-", "."):
        return None
    try:
        n = float(text)
        return int(n) if n.is_integer() else round(n, 2)
    except Exception:
        return None

def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {"players": data}
    return data

def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")

def fetch_tables(url: str, source_name: str, diagnostics: dict[str, Any]) -> list[pd.DataFrame]:
    info = {"url": url}
    try:
        res = requests.get(url, headers=HEADERS, timeout=35)
        info["http_status"] = res.status_code
        info["content_length"] = len(res.text)
        info["contains_table_tag"] = "<table" in res.text.lower()
        info["first_300_chars"] = res.text[:300]
        res.raise_for_status()

        tables = pd.read_html(res.text)
        good = []
        for df in tables:
            if df.empty:
                continue
            df = df.copy()
            df.columns = [str(c).strip() for c in df.columns]
            if len(df.columns) >= 3 and len(df) >= 5:
                good.append(df)

        info["tables_found"] = len(tables)
        info["usable_tables"] = len(good)
        diagnostics["source_debug"][source_name] = info
        return good
    except Exception as e:
        info["error"] = str(e)
        diagnostics["source_debug"][source_name] = info
        return []

def pick_best_table(tables: list[pd.DataFrame]) -> pd.DataFrame | None:
    best = None
    best_score = -1
    for df in tables:
        cols = [norm_col(c) for c in df.columns]
        score = len(df)
        if any(c in ("player", "name", "playername") for c in cols):
            score += 1000
        if any("avg" in c or "average" in c for c in cols):
            score += 100
        if any("min" in c for c in cols):
            score += 50
        if score > best_score:
            best_score = score
            best = df
    return best

def find_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    lookup = {norm_col(c): c for c in df.columns}
    for cand in candidates:
        n = norm_col(cand)
        if n in lookup:
            return lookup[n]
    for raw in df.columns:
        nr = norm_col(raw)
        for cand in candidates:
            nc = norm_col(cand)
            if nc and nc in nr:
                return raw
    return None

def row_name(row: pd.Series, df: pd.DataFrame) -> str:
    name_col = find_col(df, ["Player", "Name", "Player Name"])
    if name_col:
        return str(row.get(name_col, "")).strip()
    return str(row.iloc[0]).strip()

def build_stats_map(df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    out = {}
    avg_col = find_col(df, ["Avg", "Average", "SC Avg", "SuperCoach Avg"])
    pos_col = find_col(df, ["Pos", "Position"])
    team_col = find_col(df, ["Team", "Club"])
    price_col = find_col(df, ["Price", "Current Price", "$"])
    round_cols = []
    for c in df.columns:
        nc = norm_col(c)
        if re.fullmatch(r"r?\d{1,2}", nc):
            round_cols.append(c)
    round_cols = round_cols[-8:]

    for _, row in df.iterrows():
        name = row_name(row, df)
        key = norm_name(name)
        if not key or key in ("player", "name"):
            continue
        rec = {}
        if avg_col:
            rec["avg"] = clean_number(row.get(avg_col))
        if pos_col and str(row.get(pos_col, "")).strip():
            rec["pos"] = str(row.get(pos_col)).strip()
        if team_col and str(row.get(team_col, "")).strip():
            rec["team"] = str(row.get(team_col)).strip()
        if price_col:
            rec["price"] = clean_number(row.get(price_col))
        scores = []
        for c in round_cols:
            n = clean_number(row.get(c))
            if n is not None and n >= 0:
                scores.append(n)
        if scores:
            rec["recentScores"] = scores
            if len(scores) >= 3:
                rec["last3Avg"] = round(sum(scores[-3:]) / 3, 1)
                rec["threeRoundAvg"] = rec["last3Avg"]
            if len(scores) >= 5:
                rec["last5Avg"] = round(sum(scores[-5:]) / 5, 1)
                rec["fiveRoundAvg"] = rec["last5Avg"]
        if rec.get("avg") is not None and rec.get("avg") != 0:
            rec["proj"] = rec["avg"]
            rec["projectionSource"] = "auto enrichment public stats average"
        out[key] = {k:v for k,v in rec.items() if v is not None and v != ""}
    return out

def build_minutes_map(df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    out = {}
    min_col = find_col(df, ["Avg Min", "Avg Mins", "Average Minutes", "Minutes", "Mins", "Min"])
    ppm_col = find_col(df, ["PPM", "Pts/Min", "Points Per Minute"])

    for _, row in df.iterrows():
        name = row_name(row, df)
        key = norm_name(name)
        if not key or key in ("player", "name"):
            continue
        rec = {}
        if min_col:
            rec["expectedMinutes"] = clean_number(row.get(min_col))
            rec["minutes"] = rec["expectedMinutes"]
        if ppm_col:
            rec["ppm"] = clean_number(row.get(ppm_col))
        if rec.get("expectedMinutes"):
            rec["roleConfidence"] = "Medium"
            rec["roleNote"] = "Average minutes imported from public minutes table."
        out[key] = {k:v for k,v in rec.items() if v is not None and v != ""}
    return out

def build_bes_map(df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    out = {}
    be_col = find_col(df, ["BE", "B/E", "Breakeven", "Break Even"])
    price_col = find_col(df, ["Price", "Current Price", "$"])
    avg_col = find_col(df, ["Avg", "Average"])

    for _, row in df.iterrows():
        name = row_name(row, df)
        key = norm_name(name)
        if not key or key in ("player", "name"):
            continue
        rec = {}
        if be_col:
            rec["breakeven"] = clean_number(row.get(be_col))
        if price_col:
            rec["price"] = clean_number(row.get(price_col))
        if avg_col:
            rec["avg"] = clean_number(row.get(avg_col))
        out[key] = {k:v for k,v in rec.items() if v is not None and v != ""}
    return out

def merge_maps(*maps: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    merged = {}
    for m in maps:
        for key, val in m.items():
            merged.setdefault(key, {}).update(val)
    return merged

def apply_enrichment_to_file(path: Path, enrich: dict[str, dict[str, Any]]) -> tuple[int, int]:
    if not path.exists():
        return 0, 0
    data = load_json(path, {"players": []})
    players = data.get("players", [])
    updated = 0
    for p in players:
        rec = enrich.get(norm_name(p.get("name")))
        if not rec:
            continue
        before = json.dumps(p, sort_keys=True)
        p.update(rec)
        if "last3Avg" in p:
            p["threeRoundAvg"] = p["last3Avg"]
        if "last5Avg" in p:
            p["fiveRoundAvg"] = p["last5Avg"]
        missing = []
        for field, label in [
            ("avg", "season average"),
            ("last3Avg", "last 3"),
            ("last5Avg", "last 5"),
            ("ownership", "ownership"),
            ("breakeven", "BE"),
            ("expectedMinutes", "minutes/role"),
        ]:
            if p.get(field) in (None, "", []):
                missing.append(label)
        p["level3MissingData"] = missing
        p["level3Ready"] = len(missing) <= 2
        after = json.dumps(p, sort_keys=True)
        if before != after:
            updated += 1
    data["level3AutoEnrichment"] = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "playersUpdated": updated,
        "totalPlayersInFile": len(players),
        "warning": "If zero players updated, inspect level3_enrichment_report.json."
    }
    save_json(path, data)
    return updated, len(players)

def main():
    diagnostics = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "sources": SOURCES,
        "source_debug": {},
        "status": {},
        "counts": {},
        "fatal": None,
    }

    stats_map = {}
    minutes_map = {}
    bes_map = {}

    tables = fetch_tables(SOURCES["stats_table"], "stats_table", diagnostics)
    df = pick_best_table(tables)
    if df is not None:
        stats_map = build_stats_map(df)
        diagnostics["status"]["stats_table"] = "ok"
        diagnostics["counts"]["stats_players"] = len(stats_map)
        diagnostics["counts"]["stats_columns"] = list(map(str, df.columns))
    else:
        diagnostics["status"]["stats_table"] = "no usable table"

    tables = fetch_tables(SOURCES["minutes"], "minutes", diagnostics)
    df = pick_best_table(tables)
    if df is not None:
        minutes_map = build_minutes_map(df)
        diagnostics["status"]["minutes"] = "ok"
        diagnostics["counts"]["minutes_players"] = len(minutes_map)
        diagnostics["counts"]["minutes_columns"] = list(map(str, df.columns))
    else:
        diagnostics["status"]["minutes"] = "no usable table"

    tables = fetch_tables(SOURCES["prices_bes"], "prices_bes", diagnostics)
    df = pick_best_table(tables)
    if df is not None:
        bes_map = build_bes_map(df)
        diagnostics["status"]["prices_bes"] = "ok"
        diagnostics["counts"]["be_players"] = len(bes_map)
        diagnostics["counts"]["be_columns"] = list(map(str, df.columns))
    else:
        diagnostics["status"]["prices_bes"] = "no usable table"

    enrich = merge_maps(stats_map, minutes_map, bes_map)
    diagnostics["counts"]["enrichment_records"] = len(enrich)

    if enrich:
        p_updated, p_total = apply_enrichment_to_file(PLAYERS_JSON, enrich)
        s_updated, s_total = apply_enrichment_to_file(SEED_JSON, enrich)
    else:
        p_updated = s_updated = 0
        p_total = len(load_json(PLAYERS_JSON, {"players": []}).get("players", []))
        s_total = len(load_json(SEED_JSON, {"players": []}).get("players", []))
        diagnostics["fatal"] = "No enrichment data extracted. This usually means the source site blocked GitHub Actions or changed table structure."

    diagnostics["counts"]["players_json_updated"] = p_updated
    diagnostics["counts"]["players_json_total"] = p_total
    diagnostics["counts"]["seed_json_updated"] = s_updated
    diagnostics["counts"]["seed_json_total"] = s_total
    diagnostics["note"] = "Workflow no longer fails on zero data. Check this report to decide the next source."

    REPORT_JSON.write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")
    print(json.dumps(diagnostics, indent=2))
    print("Diagnostic report written to level3_enrichment_report.json")

if __name__ == "__main__":
    main()
