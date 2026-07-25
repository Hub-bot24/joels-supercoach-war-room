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

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Source rows are name is formatted "Surname, Given"; canonical identities
// expect "Given Surname". Shared by every source parser so there is one
// place that owns this conversion, not a copy per source.
function sourceNameToAppName(value) {
  const clean = stripTags(value);

  if (clean.includes(",")) {
    const [surname, given] = clean.split(",").map(part => part.trim()).filter(Boolean);
    if (surname && given) return `${given} ${surname}`;
  }

  return clean;
}

const DEBUG_DIR = path.join(ROOT, "debug");

// TEST ONLY: captures the raw source response so a parse failure (e.g. a
// source site changing its HTML) can be diagnosed from the workflow logs
// and artifact instead of guessing. Never read by app logic.
async function saveDebugSnapshot(label, response, text) {
  await fs.mkdir(DEBUG_DIR, { recursive: true });

  const snapshotPath = path.join(DEBUG_DIR, `${label}.html`);
  await fs.writeFile(snapshotPath, text);

  console.log(
    `[debug] ${label}: status=${response.status} ` +
    `bytes=${text.length} url=${response.url}`
  );
  console.log(
    `[debug] ${label} snippet: ${text.slice(0, 300).replace(/\s+/g, " ")}`
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const FETCH_RETRY_DELAYS_MS = [2000, 5000, 10000];

async function fetchOnce(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT
    }
  });

  const text = await response.text();

  return { response, text };
}

// Retries transient network/server failures (timeouts, 5xx, connection
// resets) so a single flaky request doesn't fail the whole daily run.
// Does not retry 4xx - a bad URL or blocked request won't fix itself.
async function fetchText(url, debugLabel) {
  let lastError;

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    let response;
    let text;

    try {
      ({ response, text } = await fetchOnce(url));
    } catch (err) {
      lastError = err;
      console.log(`[fetch] ${url} attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < FETCH_RETRY_DELAYS_MS.length) {
        await sleep(FETCH_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw lastError;
    }

    if (debugLabel) {
      await saveDebugSnapshot(debugLabel, response, text);
    }

    if (response.status >= 500 && attempt < FETCH_RETRY_DELAYS_MS.length) {
      console.log(`[fetch] ${url} attempt ${attempt + 1} got ${response.status}, retrying`);
      await sleep(FETCH_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (!response.ok) {
      throw new Error(`${response.status} ${url}`);
    }

    return text;
  }

  throw lastError;
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

    // Source formats real player rows as "Surname, Given $price ... BE",
    // so the name capture must include the comma or it silently truncates
    // to the surname alone (which then fails identity matching).
    const nameMatch = text.match(/^([A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+)?)/);

    if (!nameMatch) continue;

    const name = sourceNameToAppName(nameMatch[1]);

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
  const html = await fetchText(DPP_URL, "dpp-source");

  const players = {};
  const validPositions = new Set(["HOK", "FRF", "2RF", "HFB", "5/8", "CTW", "FLB"]);

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

  const html = await fetchText(SOURCE_URL, "price-be-source");

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

  if (sourceRows.length > 0 && updated === 0) {
    throw new Error(
      `Price/BE source returned ${sourceRows.length} rows, but matched 0 ` +
      "canonical identities. This almost always means the source's row " +
      "format changed (e.g. name formatting) - check the job log's " +
      "[debug] price-be-source lines before assuming this is a real " +
      "zero-update day."
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
// TEST ONLY: investigating whether TeamPricesAndBEs.php's static HTML is a
// full league list or just a small per-team highlights table (evidence:
// only ~18 rows come back, one per team). Checks whether playerlist.php
// (already referenced as a dataSource elsewhere in players.json) is the
// real full-league endpoint. Not wired into the pipeline yet.
async function investigatePlayerListCoverage() {
  const candidates = [
    "https://www.nrlsupercoachstats.com/playerlist.php",
    "https://www.nrlsupercoachstats.com/TeamBEs.php"
  ];

  for (const url of candidates) {
    try {
      const html = await fetchText(url, null);
      const trCount = (html.match(/<tr[\s\S]*?<\/tr>/gi) || []).length;
      const teamMatches = new Set(
        (html.match(/\b(BRO|CAN|CBR|DOL|GLD|MAN|MEL|NEW|NQC|NZL|PAR|PEN|SHA|STG|STH|SYD|WST|WAR)\b/g) || [])
      );
      console.log(`[investigate] ${url}: bytes=${html.length} trCount=${trCount} teamCodesSeen=${teamMatches.size}`);
      console.log(`[investigate] ${url} snippet: ${html.slice(0, 400).replace(/\s+/g, " ")}`);
      const twalIndex = html.indexOf("Twal");
      console.log(`[investigate] ${url} contains "Twal": ${twalIndex !== -1}`);
      if (twalIndex !== -1) {
        console.log(`[investigate] ${url} Twal context: ${html.slice(Math.max(0, twalIndex - 150), twalIndex + 150).replace(/\s+/g, " ")}`);
      }

      const trBlocks = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      const headerRow = trBlocks.find(row => /<th/i.test(row));
      if (headerRow) {
        const headers = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
        console.log(`[investigate] ${url} header columns: ${JSON.stringify(headers)}`);
      }
      const twalRow = trBlocks.find(row => row.includes("Twal, Alex"));
      if (twalRow) {
        const cells = [...twalRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
        console.log(`[investigate] ${url} Twal row cells: ${JSON.stringify(cells)}`);
      }
    } catch (err) {
      console.log(`[investigate] ${url} failed: ${err.message}`);
    }
  }
}

async function main() {
  await investigatePlayerListCoverage();

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