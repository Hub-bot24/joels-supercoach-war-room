#!/usr/bin/env node

/*
  LEVEL 4 - HISTORICAL DATABASE (STEP 1: CAPTURE)

  Source contract:
  - Upstream truth: players.json (already updated by update-players.mjs from
    nrlsupercoachstats.com) and fixtures.json (already updated by
    update-fixtures.mjs).
  - This script writes one file per round: data/history/positional/round_<N>.json
  - Downstream consumer: scripts/build-positional-matchups.mjs, which turns
    accumulated rounds into data/positional_matchups_v2.json for the Level 4
    Positional Matchup Engine in index.html.

  This does not invent scores. It archives the real numbers the app already
  has (season avg, last3, last5, minutes) at the point in time it runs,
  tagged with that round's real fixture context (opponent, home/away). Run
  daily (piggybacking on the existing update-supercoach-data.yml workflow),
  each day's run overwrites the current round's file with the latest known
  values, so the snapshot committed just before Tuesday's rollover holds
  that round's most complete data.

  No player-specific logic. No hardcoded teams, players, or rounds.
*/

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const PLAYERS_FILE = path.join(ROOT, "players.json");
const FIXTURES_FILE = path.join(ROOT, "fixtures.json");
const CURRENT_ROUND_FILE = path.join(ROOT, "data", "current_round.json");
const HISTORY_DIR = path.join(ROOT, "data", "history", "positional");

const VALID_POSITIONS = new Set(["HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB"]);

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function primaryPosition(player) {
  const raw = Array.isArray(player.positions) && player.positions.length
    ? player.positions[0]
    : String(player.pos || player.position || "").split("/")[0];

  const pos = String(raw || "").trim().toUpperCase();
  return VALID_POSITIONS.has(pos) ? pos : null;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const playersData = await readJson(PLAYERS_FILE, { players: [] });
  const players = playersData.players || [];

  const fixturesData = await readJson(FIXTURES_FILE, { fixtures: [] });
  const fixtures = Array.isArray(fixturesData.fixtures) ? fixturesData.fixtures : [];

  const currentRoundData = await readJson(CURRENT_ROUND_FILE, null);
  const round = Number(currentRoundData?.round || currentRoundData?.detectedRound || 0);

  if (!round) {
    console.log("No current round detected (data/current_round.json missing or empty) - skipping capture.");
    return;
  }

  const roundFixtures = fixtures.filter(f => Number(f.round) === round);

  if (!roundFixtures.length) {
    console.log(`No fixtures found for round ${round} - skipping capture.`);
    return;
  }

  const fixtureByTeam = new Map();
  for (const fixture of roundFixtures) {
    const home = String(fixture.homeTeam || "").toUpperCase();
    const away = String(fixture.awayTeam || "").toUpperCase();
    if (home) fixtureByTeam.set(home, { opponent: away, homeAway: "home" });
    if (away) fixtureByTeam.set(away, { opponent: home, homeAway: "away" });
  }

  const records = [];

  for (const player of players) {
    const team = String(player.team || "").toUpperCase();
    const position = primaryPosition(player);
    const fixtureInfo = fixtureByTeam.get(team);

    if (!team || !position || !fixtureInfo) continue;

    const seasonAvg = num(player.avg);
    const last3Avg = num(player.last3Avg);
    const last5Avg = num(player.last5Avg);

    // Reserve-grade/non-contributing players (never actually scored) would
    // just dilute the signal with zeros - only archive players with a real
    // positive scoring record, same "has this player actually produced"
    // bar the Level 3 engine already uses.
    const hasRealForm = (seasonAvg ?? 0) > 0 || (last3Avg ?? 0) > 0 || (last5Avg ?? 0) > 0;
    if (!hasRealForm) continue;

    records.push({
      team,
      position,
      opponent: fixtureInfo.opponent,
      homeAway: fixtureInfo.homeAway,
      seasonAvg,
      last3Avg,
      last5Avg,
      minutes: num(player.minutes ?? player.expectedMinutes)
    });
  }

  if (!records.length) {
    console.log(`No matchable player records for round ${round} - skipping write.`);
    return;
  }

  await fs.mkdir(HISTORY_DIR, { recursive: true });

  const outFile = path.join(HISTORY_DIR, `round_${round}.json`);
  const snapshot = {
    round,
    capturedAt: new Date().toISOString(),
    source: "players.json + fixtures.json snapshot (nrlsupercoachstats.com upstream)",
    recordCount: records.length,
    records
  };

  await fs.writeFile(outFile, JSON.stringify(snapshot, null, 2) + "\n");

  console.log(`Captured ${records.length} positional records for round ${round} -> ${path.relative(ROOT, outFile)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
