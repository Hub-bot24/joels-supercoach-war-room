#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const PLAYERS_FILE = path.join(ROOT, "players.json");

const SOURCE_URL =
  "https://www.nrlsupercoachstats.com/TeamPricesAndBEs.php";

  const sourceConfig = JSON.parse(
  await fs.readFile(path.join(ROOT, "data/source_config.json"), "utf8")
);

const SEASON = sourceConfig.season;

const DPP_URL =
  `https://www.nrlsupercoachstats.com/dualposngrid.php?year=${SEASON}`;

const USER_AGENT =
  "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(
    file,
    JSON.stringify(data, null, 2) + "\n"
  );
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return await response.text();
}

function parseRowsFromHtml(html) {
  const rows = [];

  const matches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const row of matches) {
    const text = row
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) continue;

    const nameMatch = text.match(/^([A-Za-z .'-]+)/);

    if (!nameMatch) continue;

    const name = nameMatch[1].trim();

    const { price, breakeven } = parsePriceBeText(text);

    if (price === null && breakeven === null) continue;

    rows.push({
      name,
      norm: normaliseName(name),
      price,
      breakeven
    });
  }

  return rows;
}

async function fetchDppPlayers() {
  const html = await fetchText(DPP_URL);

  const players = {};

  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const clean = row
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const positions = [];

    for (const pos of [
      "HOK",
      "FRF",
      "2RF",
      "HFB",
      "5/8",
      "CTW",
      "FLB"
    ]) {
      if (clean.includes(pos)) {
        positions.push(pos);
      }
    }

    if (positions.length < 2) continue;

    const nameMatch = clean.match(/^([A-Za-z .'-]+)/);

    if (!nameMatch) continue;

    const name = nameMatch[1].trim();

    players[normaliseName(name)] = {
      name,
      positions
    };
  }

  console.log(`DPP source players: ${Object.keys(players).length}`);

  return players;
}

function normaliseName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function toNumber(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function toMoney(value) {
  const match = String(value ?? "").match(/\$[\d,]+/);
  return match ? Number(match[0].replace(/[$,]/g, "")) : null;
}

function parsePriceBeText(value) {
  const text = String(value || "");

  let price = null;
  let breakeven = null;

  const money = text.match(/\$[\d,]+/);

  if (money) {
    price = Number(money[0].replace(/[$,]/g, ""));
  }

  const numbers = text
    .replace(/,/g, "")
    .match(/\d+(\.\d+)?/g);

  if (numbers?.length) {
    breakeven = Number(numbers[numbers.length - 1]);
  }

  return { price, breakeven };
}




  const numbers = text
    .replace(/,/g, "")
    .match(/\d+(\.\d+)?/g);

  if (numbers?.length) {
    breakeven = Number(numbers[numbers.length - 1]);
  }

  return { price, breakeven };

async function fetchSourceRows() {
  console.log(`Fetching ${SOURCE_URL}`);

  const html = await fetchText(SOURCE_URL);

  const rows = parseRowsFromHtml(html);

  console.log(`Parsed ${rows.length} player rows`);

  return rows;
}
async function mergePlayers(sourceRows, dppPlayers) {
  const existing = await readJson(PLAYERS_FILE, { players: [] });

  const players = existing.players || [];

  const byName = new Map(
    players
      .filter(p => p.name)
      .map(p => [normaliseName(p.name), p])
  );

  let updated = 0;
  let added = 0;

  for (const src of sourceRows) {
    if (!src.norm) continue;

    const player = byName.get(src.norm);

    if (player) {
        const dpp = dppPlayers[normaliseName(player.name)];

if (dpp) {
  player.dualPositions = dpp.positions;
  player.positions = dpp.positions;
  player.eligiblePositions = dpp.positions;
}
      if (src.price !== null) player.price = src.price;
      if (src.breakeven !== null) {
        player.breakeven = src.breakeven;
        player.breakevenStatus = "updated";
      }

      player.dataSource = "nrlsupercoachstats-public";
      player.lastDataUpdate = new Date().toISOString();

      updated++;
      continue;
    }

    const newPlayer = {
      name: src.name,
      sourceName: src.name,
      shortName: src.name,
      pos: "UNKNOWN",
      position: "UNKNOWN",
      positions: [],
      eligiblePositions: [],
      dualPositions: [],
      price: src.price,
      avg: null,
      threeRoundAvg: null,
      breakeven: src.breakeven,
      breakevenStatus: src.breakeven !== null ? "updated" : "needs_data",
      team: null,
      ownership: null,
      dataSource: "nrlsupercoachstats-public",
      lastDataUpdate: new Date().toISOString()
    };

    players.push(newPlayer);
    byName.set(src.norm, newPlayer);
    added++;
  }

  existing.players = players;
  existing.updated = new Date().toISOString();
  existing.dataPipeline = {
    version: "v3-node-price-be",
    source: SOURCE_URL,
    rowsFound: sourceRows.length,
    playersUpdated: updated,
    playersAdded: added
  };

  await writeJson(PLAYERS_FILE, existing);

  console.log(`Players updated: ${updated}`);
  console.log(`Players added: ${added}`);
}
async function main() {
  const rows = await fetchSourceRows();

  const dppPlayers = await fetchDppPlayers();

  if (!rows.length) {
    throw new Error("No usable player rows found");
  }

  await mergePlayers(rows, dppPlayers);

  console.log("Node player updater complete");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});