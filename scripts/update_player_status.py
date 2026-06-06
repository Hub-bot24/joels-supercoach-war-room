
from __future__ import annotations

import html as ihtml
import io
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_JSON = ROOT / "players.json"
STATUS_JSON = ROOT / "player_status.json"

# Source-driven availability feeds.
# Sources are intentionally a list so extra/alternate feeds can be appended or
# swapped later without code changes. Each source has a confidence level:
#   high   = official/authoritative (NRL Casualty Ward)
#   medium = third-party aggregator (zerotackle)
STATUS_SOURCES: list[dict[str, Any]] = [
    {
        "name": "nrl-casualty-ward",
        "url": "https://www.nrl.com/casualty-ward/",
        "parser": "nrl_casualty",
        "confidence": "high",
    },
    {
        "name": "zerotackle-injuries-suspensions",
        "url": "https://www.zerotackle.com/rugby-league/injuries-suspensions/",
        "parser": "zerotackle",
        "confidence": "medium",
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

CONFIDENCE_RANK = {"high": 3, "medium": 2, "low": 1}


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


# --- Parsers ---


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


def parse_nrl_casualty(html: str) -> list[dict[str, Any]]:
    """Parse the Official NRL Casualty Ward embedded q-data JSON."""
    rows: list[dict[str, Any]] = []
    # The casualty data is embedded in a q-data attribute as HTML-escaped JSON
    blobs = re.findall(r'q-data="([^"]+)"', html)
    data = None
    for blob in blobs:
        if "casualties" in blob:
            raw = ihtml.unescape(blob)
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                continue
            break
    if not data:
        # Fallback: try BeautifulSoup for q-data attributes
        soup = BeautifulSoup(html, "lxml")
        for el in soup.find_all(attrs={"q-data": True}):
            qd = el.get("q-data", "")
            if "casualties" in qd:
                try:
                    data = json.loads(qd)
                except (json.JSONDecodeError, ValueError):
                    continue
                break
    if not data or "casualties" not in data:
        return rows
    for c in data["casualties"]:
        first = clean_name(c.get("firstName"))
        last = clean_name(c.get("lastName"))
        if not first and not last:
            continue
        name = f"{first} {last}".strip()
        reason = clean_name(c.get("injury"))
        expected_return = clean_name(c.get("expectedReturn"))
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


PARSERS = {"zerotackle": parse_zerotackle, "nrl_casualty": parse_nrl_casualty}


# --- Collection ---


def collect_rows() -> list[dict[str, Any]]:
    """Fetch all sources and return tagged rows."""
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
            # Tag each row with source provenance
            for r in parsed:
                r["source"] = src["name"]
                r["confidence"] = src.get("confidence", "medium")
            rows.extend(parsed)
        except Exception as exc:  # fail soft per source
            print(f"  source {src['name']} unavailable: {type(exc).__name__}: {exc}")
    return rows


# --- Merge logic ---


def merge_rows(rows: list[dict[str, Any]], names: dict[str, str]) -> dict[str, Any]:
    """Merge rows from multiple sources per player with confidence/disagreement rules.

    Rules:
    - Both agree → keep status, sourceConfidence = high
    - One says out/suspended, other silent → keep out (silence != cleared), confidence = source weight
    - Direct conflict (one out vs one available) → risk, confidence = low, audit trail
    - Official NRL outranks zerotackle on tie
    - Suspensions: any source → suspended
    """
    now = datetime.now(timezone.utc).isoformat()

    # Group by norm key
    grouped: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        key = r["norm"]
        if not key:
            continue
        grouped.setdefault(key, []).append(r)

    players: dict[str, Any] = {}
    unmatched: list[str] = []

    for norm_key, entries in grouped.items():
        canonical = names.get(norm_key)

        # Classify each source's entry
        source_results: list[dict[str, Any]] = []
        for e in entries:
            status, prob = classify(e["reason"], e["expectedReturn"])
            source_results.append(
                {
                    "source": e.get("source", "unknown"),
                    "confidence": e.get("confidence", "medium"),
                    "status": status,
                    "playProbability": prob,
                    "reason": e["reason"] or status.capitalize(),
                    "expectedReturn": e["expectedReturn"],
                }
            )

        # Determine merged status via confidence-weighted rules
        merged_status, merged_prob, merged_confidence, merged_reason = _resolve_sources(source_results)

        entry = {
            "status": merged_status,
            "playProbability": merged_prob,
            "reason": merged_reason,
            "expectedReturn": source_results[0]["expectedReturn"],
            "expectedReturnRound": parse_return_round(source_results[0]["expectedReturn"]),
            "sourceConfidence": merged_confidence,
            "sources": source_results,
            "lastUpdated": now,
        }

        if canonical:
            players[canonical] = entry
        else:
            unmatched.append(entries[0]["name"])

    return {
        "updated": now,
        "source": "multi-source (NRL Casualty Ward + zerotackle)",
        "sourceUrls": [s["url"] for s in STATUS_SOURCES],
        "round": CURRENT_ROUND,
        "sources": [
            {"name": s["name"], "url": s["url"], "confidence": s.get("confidence", "medium")}
            for s in STATUS_SOURCES
        ],
        "generated": {
            "rowsFound": len(rows),
            "matched": len(players),
            "unmatched": len(unmatched),
        },
        "players": players,
        "unmatched": sorted(set(unmatched)),
    }


def _resolve_sources(results: list[dict[str, Any]]) -> tuple[str, int, str, str]:
    """Resolve multiple source entries into a single (status, prob, confidence, reason).

    Safety-first: unavailable signals are never overridden by silence or weaker data.
    """
    if len(results) == 1:
        r = results[0]
        return r["status"], r["playProbability"], r["confidence"], r["reason"]

    # Sort by confidence rank (highest first)
    ranked = sorted(results, key=lambda x: CONFIDENCE_RANK.get(x["confidence"], 1), reverse=True)

    statuses = {r["status"] for r in results}
    unavailable = {"out", "suspended"}
    risk_set = {"risk"}

    # All agree
    if len(statuses) == 1:
        best = ranked[0]
        return best["status"], best["playProbability"], "high", best["reason"]

    # Any source says suspended → suspended (rarely disputed)
    if "suspended" in statuses:
        susp = next(r for r in ranked if r["status"] == "suspended")
        return "suspended", 0, ranked[0]["confidence"], susp["reason"]

    # Sources disagree: one out, one risk → keep out from higher-confidence source
    if statuses == {"out", "risk"}:
        out_src = next(r for r in ranked if r["status"] == "out")
        return "out", 0, out_src["confidence"], out_src["reason"]

    # Direct conflict: out/unavailable vs something unexpected → risk, low confidence
    if statuses & unavailable and statuses - unavailable - risk_set:
        best_out = next(r for r in ranked if r["status"] in unavailable)
        return "risk", 25, "low", f"{best_out['reason']} (sources disagree)"

    # Default: take highest-confidence source
    best = ranked[0]
    return best["status"], best["playProbability"], best["confidence"], best["reason"]


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
            "sources": [
                {"name": s["name"], "url": s["url"], "confidence": s.get("confidence", "medium")}
                for s in STATUS_SOURCES
            ],
            "generated": {"rowsFound": 0, "matched": 0, "unmatched": 0},
            "players": {},
            "unmatched": [],
        }
        STATUS_JSON.write_text(json.dumps(empty, indent=2, ensure_ascii=False), encoding="utf-8")
        print("No status rows found; wrote empty player_status.json scaffold.")
        return

    names = load_player_names()
    status = merge_rows(rows, names)
    STATUS_JSON.write_text(json.dumps(status, indent=2, ensure_ascii=False), encoding="utf-8")
    print(
        f"player_status.json updated: {status['generated']['matched']} matched, "
        f"{status['generated']['unmatched']} unmatched of {status['generated']['rowsFound']} rows."
    )


if __name__ == "__main__":
    main()
