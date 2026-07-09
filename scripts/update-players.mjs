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
  const validPositions = new Set(["HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB"]);

  function stripTags(value) {
    return String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sourceNameToAppName(value) {
    const clean = stripTags(value);

    if (clean.includes(",")) {
      const [surname, given] = clean.split(",").map(part => part.trim()).filter(Boolean);
      if (surname && given) return `${given} ${surname}`;
    }

    return clean;
  }

  function addDppPlayer(rawName, positions) {
    const name = sourceNameToAppName(rawName);
    const cleanPositions = [...new Set(positions)].filter(pos => validPositions.has(pos));

    if (!name || cleanPositions.length < 2) return;

    players[normaliseName(name)] = {
      name,
      positions: cleanPositions
    };
  }

  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  let columnHeaders = [];

  for (const row of rows) {
    const ths = [...row.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(match => stripTags(match[1]))
      .filter(Boolean)
      .filter(value => validPositions.has(value));

    if (ths.length) {
      columnHeaders = ths;
      continue;
    }

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(match => match[1]);

    if (cells.length < 2 || !columnHeaders.length) continue;

    const rowPosition = stripTags(cells[0]);

    if (!validPositions.has(rowPosition)) continue;

    for (let index = 1; index < cells.length; index++) {
      const columnPosition = columnHeaders[index - 1];

      if (!validPositions.has(columnPosition)) continue;
      if (columnPosition === rowPosition) continue;

      const names = [...cells[index].matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)]
        .map(match => stripTags(match[1]))
        .filter(Boolean);

      for (const rawName of names) {
        addDppPlayer(rawName, [rowPosition, columnPosition]);
      }
    }
  }

  console.log(`DPP source players: ${Object.keys(players).length}`);

  for (const checkName of ["Fletcher Sharpe", "Tallis Duncan", "Jayden Campbell"]) {
    const dpp = players[normaliseName(checkName)];
    console.log(`[DPP check] ${checkName}: ${dpp ? dpp.positions.join("/") : "missing"}`);
  }

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
let dppApplied = 0;
let dppMatchedExisting = 0;

  for (const src of sourceRows) {
    if (!src.norm) continue;

    const player = byName.get(src.norm);

    if (player) {
        const dpp = dppPlayers[normaliseName(player.name)];

if (dpp) {
  dppMatchedExisting++;

  const nextPositions = [...new Set(dpp.positions)];

  player.dualPositions = nextPositions;
  player.positions = nextPositions;
  player.eligiblePositions = nextPositions;

  if (nextPositions.length >= 2) {
    dppApplied++;
  }
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
    playersAdded: added,
    dppSourcePlayers: Object.keys(dppPlayers).length,
    dppMatchedExisting,
    dppApplied
  };

  console.log(`DPP source players available to merge: ${Object.keys(dppPlayers).length}`);
  console.log(`DPP matched existing players: ${dppMatchedExisting}`);
  console.log(`DPP applied to existing players: ${dppApplied}`);

  if (Object.keys(dppPlayers).length > 0 && dppApplied === 0) {
    throw new Error(
      `DPP parser found ${Object.keys(dppPlayers).length} players, but merge applied 0. Refusing to write stale DPP data.`
    );
  }

  await writeJson(PLAYERS_FILE, existing);

  console.log(`Players updated: ${updated}`);
  console.log(`Players added: ${added}`);
}

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