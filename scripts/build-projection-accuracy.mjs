#!/usr/bin/env node

/*
  LEVEL 4 - HISTORICAL DATABASE (PROJECTION ACCURACY, STEP 2: BUILD)

  Source contract:
  - Upstream truth: data/history/projections/round_*.json (written by
    scripts/capture-projections.mjs from the live app's own
    ProjectionEngine.project() output) and data/history/scores/<season>.json
    (written by scripts/capture-player-scores.mjs from real, verified
    per-round SuperCoach scores). Never hand-edited.
  - Output: data/projection_accuracy.json, the real "how right were we"
    record - not consumed by the app yet, but the foundation for it.

  Method: for every round we have BOTH a captured projection and a real
  completed score for a player, record the gap (actual - expected). A
  positive average means the engine has been underestimating that group;
  negative means it's been overestimating. This can only ever measure
  what's actually happened - a player whose round hasn't been played yet
  (or a round with no captured projection) simply isn't counted, not
  treated as a zero-error match.

  A metric (overall or per-position) is only published once it has at
  least MIN_SAMPLES real comparisons behind it - same "don't report a
  number you can't yet trust" bar used by build-positional-matchups.mjs
  for its own cold-start problem.
*/

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const PROJECTIONS_DIR = path.join(ROOT, "data", "history", "projections");
const SCORES_DIR = path.join(ROOT, "data", "history", "scores");
const OUT_FILE = path.join(ROOT, "data", "projection_accuracy.json");

const MIN_SAMPLES_OVERALL = 20;
const MIN_SAMPLES_POSITION = 5;

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

// Pure so it can be unit-tested without touching the filesystem.
// projectionFiles: array of {round, projections:[{name,position,expected}]}
// scoresBySeason: {season: {players: {name: {round: score}}}}
function computeAccuracy(projectionFiles, scoresBySeason, season) {
  const seasonScores = scoresBySeason[season]?.players || {};
  const comparisons = [];

  for (const file of projectionFiles) {
    const round = file.round;
    for (const p of file.projections || []) {
      const actual = seasonScores[p.name]?.[String(round)];
      if (!Number.isFinite(actual)) continue;
      if (!Number.isFinite(p.expected)) continue;

      comparisons.push({
        round,
        position: p.position,
        expected: p.expected,
        actual,
        error: actual - p.expected,
        absError: Math.abs(actual - p.expected)
      });
    }
  }

  function summarize(rows) {
    if (rows.length < 1) return null;
    const meanAbsoluteError = rows.reduce((s, r) => s + r.absError, 0) / rows.length;
    const meanBias = rows.reduce((s, r) => s + r.error, 0) / rows.length;
    return { samples: rows.length, meanAbsoluteError: round1(meanAbsoluteError), meanBias: round1(meanBias) };
  }

  const overallSummary = comparisons.length >= MIN_SAMPLES_OVERALL ? summarize(comparisons) : null;

  const byPositionRows = new Map();
  for (const c of comparisons) {
    if (!c.position) continue;
    if (!byPositionRows.has(c.position)) byPositionRows.set(c.position, []);
    byPositionRows.get(c.position).push(c);
  }

  const byPosition = {};
  for (const [position, rows] of byPositionRows) {
    if (rows.length < MIN_SAMPLES_POSITION) continue;
    byPosition[position] = summarize(rows);
  }

  return {
    totalComparisons: comparisons.length,
    roundsCompared: [...new Set(comparisons.map(c => c.round))].sort((a, b) => a - b),
    overall: overallSummary,
    byPosition
  };
}

async function main() {
  const sourceConfig = await readJson(path.join(ROOT, "data", "source_config.json"), {});
  const season = sourceConfig.season;

  if (!season) {
    console.log("No season configured (data/source_config.json) - skipping build.");
    return;
  }

  let projectionFileNames;
  try {
    projectionFileNames = (await fs.readdir(PROJECTIONS_DIR)).filter(f => /^round_\d+\.json$/.test(f));
  } catch {
    projectionFileNames = [];
  }

  if (!projectionFileNames.length) {
    console.log("No captured projections yet - nothing to build.");
    return;
  }

  const projectionFiles = [];
  for (const name of projectionFileNames) {
    const snapshot = await readJson(path.join(PROJECTIONS_DIR, name), null);
    if (snapshot?.round && Array.isArray(snapshot.projections)) projectionFiles.push(snapshot);
  }

  let scoreFileNames;
  try {
    scoreFileNames = (await fs.readdir(SCORES_DIR)).filter(f => /^\d+\.json$/.test(f));
  } catch {
    scoreFileNames = [];
  }

  const scoresBySeason = {};
  for (const name of scoreFileNames) {
    const snapshot = await readJson(path.join(SCORES_DIR, name), null);
    if (snapshot?.season && snapshot.players) scoresBySeason[snapshot.season] = snapshot;
  }

  const result = computeAccuracy(projectionFiles, scoresBySeason, season);

  const output = {
    generatedAt: new Date().toISOString(),
    season,
    methodology:
      "Real, not simulated - built by comparing captured ProjectionEngine.project() output " +
      "against real per-round SuperCoach scores once a round is actually played. Positive bias " +
      "means the engine has been underestimating; negative means overestimating. Only published " +
      "once at least " + MIN_SAMPLES_OVERALL + " overall (or " + MIN_SAMPLES_POSITION + " per position) " +
      "real comparisons exist.",
    minSamplesOverall: MIN_SAMPLES_OVERALL,
    minSamplesPosition: MIN_SAMPLES_POSITION,
    ...result
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(output, null, 2) + "\n");

  console.log(
    `Built projection accuracy from ${result.totalComparisons} real comparison(s) across ${result.roundsCompared.length} round(s) ` +
    `-> ${output.overall ? "overall metric published" : "not enough data yet for an overall metric"} -> ${path.relative(ROOT, OUT_FILE)}`
  );
}

export { computeAccuracy };

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
