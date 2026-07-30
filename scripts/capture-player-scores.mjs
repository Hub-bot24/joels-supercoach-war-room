#!/usr/bin/env node

/*
  LEVEL 4 - HISTORICAL DATABASE (REAL PER-ROUND SCORES)

  Source contract:
  - https://www.nrlsupercoachstats.com/highcharts/data-scoresbyrd.php -
    the same public JSON endpoint the site's own "Points by Round" chart
    calls (found via the page's own <script> block). Verified reachable,
    permitted by the site's own robots.txt (no Disallow rules at all), and
    cross-checked against players.json's own season average for a known
    player before being trusted.
  - Requires the player's name in the site's own "Surname, Given" format,
    not "Given Surname" - reuses appNameToSourceName from
    update-players.mjs rather than duplicating that conversion.
  - Returns every season the site has (2021 onward) in one response per
    player, so one request captures the full history, not just the
    current round.

  This does not invent scores. It archives the real numbers the source
  itself returns, one file per season: data/history/scores/<year>.json.
  Run daily (piggybacking on the existing update-supercoach-data.yml
  workflow, same gate as capture-positional-history.mjs), so a season's
  file only ever grows more complete as real rounds are played.

  No player-specific logic. No hardcoded teams, players, or rounds.
*/

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { appNameToSourceName } from "./update-players.mjs";

const ROOT = process.cwd();
const PLAYERS_FILE = path.join(ROOT, "players.json");
const HISTORY_DIR = path.join(ROOT, "data", "history", "scores");

const USER_AGENT = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";

function scoresByRoundUrl(sourceName, year) {
  const url = new URL("https://www.nrlsupercoachstats.com/highcharts/data-scoresbyrd.php");
  url.searchParams.set("dropdown1", sourceName);
  url.searchParams.set("YEAR", String(year));
  return url.href;
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The response is an array: [{name:"Round",data:[1,2,...]}, {name:2021,data:[...]}, ...].
// Turns that into {year: {round: score}} for every real (non-zero) round -
// a 0 here is indistinguishable from "didn't play" (bye/injury/unavailable),
// so recording it as a real score would be a fabrication the app can't
// justify, not a genuine data point.
function parseScoresByRound(json) {
  if (!Array.isArray(json) || !json.length) return null;

  const roundsEntry = json.find(entry => entry?.name === "Round");
  const rounds = Array.isArray(roundsEntry?.data) ? roundsEntry.data : null;
  if (!rounds) return null;

  const byYear = {};

  for (const entry of json) {
    const year = Number(entry?.name);
    if (!Number.isFinite(year) || !Array.isArray(entry.data)) continue;

    const roundScores = {};
    entry.data.forEach((score, i) => {
      const round = rounds[i];
      const value = Number(score);
      if (Number.isFinite(round) && Number.isFinite(value) && value > 0) {
        roundScores[round] = value;
      }
    });

    if (Object.keys(roundScores).length) byYear[year] = roundScores;
  }

  return Object.keys(byYear).length ? byYear : null;
}

async function fetchPlayerScoresByRound(sourceName, year) {
  const url = scoresByRoundUrl(sourceName, year);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const json = await res.json();
  return parseScoresByRound(json);
}

async function main() {
  const playersData = await readJson(PLAYERS_FILE, { players: [] });
  const players = Array.isArray(playersData.players) ? playersData.players : [];

  const byYear = new Map();
  let failures = 0;

  for (const player of players) {
    if (!player.name) continue;

    const sourceName = appNameToSourceName(player.name);

    try {
      // Any single year's response carries every season the site has -
      // one request per player is enough to seed the whole history.
      const seasons = await fetchPlayerScoresByRound(sourceName, new Date().getFullYear());

      if (seasons) {
        for (const [year, roundScores] of Object.entries(seasons)) {
          if (!byYear.has(year)) byYear.set(year, {});
          byYear.get(year)[player.name] = roundScores;
        }
      }
    } catch (err) {
      failures++;
      console.log(`[player-scores] ${player.name} failed: ${err.message}`);
    }

    await sleep(150);
  }

  if (!byYear.size) {
    console.log("No player scores captured - skipping write.");
    return;
  }

  await fs.mkdir(HISTORY_DIR, { recursive: true });

  for (const [year, playerScores] of byYear) {
    const outFile = path.join(HISTORY_DIR, `${year}.json`);
    const snapshot = {
      season: Number(year),
      updated: new Date().toISOString(),
      source: "nrlsupercoachstats.com highcharts/data-scoresbyrd.php (public JSON, real per-round SuperCoach score)",
      playerCount: Object.keys(playerScores).length,
      players: playerScores
    };
    await fs.writeFile(outFile, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`Captured ${snapshot.playerCount} players' scores for ${year} -> ${path.relative(ROOT, outFile)}`);
  }

  if (failures) console.log(`[player-scores] ${failures} player(s) failed to fetch.`);
}

export { parseScoresByRound };

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
