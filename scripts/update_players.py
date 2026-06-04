
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
PLAYERS_JSON = ROOT / "players.json"
MY_TEAM_JSON = ROOT / "my_team.json"
POSITION_MASTER_JSON = ROOT / "position_master.json"
FIXTURES_JSON = ROOT / "fixtures.json"
REPORT_JSON = ROOT / "players_update_audit_report.json"

SOURCE_URL = "https://nrlsupercoachstats.com/playerlist.php"
USER_AGENT = "Mozilla/5.0 (compatible; JoelSuperCoachWarRoom/3.0)"

VALID_POSITIONS = {"HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB"}
TEAM_CODE_MAP = {
    "BUL": "CAN",
    "GCT": "GLD",
    "MNL": "MAN",
    "PTH": "PEN",
}
DISPLAY_NAME_NORMALISATIONS = {
    "TeMaire Martin": "Te Maire Martin",
}
NAME_ALIASES = {
    "nicho hynes": {"nicholas hynes"},
    "nicholas hynes": {"nicho hynes"},
    "tom duncan": {"tallis duncan"},
    "tallis duncan": {"tom duncan"},
}

ENRICH_FIELDS = [
    "proj",
    "avg",
    "last3Avg",
    "last5Avg",
    "threeRoundAvg",
    "fiveRoundAvg",
    "ownership",
    "ownershipStatus",
    "breakeven",
    "breakevenStatus",
    "captainOwnership",
    "vcOwnership",
    "cPct",
    "vcPct",
    "risk",
    "injuryStatus",
    "expectedReturnRound",
    "playProbability",
    "injuryNote",
    "expectedMinutes",
    "minutes",
    "ppm",
    "roleConfidence",
    "roleNote",
    "highScore",
    "ceiling",
    "projectionSource",
    "level3Ready",
    "level3MissingData",
]


@dataclass(frozen=True)
class SourcePlayer:
    name: str
    source_name: str
    team: str
    source_team: str
    source_positions: list[str]
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


def norm_name(value) -> str:
    text = clean_text(value).lower().replace("’", "'")
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
    out: list[str] = []

    def add(value) -> None:
        if value is None:
            return
        if isinstance(value, list):
            for item in value:
                add(item)
            return

        text = clean_text(value).upper()
        for pos in re.findall(r"(?<![A-Z0-9])(HOK|FRF|2RF|HFB|5/8|CTW|FLB)(?![A-Z0-9])", text):
            if pos in VALID_POSITIONS and pos not in out:
                out.append(pos)

    for value in values:
        add(value)

    return out


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {"players": data} if isinstance(data, list) else data
    except Exception:
        return default


def extract_players(data) -> list[dict]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("players"), list):
        return data["players"]
    return []


def source_display_name(source_name: str) -> str:
    name = clean_text(source_name)
    if "," in name:
        last, first = [clean_text(part) for part in name.split(",", 1)]
        name = f"{first} {last}".strip()
    return DISPLAY_NAME_NORMALISATIONS.get(name, name)


def team_code(value) -> str:
    raw = clean_text(value).upper()
    return TEAM_CODE_MAP.get(raw, raw)


def to_price(value) -> int | None:
    text = re.sub(r"[^0-9]", "", str(value or ""))
    return int(text) if text else None


def fetch_source_html() -> str:
    request = Request(SOURCE_URL, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_source_players(html: str, preferred_names: dict[str, str]) -> tuple[list[SourcePlayer], list[dict]]:
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
        raise RuntimeError("Could not find Name/Team/Posn1/Posn2 table in source")

    players: list[SourcePlayer] = []
    excluded: list[dict] = []
    seen = set()
    required_index = max(indexes["name"], indexes["team"], indexes["posn1"], indexes["posn2"])

    for row in parser.rows[header_index + 1:]:
        if len(row) <= required_index:
            continue

        display_name = source_display_name(row[indexes["name"]])
        positions = pos_list(row[indexes["posn1"]], row[indexes["posn2"]])
        if not display_name:
            continue
        if not positions:
            excluded.append({"player": display_name, "reason": "missing source position"})
            continue

        preferred_name = None
        for key in match_keys(display_name):
            if key in preferred_names:
                preferred_name = preferred_names[key]
                break

        name = preferred_name or display_name
        dedupe_key = norm_name(name)
        if dedupe_key in seen:
            excluded.append({"player": name, "reason": "duplicate after normalization"})
            continue
        seen.add(dedupe_key)

        raw_team = row[indexes["team"]]
        price = row[indexes["price"]] if "price" in indexes and len(row) > indexes["price"] else ""
        players.append(SourcePlayer(
            name=name,
            source_name=display_name,
            team=team_code(raw_team),
            source_team=clean_text(raw_team).upper(),
            source_positions=positions,
            price=to_price(price),
        ))

    if not players:
        raise RuntimeError("No source players parsed from player list")

    return players, excluded


def load_position_master() -> dict[str, tuple[str, list[str]]]:
    data = load_json(POSITION_MASTER_JSON, {"players": {}})
    raw_players = data.get("players", {}) if isinstance(data, dict) else {}
    out: dict[str, tuple[str, list[str]]] = {}
    for name, raw_positions in raw_players.items():
        positions = pos_list(raw_positions)
        if not positions:
            continue
        for key in match_keys(name):
            out.setdefault(key, (name, positions))
    return out


def existing_player_lookup(existing_players: list[dict]) -> dict[str, dict]:
    lookup: dict[str, dict] = {}
    for player in existing_players:
        name = player.get("name")
        if not name:
            continue
        for key in match_keys(name):
            lookup.setdefault(key, player)
    return lookup


def preferred_name_lookup(position_master: dict[str, tuple[str, list[str]]], existing_lookup: dict[str, dict]) -> dict[str, str]:
    preferred: dict[str, str] = {}
    for key, (name, _) in position_master.items():
        preferred.setdefault(key, name)
    for key, player in existing_lookup.items():
        preferred.setdefault(key, player.get("name"))
    return preferred


def player_byes_by_team() -> dict[str, list[int]]:
    fixtures = load_json(FIXTURES_JSON, {})
    byes = fixtures.get("byes", {}) if isinstance(fixtures, dict) else {}
    by_team: dict[str, list[int]] = {}
    for round_raw, teams in byes.items():
        try:
            round_number = int(round_raw)
        except Exception:
            continue
        for team in teams or []:
            by_team.setdefault(team_code(team), []).append(round_number)
    return {team: sorted(rounds) for team, rounds in by_team.items()}


def short_name(name: str) -> str:
    parts = name.split()
    if len(parts) < 2:
        return name
    return f"{parts[0][0]}. {' '.join(parts[1:])}"


def find_existing(source_player: SourcePlayer, existing_lookup: dict[str, dict]) -> dict | None:
    for key in match_keys(source_player.name) | match_keys(source_player.source_name):
        if key in existing_lookup:
            return existing_lookup[key]
    return None


def build_player_record(
    source_player: SourcePlayer,
    positions: list[str],
    existing: dict | None,
    byes_by_team: dict[str, list[int]],
    now: str,
) -> dict:
    record = {
        "name": source_player.name,
        "sourceName": source_player.source_name,
        "shortName": existing.get("shortName") if existing else short_name(source_player.name),
        "pos": "/".join(positions),
        "position": "/".join(positions),
        "positions": positions,
        "eligiblePositions": positions,
        "dualPositions": positions,
        "team": source_player.team,
        "sourceTeam": source_player.source_team,
        "price": source_player.price,
        "proj": 0,
        "avg": None,
        "last3Avg": None,
        "last5Avg": None,
        "threeRoundAvg": None,
        "fiveRoundAvg": None,
        "ownership": None,
        "ownershipStatus": "needs_data",
        "bye": byes_by_team.get(source_player.team, []),
        "breakeven": None,
        "breakevenStatus": "needs_data",
        "cPct": 0,
        "vcPct": 0,
        "captainOwnership": None,
        "vcOwnership": None,
        "risk": 30,
        "injuryStatus": "fit",
        "expectedReturnRound": 1,
        "playProbability": 100,
        "injuryNote": "",
        "dataSource": SOURCE_URL,
        "lastDataUpdate": now,
    }

    if existing:
        for field in ENRICH_FIELDS:
            value = existing.get(field)
            if value not in (None, "", []):
                record[field] = value

        # Keep source-driven identity fields authoritative.
        record["name"] = source_player.name
        record["sourceName"] = source_player.source_name
        record["shortName"] = existing.get("shortName") or record["shortName"]
        record["pos"] = "/".join(positions)
        record["position"] = "/".join(positions)
        record["positions"] = positions
        record["eligiblePositions"] = positions
        record["dualPositions"] = positions
        record["team"] = source_player.team
        record["sourceTeam"] = source_player.source_team
        record["price"] = source_player.price
        record["bye"] = byes_by_team.get(source_player.team, existing.get("bye", []))

    if record.get("proj") in (None, ""):
        record["proj"] = record.get("avg") or 0
    if record.get("breakeven") is not None:
        record["breakevenStatus"] = "updated"

    return record


def missing_optional_fields(players: list[dict]) -> dict[str, int]:
    optional_fields = {
        "avg": "season average",
        "last3Avg": "last 3",
        "last5Avg": "last 5",
        "ownership": "ownership",
        "breakeven": "breakeven",
        "expectedMinutes": "expected minutes",
        "captainOwnership": "captain ownership",
        "vcOwnership": "VC ownership",
    }
    counts = {}
    for field, label in optional_fields.items():
        counts[label] = sum(1 for player in players if player.get(field) in (None, "", []))
    return counts


def my_team_matches(players: list[dict]) -> dict:
    team_data = load_json(MY_TEAM_JSON, {"players": []})
    names = team_data.get("players", []) if isinstance(team_data, dict) else []
    player_keys = set()
    for player in players:
        for key in match_keys(player.get("name")):
            player_keys.add(key)

    matched = []
    missing = []
    for name in names:
        if any(key in player_keys for key in match_keys(name)):
            matched.append(name)
        else:
            missing.append(name)

    return {
        "total": len(names),
        "matched": len(matched),
        "missing": missing,
    }


def main() -> None:
    now = datetime.now(timezone.utc).isoformat()

    existing_data = load_json(PLAYERS_JSON, {"players": []})
    existing_players = extract_players(existing_data)
    existing_lookup = existing_player_lookup(existing_players)
    position_master = load_position_master()
    preferred_names = preferred_name_lookup(position_master, existing_lookup)

    source_players, source_excluded = parse_source_players(fetch_source_html(), preferred_names)
    byes_by_team = player_byes_by_team()

    players = []
    manual_fallbacks_used = []
    position_master_missing = []
    enriched_from_existing = []

    for source_player in source_players:
        master_match = None
        for key in match_keys(source_player.name) | match_keys(source_player.source_name):
            if key in position_master:
                master_match = position_master[key]
                break

        if master_match:
            master_name, positions = master_match
            source_player = SourcePlayer(
                name=master_name,
                source_name=source_player.source_name,
                team=source_player.team,
                source_team=source_player.source_team,
                source_positions=source_player.source_positions,
                price=source_player.price,
            )
        else:
            positions = source_player.source_positions
            position_master_missing.append({
                "player": source_player.name,
                "sourcePositions": source_player.source_positions,
                "action": "used source positions because position_master.json had no match",
            })

        existing = find_existing(source_player, existing_lookup)
        if existing:
            enriched_from_existing.append(source_player.name)

        players.append(build_player_record(source_player, positions, existing, byes_by_team, now))

    players = sorted(players, key=lambda player: norm_name(player["name"]))
    team_match_report = my_team_matches(players)

    out = {
        "updated": now,
        "source": SOURCE_URL,
        "note": "Full source-driven player database. my_team.json remains the selected squad file.",
        "players": players,
        "playerDatabase": {
            "sourcePlayersImported": len(source_players),
            "playersWritten": len(players),
            "sourcePlayersExcluded": len(source_excluded),
            "manualFallbacksUsed": len(manual_fallbacks_used),
            "existingPlayersUsedForEnrichment": len(enriched_from_existing),
            "myTeamMatches": team_match_report["matched"],
            "myTeamTotal": team_match_report["total"],
        },
        "lastAutomationRun": now,
        "automationStatus": "Full source-driven player database generated successfully.",
    }

    report = {
        "updated": now,
        "source": SOURCE_URL,
        "source_players_imported": len(source_players),
        "players_written_to_players_json": len(players),
        "my_team_matches": team_match_report,
        "source_players_excluded": source_excluded,
        "manual_fallbacks_used": manual_fallbacks_used,
        "position_master_missing": position_master_missing,
        "existing_players_used_for_enrichment": sorted(enriched_from_existing, key=norm_name),
        "missing_optional_fields": missing_optional_fields(players),
    }

    PLAYERS_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REPORT_JSON.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Source players imported: {len(source_players)}")
    print(f"Players written to players.json: {len(players)}")
    print(f"my_team matches: {team_match_report['matched']} / {team_match_report['total']}")
    print(f"Source players excluded: {len(source_excluded)}")
    print(f"Manual fallbacks used: {len(manual_fallbacks_used)}")


if __name__ == "__main__":
    main()
