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
