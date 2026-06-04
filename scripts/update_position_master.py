#!/usr/bin/env python3
"""
Source-driven SuperCoach Position Master Update.

This script regenerates position_master.json from the public NRL SuperCoach
Stats player list used by the app's data pipeline family. Manual overrides are
fallback-only exceptions for players missing from the imported source.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_PATH = ROOT / "players.json"
SEED_PATH = ROOT / "players_seed_round14.json"
OVERRIDES_PATH = ROOT / "position_overrides.json"
MASTER_PATH = ROOT / "position_master.json"
DUAL_PATH = ROOT / "dual_positions.json"
REPORT_PATH = ROOT / "position_audit_report.json"

SOURCE_URL = "https://nrlsupercoachstats.com/playerlist.php"
USER_AGENT = "Mozilla/5.0 (compatible; JoelSuperCoachWarRoom/3.0)"

VALID_POSITIONS = ("HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB")
VALID_POSITION_SET = set(VALID_POSITIONS)

# Source team codes that differ from this app's fixtures/team-role files.
TEAM_CODE_MAP = {
    "BUL": "CAN",
    "GCT": "GLD",
    "MNL": "MAN",
    "PTH": "PEN",
}

# Identity normalisation only. Do not encode positions here.
DISPLAY_NAME_NORMALISATIONS = {
    "TeMaire Martin": "Te Maire Martin",
}

NAME_ALIASES = {
    "nicho hynes": {"nicholas hynes"},
    "nicholas hynes": {"nicho hynes"},
}


@dataclass(frozen=True)
class SourcePlayer:
    name: str
    source_name: str
    team: str
    source_team: str
    positions: list[str]
    price: int | None


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "tr":
            self._current_row = []
        elif tag in {"td", "th"} and self._current_row is not None:
            self._current_cell = []

    def handle_data(self, data: str) -> None:
        if self._current_cell is not None:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._current_row is not None and self._current_cell is not None:
            self._current_row.append(clean_text("".join(self._current_cell)))
            self._current_cell = None
        elif tag == "tr" and self._current_row is not None:
            if any(cell for cell in self._current_row):
                self.rows.append(self._current_row)
            self._current_row = None


def clean_text(value) -> str:
    text = unescape(str(value or ""))
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def load_json(path: Path, default):
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


def norm_name(name) -> str:
    text = clean_text(name).lower().replace("’", "'")
    text = re.sub(r"[^a-z0-9\s'-]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def match_keys(name: str) -> set[str]:
    base = norm_name(name)
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


def pos_list(*values) -> list[str]:
    """Extract SuperCoach positions without splitting the 5/8 token."""
    out: list[str] = []

    def add(value) -> None:
        if value is None:
            return
        if isinstance(value, list):
            for item in value:
                add(item)
            return

        text = clean_text(value).upper()
        matches = re.findall(r"(?<![A-Z0-9])(HOK|FRF|2RF|HFB|5/8|CTW|FLB)(?![A-Z0-9])", text)
        for match in matches:
            if match in VALID_POSITION_SET and match not in out:
                out.append(match)

    for value in values:
        add(value)

    return out


def player_name(player) -> str:
    return player.get("name") or player.get("player") or player.get("playerName") or player.get("fullName") or ""


def player_positions(player) -> list[str]:
    for key in ["positions", "eligiblePositions", "supercoachPositions", "dualPositions", "position", "pos"]:
        if key in player:
            positions = pos_list(player.get(key))
            if positions:
                return positions
    return []


def team_code(value) -> str:
    raw = clean_text(value).upper()
    return TEAM_CODE_MAP.get(raw, raw)


def to_price(value) -> int | None:
    text = re.sub(r"[^0-9]", "", str(value or ""))
    return int(text) if text else None


def source_display_name(source_name: str) -> str:
    name = clean_text(source_name)
    if "," in name:
        last, first = [clean_text(part) for part in name.split(",", 1)]
        name = f"{first} {last}".strip()
    return DISPLAY_NAME_NORMALISATIONS.get(name, name)


def fetch_source_html() -> str:
    request = Request(SOURCE_URL, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def local_name_lookup() -> dict[str, str]:
    names: dict[str, str] = {}
    for path in [SEED_PATH, PLAYERS_PATH]:
        data = load_json(path, [])
        for player in extract_players(data):
            name = player_name(player)
            if not name:
                continue
            for key in match_keys(name):
                names.setdefault(key, name)
    return names


def parse_source_players(html: str, local_names_by_key: dict[str, str]) -> list[SourcePlayer]:
    parser = TableParser()
    parser.feed(html)

    header_index = None
    indexes: dict[str, int] = {}
    for i, row in enumerate(parser.rows):
        lowered = [cell.lower() for cell in row]
        if {"name", "team", "posn1", "posn2"}.issubset(set(lowered)):
            header_index = i
            indexes = {cell.lower(): idx for idx, cell in enumerate(row)}
            break

    if header_index is None:
        raise RuntimeError("Could not find Name/Team/Posn1/Posn2 table in SuperCoach source")

    parsed: list[SourcePlayer] = []
    seen = set()
    required_index = max(indexes["name"], indexes["team"], indexes["posn1"], indexes["posn2"])

    for row in parser.rows[header_index + 1:]:
        if len(row) <= required_index:
            continue

        raw_name = row[indexes["name"]]
        display_name = source_display_name(raw_name)
        positions = pos_list(row[indexes["posn1"]], row[indexes["posn2"]])
        if not display_name or not positions:
            continue

        preferred_name = None
        for key in match_keys(display_name):
            if key in local_names_by_key:
                preferred_name = local_names_by_key[key]
                break

        name = preferred_name or display_name
        dedupe_key = norm_name(name)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        raw_team = row[indexes["team"]]
        price = row[indexes["price"]] if "price" in indexes and len(row) > indexes["price"] else ""
        parsed.append(SourcePlayer(
            name=name,
            source_name=display_name,
            team=team_code(raw_team),
            source_team=clean_text(raw_team).upper(),
            positions=positions,
            price=to_price(price),
        ))

    if not parsed:
        raise RuntimeError("No source players parsed from SuperCoach source")

    return parsed


def source_lookup(source_players: list[SourcePlayer]) -> dict[str, SourcePlayer]:
    lookup: dict[str, SourcePlayer] = {}
    for player in source_players:
        for name in [player.name, player.source_name]:
            for key in match_keys(name):
                lookup.setdefault(key, player)
    return lookup


def local_audit(source_by_key: dict[str, SourcePlayer]) -> tuple[list[dict], list[dict], list[dict]]:
    position_disagreements = []
    team_disagreements = []
    unmatched_local_players = []

    for path in [PLAYERS_PATH, SEED_PATH]:
        data = load_json(path, [])
        for player in extract_players(data):
            name = player_name(player)
            if not name:
                continue

            source = None
            for key in match_keys(name):
                if key in source_by_key:
                    source = source_by_key[key]
                    break

            local_positions = player_positions(player)
            local_team = team_code(player.get("team"))

            if source is None:
                unmatched_local_players.append({
                    "file": path.name,
                    "player": name,
                    "localPositions": local_positions,
                    "localTeam": local_team,
                })
                continue

            if local_positions and set(local_positions) != set(source.positions):
                position_disagreements.append({
                    "file": path.name,
                    "player": name,
                    "sourcePlayer": source.source_name,
                    "localPositions": local_positions,
                    "sourcePositions": source.positions,
                    "action": "source position used in position_master.json",
                })

            if local_team and source.team and local_team != source.team:
                team_disagreements.append({
                    "file": path.name,
                    "player": name,
                    "sourcePlayer": source.source_name,
                    "localTeam": local_team,
                    "sourceTeam": source.team,
                })

    return position_disagreements, team_disagreements, unmatched_local_players


def sorted_players_map(players: dict[str, list[str]]) -> dict[str, list[str]]:
    return dict(sorted(players.items(), key=lambda item: norm_name(item[0])))


def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    local_names = local_name_lookup()
    source_players = parse_source_players(fetch_source_html(), local_names)
    source_by_key = source_lookup(source_players)

    master = {player.name: player.positions for player in source_players}

    overrides_data = load_json(OVERRIDES_PATH, {"players": {}})
    overrides = overrides_data.get("players", {}) if isinstance(overrides_data, dict) else {}

    override_fallbacks_used = []
    ignored_overrides_with_source = []

    for name, raw_positions in overrides.items():
        override_positions = pos_list(raw_positions)
        if not override_positions:
            continue

        source = None
        for key in match_keys(name):
            if key in source_by_key:
                source = source_by_key[key]
                break

        if source is not None:
            if set(override_positions) != set(source.positions):
                ignored_overrides_with_source.append({
                    "player": name,
                    "overridePositions": override_positions,
                    "sourcePlayer": source.source_name,
                    "sourcePositions": source.positions,
                    "action": "source wins; override ignored",
                })
            continue

        master[name] = override_positions
        override_fallbacks_used.append({
            "player": name,
            "positions": override_positions,
            "reason": "not found in imported SuperCoach source",
        })

    position_disagreements, team_disagreements, unmatched_local_players = local_audit(source_by_key)
    master = sorted_players_map(master)

    master_out = {
        "updated": now,
        "source": SOURCE_URL,
        "rule": "Regenerated from imported SuperCoach source data. Manual overrides are fallback-only when a player is missing from the source.",
        "teamCodeNormalization": TEAM_CODE_MAP,
        "sourcePlayerCount": len(source_players),
        "manualFallbackCount": len(override_fallbacks_used),
        "players": master,
    }

    dual_out = {
        "updated": now,
        "source": "generated from source-driven position_master.json",
        "players": master,
    }

    report = {
        "updated": now,
        "source": SOURCE_URL,
        "source_players_imported": len(source_players),
        "position_master_players": len(master),
        "manual_overrides_policy": "fallback-only; source wins when player is present in imported SuperCoach source",
        "manual_override_fallbacks_used": override_fallbacks_used,
        "ignored_overrides_with_source": ignored_overrides_with_source,
        "position_disagreements": position_disagreements,
        "team_disagreements": team_disagreements,
        "unmatched_local_players": unmatched_local_players,
    }

    MASTER_PATH.write_text(json.dumps(master_out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    DUAL_PATH.write_text(json.dumps(dual_out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Fetched source players: {len(source_players)}")
    print(f"Position master players: {len(master)}")
    print(f"Manual override fallbacks used: {len(override_fallbacks_used)}")
    print(f"Source/local position disagreements: {len(position_disagreements)}")
    print(f"Source/local team disagreements: {len(team_disagreements)}")


if __name__ == "__main__":
    main()
