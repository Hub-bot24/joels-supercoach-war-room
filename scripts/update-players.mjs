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

// TeamPricesAndBEs.php's static HTML is only a small per-team highlights
// table (~18 rows, one per team) - confirmed by comparing to this source,
// which lists every player (581 rows) with a real structured table.
const PLAYERLIST_URL =
  "https://www.nrlsupercoachstats.com/playerlist.php";

// Full-league breakeven list (476 players, confirmed via index.php?player=
// link count). Its HTML is malformed (unbalanced <td>/<tr> nesting) so it
// can't be parsed as a normal table - each player is a
// name-link-then-breakeven-number pair in a flat repeating sequence.
const TEAM_BES_URL =
  "https://www.nrlsupercoachstats.com/TeamBEs.php";

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
async function mergePlayers(sourceRows, dppPlayers, playerListRows, teamBEsRows) {
  const existing = await readJson(PLAYERS_FILE, { players: [] });
  const players = existing.players || [];
  const identityIndex = buildIdentityIndex(players);

  let updated = 0;
  let dppApplied = 0;
  let dppMatchedExisting = 0;
  let teamBEsUpdated = 0;
  let playerListUpdated = 0;

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

  for (const entry of playerListRows) {
    if (!entry.name) continue;

    const resolution = resolveIdentity(identityIndex, entry.name);

    if (resolution.status === "unmatched") {
      unmatched.push({
        source: "player-list",
        sourceName: entry.name,
        reason: "Enrichment sources cannot create canonical players"
      });

      continue;
    }

    if (resolution.status === "ambiguous") {
      ambiguous.push({
        source: "player-list",
        sourceName: entry.name,
        candidates: resolution.candidates.map(player => player.name)
      });

      continue;
    }

    const player = resolution.player;

    player.price = entry.price;

    player.enrichmentSources = {
      ...(player.enrichmentSources || {}),
      price: {
        source: "nrlsupercoachstats-playerlist",
        updatedAt: new Date().toISOString()
      }
    };

    player.lastDataUpdate = new Date().toISOString();

    playerListUpdated++;
  }

  for (const entry of teamBEsRows) {
    if (!entry.name) continue;

    const resolution = resolveIdentity(identityIndex, entry.name);

    if (resolution.status === "unmatched") {
      unmatched.push({
        source: "team-bes",
        sourceName: entry.name,
        reason: "Enrichment sources cannot create canonical players"
      });

      continue;
    }

    if (resolution.status === "ambiguous") {
      ambiguous.push({
        source: "team-bes",
        sourceName: entry.name,
        candidates: resolution.candidates.map(player => player.name)
      });

      continue;
    }

    const player = resolution.player;

    player.breakeven = entry.breakeven;
    player.breakevenStatus = "updated";

    player.enrichmentSources = {
      ...(player.enrichmentSources || {}),
      breakeven: {
        source: "nrlsupercoachstats-teambes",
        updatedAt: new Date().toISOString()
      }
    };

    player.lastDataUpdate = new Date().toISOString();

    teamBEsUpdated++;
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

  if (playerListRows.length > 0 && playerListUpdated === 0) {
    throw new Error(
      `Player-list source returned ${playerListRows.length} rows, but ` +
      "matched 0 canonical identities. Check the job log's " +
      "[debug] playerlist-source lines before assuming this is a real " +
      "zero-update day."
    );
  }

  if (teamBEsRows.length > 0 && teamBEsUpdated === 0) {
    throw new Error(
      `TeamBEs source returned ${teamBEsRows.length} rows, but matched 0 ` +
      "canonical identities. Check the job log's [debug] team-bes-source " +
      "lines before assuming this is a real zero-update day."
    );
  }

  existing.players = players;
  existing.updated = new Date().toISOString();
  existing.dataPipeline = {
    version: "v6-full-league-price-and-be-coverage",
    source: SOURCE_URL,
    rowsFound: sourceRows.length,
    playersUpdated: updated,
    playersAdded: 0,
    unmatchedEnrichmentRows: unmatched.length,
    ambiguousEnrichmentRows: ambiguous.length,
    dppSourcePlayers:
      Object.keys(dppPlayers).length,
    dppMatchedExisting,
    dppApplied,
    playerListSource: PLAYERLIST_URL,
    playerListRowsFound: playerListRows.length,
    playerListUpdated,
    teamBEsSource: TEAM_BES_URL,
    teamBEsRowsFound: teamBEsRows.length,
    teamBEsUpdated
  };

  await writeJson(PLAYERS_FILE, existing);

  console.log(`Players updated: ${updated}`);
  console.log("Players added: 0");
  console.log(
    `Unmatched enrichment rows: ${unmatched.length}`
  );
  // TEST ONLY: print exactly which rows failed to match, so a "why not
  // 100%" question can be answered with evidence instead of speculation.
  for (const item of unmatched) {
    console.log(`[unmatched] source=${item.source} name="${item.sourceName}"`);
  }
  console.log(
    `Ambiguous enrichment rows: ${ambiguous.length}`
  );
  console.log(
    `Player-list rows found: ${playerListRows.length}`
  );
  console.log(
    `Player-list players updated: ${playerListUpdated}`
  );
  console.log(
    `TeamBEs rows found: ${teamBEsRows.length}`
  );
  console.log(
    `TeamBEs players updated: ${teamBEsUpdated}`
  );
  console.log(
    `DPP matched existing players: ${dppMatchedExisting}`
  );
  console.log(
    `DPP applied to existing players: ${dppApplied}`
  );
}
// playerlist.php is the actual full-league player table (confirmed: 581
// rows vs. TeamPricesAndBEs.php's ~18-row per-team highlights table).
// Header-driven, like the DPP parser, rather than the fragile
// regex-over-flattened-text approach - so column order changes don't
// silently break it.
function parsePlayerListRows(html) {
  const trBlocks = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  const headerRow = trBlocks.find(row => /<th/i.test(row));

  if (!headerRow) return [];

  const headers = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
    .map(match => stripTags(match[1]));

  const nameIndex = headers.indexOf("Name");
  const priceIndex = headers.indexOf("Price");

  if (nameIndex === -1 || priceIndex === -1) return [];

  const rows = [];

  for (const row of trBlocks) {
    if (row === headerRow) continue;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(match => stripTags(match[1]));

    if (cells.length <= Math.max(nameIndex, priceIndex)) continue;

    const rawName = cells[nameIndex];
    const price = toNumber(cells[priceIndex]);

    if (!rawName || price === null) continue;

    const name = sourceNameToAppName(rawName);

    if (!name) continue;

    rows.push({
      name,
      norm: normaliseIdentityName(name),
      price
    });
  }

  return rows;
}

async function fetchPlayerListRows() {
  console.log(`Fetching ${PLAYERLIST_URL}`);

  const html = await fetchText(PLAYERLIST_URL, "playerlist-source");

  const rows = parsePlayerListRows(html);

  console.log(`Parsed ${rows.length} player-list rows`);

  return rows;
}

// TeamBEs.php's HTML is malformed (unbalanced <td>/<tr> nesting, confirmed
// by inspecting the raw source), so it can't be walked as a normal table.
// Each player is a flat, reliably repeating sequence instead: a name link
// immediately followed by its breakeven number. Match that sequence
// directly rather than trying to parse it as row/column structure.
function parseTeamBEsRows(html) {
  const rows = [];
  const pattern = /<a href="\.\/index\.php\?player=[^"]*"[^>]*>([^<]+)<\/a>[\s\S]{0,150}?>(\d+)<\/td>/g;

  let match;

  while ((match = pattern.exec(html)) !== null) {
    const name = sourceNameToAppName(match[1]);
    const breakeven = Number(match[2]);

    if (!name || Number.isNaN(breakeven)) continue;

    rows.push({
      name,
      norm: normaliseIdentityName(name),
      breakeven
    });
  }

  return rows;
}

async function fetchTeamBEsRows() {
  console.log(`Fetching ${TEAM_BES_URL}`);

  const html = await fetchText(TEAM_BES_URL, "team-bes-source");

  const rows = parseTeamBEsRows(html);

  console.log(`Parsed ${rows.length} team-BEs rows`);

  return rows;
}

// TEST ONLY: existing player records reference "nrlsupercoachstats jqGrid
// AvgScore" as the historical (manual, one-time) source of avg/proj/last3/
// last5/minutes/ppm. jqGrid implementations conventionally serve their
// data from a dedicated endpoint - checking the site's own "Datatable"
// page as the most likely candidate before assuming anything.
async function investigateAvgStatsSource() {
  const candidates = [
    "https://www.nrlsupercoachstats.com/phpgrid/players.php",
    `https://www.nrlsupercoachstats.com/phpgrid/players.php?year=${SEASON}`
  ];

  for (const url of candidates) {
    try {
      const html = await fetchText(url, null);
      console.log(`[investigate-avg] ${url}: bytes=${html.length}`);
      console.log(`[investigate-avg] ${url} snippet: ${html.slice(0, 500).replace(/\s+/g, " ")}`);

      const twalIndex = html.indexOf("Twal");
      console.log(`[investigate-avg] ${url} contains "Twal": ${twalIndex !== -1}`);
      if (twalIndex !== -1) {
        console.log(`[investigate-avg] ${url} Twal context: ${html.slice(Math.max(0, twalIndex - 300), twalIndex + 300).replace(/\s+/g, " ")}`);
      }
    } catch (err) {
      console.log(`[investigate-avg] ${url} failed: ${err.message}`);
    }
  }
}

async function main() {
  await investigateAvgStatsSource();

  const rows = await fetchSourceRows();

  const dppPlayers = await fetchDppPlayers();

  const playerListRows = await fetchPlayerListRows();

  const teamBEsRows = await fetchTeamBEsRows();

  if (!rows.length) {
    throw new Error("No usable player rows found");
  }

  await mergePlayers(rows, dppPlayers, playerListRows, teamBEsRows);

  console.log("Node player updater complete");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});