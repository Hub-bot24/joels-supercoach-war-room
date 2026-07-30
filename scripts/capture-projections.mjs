#!/usr/bin/env node

/*
  LEVEL 4 - HISTORICAL DATABASE (PROJECTION ACCURACY, STEP 1: CAPTURE)

  Source contract:
  - Reads the real, live ProjectionEngine.project() output by loading the
    actual app in a headless browser (scripts/lib/headless-app.mjs) rather
    than re-implementing the projection formula in Node - so a captured
    projection is always exactly what a user would have seen, never a
    parallel copy that can drift out of sync.
  - Writes one file per round: data/history/projections/round_<N>.json -
    and never overwrites an existing one. The first successful capture for
    a round is the one that counts as "what we predicted", the same way a
    real prediction can't be revised after the fact once results start
    coming in. Run on the same once-per-round cadence as the existing
    price-update capture (update-supercoach-data.yml), which fires early
    in a round's cycle, well before that round's games kick off.
  - Downstream consumer (not built yet): a comparison step that reads this
    file plus the real actual scores captured by capture-player-scores.mjs
    once the round is complete, to compute real projection accuracy.

  This does not invent data. It archives the real number the engine
  produces at the point in time it runs. No player-specific logic. No
  hardcoded teams, players, or rounds.
*/

import fs from "node:fs/promises";
import path from "node:path";

import { openApp } from "./lib/headless-app.mjs";

const ROOT = process.cwd();
const CURRENT_ROUND_FILE = path.join(ROOT, "data", "current_round.json");
const HISTORY_DIR = path.join(ROOT, "data", "history", "projections");

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const currentRoundData = await readJson(CURRENT_ROUND_FILE, null);
  const round = Number(currentRoundData?.round || currentRoundData?.detectedRound || 0);

  if (!round) {
    console.log("No current round detected (data/current_round.json missing or empty) - skipping capture.");
    return;
  }

  const outFile = path.join(HISTORY_DIR, `round_${round}.json`);

  if (await fileExists(outFile)) {
    console.log(`data/history/projections/round_${round}.json already exists - the first capture for this round already happened, skipping.`);
    return;
  }

  const { page, pageErrors, close } = await openApp();

  let result;
  try {
    result = await page.evaluate((round) => {
      const players = App.players.filter(p => p.team && p.name);
      const projections = players.map(p => {
        const pr = ProjectionEngine.project(p, round);
        return {
          name: p.name,
          team: p.team,
          position: ProjectionEngine.playerPosition(p),
          expected: pr.expected,
          floor: pr.floor,
          ceiling: pr.ceiling
        };
      });
      return { projections, playerCount: App.players.length, round: App.round };
    }, round);
  } finally {
    await close();
  }

  if (pageErrors.length) {
    throw new Error(`Live app threw ${pageErrors.length} uncaught error(s) while capturing projections: ${pageErrors.join(" | ")}`);
  }

  if (!result.playerCount || !result.projections.length) {
    console.log("No player data loaded in the live app - skipping write.");
    return;
  }

  await fs.mkdir(HISTORY_DIR, { recursive: true });

  const snapshot = {
    round,
    capturedAt: new Date().toISOString(),
    source: "live ProjectionEngine.project() output, captured via headless browser",
    playerCount: result.projections.length,
    projections: result.projections
  };

  await fs.writeFile(outFile, JSON.stringify(snapshot, null, 2) + "\n");

  console.log(`Captured ${result.projections.length} projections for round ${round} -> ${path.relative(ROOT, outFile)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
