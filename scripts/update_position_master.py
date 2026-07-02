#!/usr/bin/env python3
"""
Core SuperCoach Position Master Update

Core rules:
- No one-player hardcodes.
- No temporary/manual DPP patches.
- Current imported/web DPP data must flow into position_master.json and dual_positions.json.
- Manual overrides are only protected exceptions, not the main source of truth.
"""

import json
import re
from pathlib import Path
from datetime import datetime, timezone
from html import unescape
from urllib.parse import unquote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_PATH = ROOT / "players.json"
SEED_PATH = ROOT / "players_seed_round14.json"
OVERRIDES_PATH = ROOT / "position_overrides.json"
MASTER_PATH = ROOT / "position_master.json"
DUAL_PATH = ROOT / "dual_positions.json"
REPORT_PATH = ROOT / "position_audit_report.json"

VALID = {"HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB"}

DPP_SOURCE_URLS = [
    "https://www.nrlsupercoachstats.com/dualposngrid.php?year=2026",
    "https://www.nrlsupercoachstats.com/dualposition.php?year=2026",
]

def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default

def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

def extract_players(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("players"), list):
        return data["players"]
    return []

def clean_text(value):
    text = unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\xa0", " ").replace("&nbsp", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()

def norm_name(name):
    return " ".join(
        str(name or "")
        .lower()
        .replace("â€™", "'")
        .replace("’", "'")
        .replace(".", "")
        .split()
    )

def display_name_from_source(value):
    text = clean_text(value)
    if "," in text:
        last, first = [clean_text(x) for x in text.split(",", 1)]
        if first and last:
            return f"{first} {last}"
    return text

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

def positions_from_text(text):
    text = clean_text(text).upper()
    found = []
    for pos in ["HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB"]:
        if re.search(rf"(^|[^A-Z0-9/]){re.escape(pos)}([^A-Z0-9/]|$)", text):
            found.append(pos)
    return found

def player_name(p):
    return p.get("name") or p.get("player") or p.get("playerName") or p.get("fullName")

def player_positions(p):
    for key in ["positions", "eligiblePositions", "supercoachPositions", "dualPositions", "position", "pos", "role"]:
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

def fetch_html(url):
    req = Request(
        url,
        headers={
            "User-Agent": "JoelSuperCoachWarRoom/position-updater",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urlopen(req, timeout=30) as res:
        return res.read().decode("utf-8", errors="replace")

def parse_dpp_from_html(html, source_url):
    out = {}
    seen = set()

    link_re = re.compile(
        r'<a\s+[^>]*href=["\'][^"\']*index\.php\?player=([^"\']+)["\'][^>]*>.*?</a>',
        re.I | re.S,
    )

    for m in link_re.finditer(html):
        raw_name = unquote(unescape(m.group(1)))
        name = display_name_from_source(raw_name)
        key = norm_name(name)

        if not key or key in seen:
            continue

        start = html.rfind("<tr", 0, m.start())
        end = html.find("</tr>", m.end())
        if start != -1 and end != -1 and end > m.start():
            chunk = html[start:end]
        else:
            chunk = html[m.start():m.end() + 900]

        positions = positions_from_text(chunk)

        if len(positions) >= 2:
            out[name] = {
                "positions": positions,
                "source": source_url,
            }
            seen.add(key)

    return out

def fetch_dpp_positions():
    dpp = {}
    source_counts = {}

    for url in DPP_SOURCE_URLS:
        try:
            print(f"Fetching DPP source: {url}")
            html = fetch_html(url)
            parsed = parse_dpp_from_html(html, url)
            source_counts[url] = len(parsed)
            print(f"Parsed {len(parsed)} DPP rows from {url}")

            for name, rec in parsed.items():
                dpp[name] = rec
        except Exception as e:
            source_counts[url] = f"ERROR: {e}"
            print(f"DPP source failed: {url}: {e}")

    return dpp, source_counts

def apply_positions_to_player_record(player, positions):
    joined = "/".join(positions)
    player["pos"] = joined
    player["position"] = joined
    player["positions"] = positions
    player["eligiblePositions"] = positions
    player["dualPositions"] = positions
    player["positionFixed"] = False

def main():
    players = merge_player_sources()
    overrides_data = load_json(OVERRIDES_PATH, {"players": {}})
    overrides = overrides_data.get("players", {}) if isinstance(overrides_data, dict) else {}

    dpp_positions, dpp_source_counts = fetch_dpp_positions()
    dpp_by_norm = {norm_name(name): (name, rec["positions"], rec["source"]) for name, rec in dpp_positions.items()}

    master = {}
    report = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "total_players_seen": len(players),
        "positions_from_import": 0,
        "positions_from_dpp_source": 0,
        "manual_overrides_applied": 0,
        "missing_positions": [],
        "dpp_source_counts": dpp_source_counts,
        "dpp_applied": [],
        "conflicts_fixed_by_dpp_source": [],
        "conflicts_fixed_by_override": [],
    }

    for n, p in players.items():
        name = player_name(p)
        if not name:
            continue

        pos = player_positions(p)
        if pos:
            master[name] = pos
            report["positions_from_import"] += 1
        else:
            report["missing_positions"].append(name)

    for n, (source_name, dpp_pos, source_url) in dpp_by_norm.items():
        existing_name = None
        existing_pos = None

        for m_name, m_pos in master.items():
            if norm_name(m_name) == n:
                existing_name = m_name
                existing_pos = m_pos
                break

        final_name = existing_name or source_name

        if existing_pos and set(existing_pos) != set(dpp_pos):
            report["conflicts_fixed_by_dpp_source"].append({
                "player": final_name,
                "imported": existing_pos,
                "dpp": dpp_pos,
                "source": source_url,
            })

        master[final_name] = dpp_pos
        report["positions_from_dpp_source"] += 1
        report["dpp_applied"].append({
            "player": final_name,
            "positions": dpp_pos,
            "source": source_url,
        })

        if n in players:
            apply_positions_to_player_record(players[n], dpp_pos)

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
                "imported_or_dpp": existing_pos,
                "trusted": trusted,
            })
            del master[existing_name]

        master[name] = trusted
        report["manual_overrides_applied"] += 1

        n = norm_name(name)
        if n in players:
            apply_positions_to_player_record(players[n], trusted)

    master = dict(sorted(master.items(), key=lambda kv: kv[0].lower()))

    master_out = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "players.json + live DPP source + protected position_overrides.json",
        "rule": "Live DPP source wins over imported single-position data. Protected manual overrides win only as exceptions.",
        "players": master,
    }

    dual_out = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "generated from position_master.json with live DPP source",
        "players": master,
    }

    players_data = load_json(PLAYERS_PATH, {})
    if isinstance(players_data, dict) and isinstance(players_data.get("players"), list):
        by_norm = {norm_name(player_name(p)): p for p in players_data["players"] if player_name(p)}
        for n, merged_player in players.items():
            if n in by_norm:
                for key in ["pos", "position", "positions", "eligiblePositions", "dualPositions", "positionFixed"]:
                    if key in merged_player:
                        by_norm[n][key] = merged_player[key]

    write_json(PLAYERS_PATH, players_data)
    write_json(MASTER_PATH, master_out)
    write_json(DUAL_PATH, dual_out)
    write_json(REPORT_PATH, report)

    print(f"Position master updated: {len(master)} players")
    print(f"Imported positions: {report['positions_from_import']}")
    print(f"Live DPP positions applied: {report['positions_from_dpp_source']}")
    print(f"Manual overrides applied: {report['manual_overrides_applied']}")
    print(f"Conflicts fixed by DPP source: {len(report['conflicts_fixed_by_dpp_source'])}")
    print(f"Missing positions: {len(report['missing_positions'])}")

if __name__ == "__main__":
    main()
