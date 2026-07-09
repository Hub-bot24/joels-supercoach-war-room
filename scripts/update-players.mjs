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

  const validPositions = [
    "HOK",
    "FRF",
    "2RF",
    "HFB",
    "5/8",
    "CTW",
    "FLB"
  ];

  const players = {};

  function decodeHtml(value) {
    return String(value || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&rsquo;/gi, "'")
      .replace(/&lsquo;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  function addPlayerPosition(name, position) {
    if (!name || !validPositions.includes(position)) return;

    const key = normaliseName(name);

    if (!key) return;

    if (!players[key]) {
      players[key] = {
        name,
        positions: []
      };
    }

    if (!players[key].positions.includes(position)) {
      players[key].positions.push(position);
    }
  }

  function parseDppName(value) {
    let text = decodeHtml(value)
      .replace(/\$[\d,]+/g, " ")
      .replace(/\b-?\d+(\.\d+)?\b/g, " ")
      .replace(/\b(HOK|FRF|2RF|HFB|CTW|FLB)\b/g, " ")
      .replace(/5\/8/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) return null;

    if (/^(player|name|team|club|position|dual|dpp)$/i.test(text)) {
      return null;
    }

    const commaName = text.match(/^([A-Za-z.' -]+),\s*([A-Za-z.' -]+)$/);

    if (commaName) {
      text = `${commaName[2].trim()} ${commaName[1].trim()}`;
    }

    const nameMatch = text.match(/^([A-Za-z][A-Za-z.' -]*[A-Za-z])$/);

    if (!nameMatch) return null;

    const name = nameMatch[1].replace(/\s+/g, " ").trim();

    if (name.split(" ").length < 2) return null;

    return name;
  }

  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const clean = decodeHtml(
      row
        .replace(/<[^>]+>/g, " ")
    );

    const rowPositions = [];

    for (const pos of validPositions) {
      if (clean.includes(pos)) {
        rowPositions.push(pos);
      }
    }

    if (rowPositions.length >= 2) {
      const name = parseDppName(clean);

      if (!name) continue;

      for (const pos of rowPositions) {
        addPlayerPosition(name, pos);
      }
    }
  }

  const cells = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th|li|p|div|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map(decodeHtml)
    .filter(Boolean);

  let currentPosition = null;

  for (const cell of cells) {
    const positionHeader = validPositions.find((pos) => cell === pos);

    if (positionHeader) {
      currentPosition = positionHeader;
      continue;
    }

    if (!currentPosition) continue;

    const name = parseDppName(cell);

    if (!name) continue;

    addPlayerPosition(name, currentPosition);
  }

  for (const key of Object.keys(players)) {
    if (players[key].positions.length < 1) {
      delete players[key];
    }
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
  const mergedPositions = [];

  for (const pos of [
    ...(Array.isArray(player.positions) ? player.positions : []),
    ...(Array.isArray(player.eligiblePositions) ? player.eligiblePositions : []),
    ...(Array.isArray(player.dualPositions) ? player.dualPositions : []),
    player.position,
    player.pos,
    ...dpp.positions
  ]) {
    if (!pos) continue;

    if (!mergedPositions.includes(pos)) {
      mergedPositions.push(pos);
    }
  }

  player.dualPositions = mergedPositions;
  player.positions = mergedPositions;
  player.eligiblePositions = mergedPositions;
  player.position = mergedPositions[0];
  player.pos = mergedPositions[0];
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