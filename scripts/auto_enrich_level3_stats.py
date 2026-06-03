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
    "User-Agent": "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0; +https://github.com/)",
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

def fetch_tables(url: str) -> list[pd.DataFrame]:
    res = requests.get(url, headers=HEADERS, timeout=35)
    res.raise_for_status()

    if "ad blocker" in res.text.lower() and "<table" not in res.text.lower():
        raise RuntimeError("Source returned ad-block/anti-bot page without usable tables.")

    tables = pd.read_html(res.text)
    good = []
    for df in tables:
        if df.empty:
            continue
        df = df.copy()
        df.columns = [str(c).strip() for c in df.columns]
        if len(df.columns) >= 3 and len(df) >= 5:
            good.append(df)
    return good

def pick_best_table(tables: list[pd.DataFrame], required_name=True) -> pd.DataFrame | None:
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
        if required_name and not any(c in ("player", "name", "playername") for c in cols):
            # Some tables still have first column as player, allow but penalise.
            score -= 200
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
    # fallback contains
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
    games_col = find_col(df, ["Games", "G"])
    total_col = find_col(df, ["Total", "Points", "Pts"])

    # Round score columns often look like R1/R2/R3 or 1/2/3. Use numeric-looking scoring columns.
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
        if games_col:
            rec["games"] = clean_number(row.get(games_col))
        if total_col:
            rec["totalPoints"] = clean_number(row.get(total_col))

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

        # Projection base: do not invent if no avg.
        if rec.get("avg") is not None and rec.get("avg") != 0:
            rec["proj"] = rec["avg"]
            rec["projectionSource"] = "nrlsupercoachstats stats table average"

        out[key] = {k:v for k,v in rec.items() if v is not None and v != ""}
    return out

def build_minutes_map(df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    out = {}

    min_col = find_col(df, ["Avg Min", "Avg Mins", "Average Minutes", "Minutes", "Mins", "Min"])
    ppm_col = find_col(df, ["PPM", "Pts/Min", "Points Per Minute"])
    total_min_col = find_col(df, ["Total Minutes", "Total Mins"])
    games_col = find_col(df, ["Games", "G"])

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
        if total_min_col:
            rec["totalMinutes"] = clean_number(row.get(total_min_col))
        if games_col:
            rec["minutesGames"] = clean_number(row.get(games_col))

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
    team_col = find_col(df, ["Team", "Club"])
    pos_col = find_col(df, ["Pos", "Position"])

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
        if team_col and str(row.get(team_col, "")).strip():
            rec["team"] = str(row.get(team_col)).strip()
        if pos_col and str(row.get(pos_col, "")).strip():
            rec["pos"] = str(row.get(pos_col)).strip()

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
        key = norm_name(p.get("name"))
        rec = enrich.get(key)
        if not rec:
            continue

        # Never overwrite manually better non-empty values with blanks; rec already filtered.
        before = json.dumps(p, sort_keys=True)
        p.update(rec)

        # sync naming
        if "last3Avg" in p:
            p["threeRoundAvg"] = p["last3Avg"]
        if "last5Avg" in p:
            p["fiveRoundAvg"] = p["last5Avg"]

        # Track missing data after enrichment
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
        "sources": SOURCES,
        "playersUpdated": updated,
        "totalPlayersInFile": len(players),
        "warning": "Ownership/captain% are not imported unless present in the source tables. Treat missing fields honestly."
    }
    save_json(path, data)
    return updated, len(players)

def main():
    diagnostics = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "sources": SOURCES,
        "status": {},
        "counts": {},
    }

    stats_map = {}
    minutes_map = {}
    bes_map = {}

    # Stats table
    try:
        tables = fetch_tables(SOURCES["stats_table"])
        df = pick_best_table(tables)
        if df is None:
            raise RuntimeError("No usable stats table found.")
        stats_map = build_stats_map(df)
        diagnostics["status"]["stats_table"] = "ok"
        diagnostics["counts"]["stats_players"] = len(stats_map)
        diagnostics["counts"]["stats_columns"] = list(map(str, df.columns))
    except Exception as e:
        diagnostics["status"]["stats_table"] = f"failed: {e}"

    # Minutes
    try:
        tables = fetch_tables(SOURCES["minutes"])
        df = pick_best_table(tables)
        if df is None:
            raise RuntimeError("No usable minutes table found.")
        minutes_map = build_minutes_map(df)
        diagnostics["status"]["minutes"] = "ok"
        diagnostics["counts"]["minutes_players"] = len(minutes_map)
        diagnostics["counts"]["minutes_columns"] = list(map(str, df.columns))
    except Exception as e:
        diagnostics["status"]["minutes"] = f"failed: {e}"

    # Prices & BEs
    try:
        tables = fetch_tables(SOURCES["prices_bes"])
        df = pick_best_table(tables, required_name=False)
        if df is None:
            raise RuntimeError("No usable prices/BE table found.")
        bes_map = build_bes_map(df)
        diagnostics["status"]["prices_bes"] = "ok"
        diagnostics["counts"]["be_players"] = len(bes_map)
        diagnostics["counts"]["be_columns"] = list(map(str, df.columns))
    except Exception as e:
        diagnostics["status"]["prices_bes"] = f"failed: {e}"

    enrich = merge_maps(stats_map, minutes_map, bes_map)

    if not enrich:
        diagnostics["fatal"] = "No enrichment data extracted."
        REPORT_JSON.write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")
        raise RuntimeError("No enrichment data extracted. Check level3_enrichment_report.json.")

    p_updated, p_total = apply_enrichment_to_file(PLAYERS_JSON, enrich)
    s_updated, s_total = apply_enrichment_to_file(SEED_JSON, enrich)

    diagnostics["counts"]["enrichment_records"] = len(enrich)
    diagnostics["counts"]["players_json_updated"] = p_updated
    diagnostics["counts"]["players_json_total"] = p_total
    diagnostics["counts"]["seed_json_updated"] = s_updated
    diagnostics["counts"]["seed_json_total"] = s_total
    diagnostics["note"] = "Season avg, recent scores, minutes and BEs depend on what the source tables expose. Ownership may need separate source/import."

    REPORT_JSON.write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")
    print(json.dumps(diagnostics, indent=2))

if __name__ == "__main__":
    main()
