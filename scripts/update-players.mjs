#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
  buildIdentityIndex,
  normaliseIdentityName,
  resolveIdentity
} from "./lib/player-identity.mjs";

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
      norm: normaliseIdentityName(name),
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

    players[normaliseIdentityName(name)] = {
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

  return players;
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
  const identityIndex = buildIdentityIndex(players);

  let updated = 0;
  let dppApplied = 0;
  let dppMatchedExisting = 0;

  const unmatched = [];
  const ambiguous = [];

  for (const dpp of Object.values(dppPlayers)) {
    const resolution = resolveIdentity(
      identityIndex,
      dpp.name
    );

    if (resolution.status === "unmatched") {
      unmatched.push({
        source: "dual-position",
        sourceName: dpp.name,
        reason: "No canonical identity"
      });

      continue;
    }

    if (resolution.status === "ambiguous") {
      ambiguous.push({
        source: "dual-position",
        sourceName: dpp.name,
        candidates: resolution.candidates.map(
          player => player.name
        )
      });

      continue;
    }

    const player = resolution.player;
    const nextPositions = [...new Set(dpp.positions)];

    player.dualPositions = nextPositions;
    player.positions = nextPositions;
    player.eligiblePositions = nextPositions;

    dppMatchedExisting++;

    if (nextPositions.length >= 2) {
      dppApplied++;
    }
  }

  for (const src of sourceRows) {
    if (!src.name) continue;

    const resolution = resolveIdentity(
      identityIndex,
      src.name
    );

    if (resolution.status === "unmatched") {
      unmatched.push({
        source: "price-breakeven",
        sourceName: src.name,
        reason:
          "Enrichment sources cannot create canonical players"
      });

      continue;
    }

    if (resolution.status === "ambiguous") {
      ambiguous.push({
        source: "price-breakeven",
        sourceName: src.name,
        candidates: resolution.candidates.map(
          player => player.name
        )
      });

      continue;
    }

    const player = resolution.player;

    if (src.price !== null) {
      player.price = src.price;
    }

    if (src.breakeven !== null) {
      player.breakeven = src.breakeven;
      player.breakevenStatus = "updated";
    }

    player.enrichmentSources = {
      ...(player.enrichmentSources || {}),
      priceAndBreakeven: {
        source:
          "nrlsupercoachstats-public",
        updatedAt:
          new Date().toISOString()
      }
    };

    player.lastDataUpdate =
      new Date().toISOString();

    updated++;
  }

  if (ambiguous.length > 0) {
    const details = ambiguous
      .map(item =>
        `${item.sourceName}: ${item.candidates.join(" | ")}`
      )
      .join("\n");

    throw new Error(
      "Ambiguous player identities detected:\n" +
      details
    );
  }

  if (
    Object.keys(dppPlayers).length > 0 &&
    dppMatchedExisting === 0
  ) {
    throw new Error(
      `DPP parser found ${
        Object.keys(dppPlayers).length
      } players, but matched 0 canonical identities.`
    );
  }

  if (
    Object.keys(dppPlayers).length > 0 &&
    dppApplied === 0
  ) {
    throw new Error(
      `DPP parser found ${
        Object.keys(dppPlayers).length
      } players, but applied 0 DPP updates.`
    );
  }

  existing.players = players;
  existing.updated = new Date().toISOString();
  existing.dataPipeline = {
    version: "v4-canonical-enrichment-only",
    source: SOURCE_URL,
    rowsFound: sourceRows.length,
    playersUpdated: updated,
    playersAdded: 0,
    unmatchedEnrichmentRows: unmatched.length,
    ambiguousEnrichmentRows: ambiguous.length,
    dppSourcePlayers:
      Object.keys(dppPlayers).length,
    dppMatchedExisting,
    dppApplied
  };

  await writeJson(PLAYERS_FILE, existing);

  console.log(`Players updated: ${updated}`);
  console.log("Players added: 0");
  console.log(
    `Unmatched enrichment rows: ${unmatched.length}`
  );
  console.log(
    `Ambiguous enrichment rows: ${ambiguous.length}`
  );
  console.log(
    `DPP matched existing players: ${dppMatchedExisting}`
  );
  console.log(
    `DPP applied to existing players: ${dppApplied}`
  );
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