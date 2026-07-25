#!/usr/bin/env node

/*
  LEVEL 4 - HISTORICAL DATABASE (STEP 2: BUILD)

  Source contract:
  - Upstream truth: data/history/positional/round_*.json, written by
    scripts/capture-positional-history.mjs from real players.json/fixtures.json
    snapshots. Never hand-edited.
  - Output: data/positional_matchups_v2.json, consumed by the Level 4
    Positional Matchup Engine (ProjectionEngine.positionalMatchupImpact in
    index.html).

  Method: for every (opponent, position) pair, compare the recent-form
  (last3Avg, falling back to seasonAvg) of players who played that opponent
  at that position against the same round's league-wide baseline for that
  position. A team that lets a position outscore the league norm gets a
  positive (easier-matchup) score; a team that suppresses it gets negative.

  This is an empirical signal from real reported numbers, not a guess - but
  the independent unit of evidence is a ROUND, not a player. In one round,
  only one visiting team's roster ever faces a given opponent, so counting
  those players as several "samples" would really just be counting one
  team's positional depth. A bucket is only published once it has data from
  at least MIN_ROUNDS distinct captured rounds (each round a different
  team's trip through the draw adds one independent read on how that
  opponent defends the position). Buckets below that threshold are omitted
  entirely; the engine falls back to the existing hand-seeded starter model
  for those, and is honest in its reasoning about which source it used.
*/

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const HISTORY_DIR = path.join(ROOT, "data", "history", "positional");
const OUT_FILE = path.join(ROOT, "data", "positional_matchups_v2.json");

const MIN_ROUNDS = 3;
const MIN_SAMPLES = 3;

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

async function main() {
  let files;
  try {
    files = (await fs.readdir(HISTORY_DIR)).filter(f => /^round_\d+\.json$/.test(f));
  } catch {
    files = [];
  }

  if (!files.length) {
    console.log("No captured history yet - nothing to build.");
    return;
  }

  const roundsIncluded = [];
  // byOpponentPosition[opponent][position] = [{round, delta}]
  const byOpponentPosition = new Map();

  for (const file of files) {
    const snapshot = await readJson(path.join(HISTORY_DIR, file), null);
    if (!snapshot?.records?.length) continue;

    roundsIncluded.push(snapshot.round);

    const byPosition = new Map();
    for (const record of snapshot.records) {
      const form = record.last3Avg || record.seasonAvg;
      if (!form) continue;
      if (!byPosition.has(record.position)) byPosition.set(record.position, []);
      byPosition.get(record.position).push({ opponent: record.opponent, form });
    }

    for (const [position, entries] of byPosition.entries()) {
      const baseline = entries.reduce((s, e) => s + e.form, 0) / entries.length;
      if (!baseline) continue;

      for (const entry of entries) {
        const delta = entry.form - baseline;
        const opponent = entry.opponent;

        if (!byOpponentPosition.has(opponent)) byOpponentPosition.set(opponent, new Map());
        const posMap = byOpponentPosition.get(opponent);
        if (!posMap.has(position)) posMap.set(position, []);
        posMap.get(position).push({ round: snapshot.round, delta });
      }
    }
  }

  if (!roundsIncluded.length) {
    console.log("No usable records in captured history - nothing to build.");
    return;
  }

  const teams = {};

  for (const [opponent, posMap] of byOpponentPosition.entries()) {
    const positions = {};
    const allObservations = [];

    for (const [position, observations] of posMap.entries()) {
      allObservations.push(...observations);

      const distinctRounds = new Set(observations.map(o => o.round)).size;
      if (distinctRounds < MIN_ROUNDS || observations.length < MIN_SAMPLES) continue;

      const avgDelta = observations.reduce((s, o) => s + o.delta, 0) / observations.length;
      positions[position] = { score: round1(avgDelta), samples: observations.length, rounds: distinctRounds };
    }

    const distinctRoundsOverall = new Set(allObservations.map(o => o.round)).size;
    if (distinctRoundsOverall >= MIN_ROUNDS && allObservations.length >= MIN_SAMPLES) {
      const avgDelta = allObservations.reduce((s, o) => s + o.delta, 0) / allObservations.length;
      positions.overall = { score: round1(avgDelta), samples: allObservations.length, rounds: distinctRoundsOverall };
    }

    if (Object.keys(positions).length) teams[opponent] = positions;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    methodology:
      "Empirical - built from real captured round history (data/history/positional). " +
      "Score is the average gap between a position's recent form when facing this opponent " +
      "and that round's league-wide baseline for the position. Positive = opponent concedes " +
      "above baseline at this position (favourable matchup). Only published once a team/position " +
      "has at least " + MIN_SAMPLES + " independent observations.",
    minSamples: MIN_SAMPLES,
    minRounds: MIN_ROUNDS,
    roundsIncluded: [...new Set(roundsIncluded)].sort((a, b) => a - b),
    teams
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(output, null, 2) + "\n");

  const teamCount = Object.keys(teams).length;
  console.log(`Built positional matchups from ${roundsIncluded.length} round(s) -> ${teamCount} teams with sufficient samples -> ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
