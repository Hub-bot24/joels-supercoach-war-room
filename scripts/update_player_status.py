
from __future__ import annotations

import io
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"
STATUS_JSON = ROOT / "player_status.json"

# Source-driven availability feed.
# nrlsupercoachstats has no native injury table; it links out to the
# zerotackle injuries/suspensions list, which is structured per club
# (Player / Reason / Expected Return). Sources are intentionally a list so
# extra/alternate feeds can be appended or swapped later without code changes.
STATUS_SOURCES: list[dict[str, str]] = [
    {
        "name": "zerotackle-injuries-suspensions",
        "url": "https://www.zerotackle.com/rugby-league/injuries-suspensions/",
        "parser": "zerotackle",
    },
]

USER_AGENT = "JoelSuperCoachWarRoom/2.0 personal-use updater"

# Optional: if SC_CURRENT_ROUND is set, a listed player whose expected return
# round is at/earlier than the current round is downgraded from "out" to
# "risk" (a return chance rather than confirmed out). Off by default so a
# wrong round can never silently mark an injured player available.
CURRENT_ROUND = None
_env_round = os.environ.get("SC_CURRENT_ROUND", "").strip()
if _env_round.isdigit():
    CURRENT_ROUND = int(_env_round)


def clean_name(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def norm_name(value: Any) -> str:
    text = clean_name(value).lower()
    text = re.sub(r"[^a-z\s'-]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_return_round(value: Any) -> int | None:
    m = re.search(r"round\s*(\d+)", str(value or ""), re.I)
    return int(m.group(1)) if m else None


def classify(reason: Any, expected_return: Any) -> tuple[str, int]:
    """Map a source row to (status, playProbability).

    status is one of the vocab understood by index.html availabilityStatus:
    out / suspended (unavailable) or risk (not confirmed available).
    Anyone appearing on an injury/suspension feed is currently sidelined, so
    the safe default is "out"; soft signals downgrade to "risk".
    """
    reason_l = str(reason or "").lower()
    ret_l = str(expected_return or "").lower()

    if "suspen" in reason_l or "suspen" in ret_l or "judiciary" in reason_l:
        return "suspended", 0

    risk_signals = ["test", "late", "1-2", "1 - 2", "week to week", "tba", "game time", "fitness"]
    is_risk = any(sig in ret_l for sig in risk_signals)

    if CURRENT_ROUND is not None:
        rr = parse_return_round(expected_return)
        if rr is not None and rr <= CURRENT_ROUND:
            is_risk = True

    if is_risk:
        return "risk", 50
    return "out", 0


def fetch_html(url: str) -> str:
    headers = {"User-Agent": USER_AGENT}
    res = requests.get(url, headers=headers, timeout=30)
    res.raise_for_status()
    return res.text


def parse_zerotackle(html: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    tables = pd.read_html(io.StringIO(html))
    for df in tables:
        cols = {str(c).strip().lower(): c for c in df.columns}
        name_col = next((cols[c] for c in cols if "player" in c), None)
        reason_col = next((cols[c] for c in cols if "reason" in c or "injury" in c), None)
        ret_col = next((cols[c] for c in cols if "return" in c), None)
        if not name_col:
            continue
        for _, row in df.iterrows():
            name = clean_name(row.get(name_col))
            if not name or name.lower() in {"nan", "player", "players"}:
                continue
            reason = clean_name(row.get(reason_col)) if reason_col else ""
            expected_return = clean_name(row.get(ret_col)) if ret_col else ""
            if reason.lower() == "nan":
                reason = ""
            if expected_return.lower() == "nan":
                expected_return = ""
            rows.append(
                {
                    "name": name,
                    "norm": norm_name(name),
                    "reason": reason,
                    "expectedReturn": expected_return,
                }
            )
    return rows


PARSERS = {"zerotackle": parse_zerotackle}


def collect_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for src in STATUS_SOURCES:
        parser = PARSERS.get(src["parser"])
        if not parser:
            print(f"No parser for source {src['name']}; skipping")
            continue
        try:
            print(f"Fetching {src['url']}")
            html = fetch_html(src["url"])
            parsed = parser(html)
            print(f"  parsed {len(parsed)} rows from {src['name']}")
            rows.extend(parsed)
        except Exception as exc:  # fail soft per source
            print(f"  source {src['name']} unavailable: {type(exc).__name__}: {exc}")
    return rows


def load_player_names() -> dict[str, str]:
    """Map norm_name -> canonical players.json name for matching."""
    if not PLAYERS_JSON.exists():
        return {}
    try:
        data = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, str] = {}
    for p in data.get("players", []):
        name = p.get("name")
        if name:
            out[norm_name(name)] = name
    return out


def build_status(rows: list[dict[str, Any]], names: dict[str, str]) -> dict[str, Any]:
    players: dict[str, Any] = {}
    unmatched: list[str] = []
    now = datetime.now(timezone.utc).isoformat()

    for r in rows:
        key = r["norm"]
        if not key:
            continue
        status, prob = classify(r["reason"], r["expectedReturn"])
        canonical = names.get(key)
        entry = {
            "status": status,
            "playProbability": prob,
            "reason": r["reason"] or status.capitalize(),
            "expectedReturn": r["expectedReturn"],
            "expectedReturnRound": parse_return_round(r["expectedReturn"]),
            "lastUpdated": now,
        }
        if canonical:
            players[canonical] = entry
        else:
            unmatched.append(r["name"])

    return {
        "updated": now,
        "source": "zerotackle injuries-suspensions (nrlsupercoachstats-referenced)",
        "sourceUrls": [s["url"] for s in STATUS_SOURCES],
        "round": CURRENT_ROUND,
        "generated": {
            "rowsFound": len(rows),
            "matched": len(players),
            "unmatched": len(unmatched),
        },
        "players": players,
        "unmatched": sorted(set(unmatched)),
    }


def main() -> None:
    rows = collect_rows()

    if not rows:
        # Fail soft: never wipe a good file or crash the app on a flaky source.
        if STATUS_JSON.exists():
            print("No status rows found; keeping existing player_status.json unchanged.")
            return
        empty = {
            "updated": datetime.now(timezone.utc).isoformat(),
            "source": "no source data available",
            "sourceUrls": [s["url"] for s in STATUS_SOURCES],
            "round": CURRENT_ROUND,
            "generated": {"rowsFound": 0, "matched": 0, "unmatched": 0},
            "players": {},
            "unmatched": [],
        }
        STATUS_JSON.write_text(json.dumps(empty, indent=2, ensure_ascii=False), encoding="utf-8")
        print("No status rows found; wrote empty player_status.json scaffold.")
        return

    names = load_player_names()
    status = build_status(rows, names)
    STATUS_JSON.write_text(json.dumps(status, indent=2, ensure_ascii=False), encoding="utf-8")
    print(
        f"player_status.json updated: {status['generated']['matched']} matched, "
        f"{status['generated']['unmatched']} unmatched of {status['generated']['rowsFound']} rows."
    )


if __name__ == "__main__":
    main()
