#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const OUT = path.join(ROOT, "fixtures.json");
const REPORT = path.join(ROOT, "fixtures_update_report.json");

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

const sourceConfig = await readJson(
  path.join(ROOT, "data/source_config.json"),
  {}
);

const YEAR = Number(
  process.env.SEASON ||
  sourceConfig.season ||
  sourceConfig.year
);

if (!Number.isFinite(YEAR) || YEAR < 2020) {
  throw new Error(`Invalid fixture season: ${YEAR}`);
}

const URLS = [
  `https://www.nrlsupercoachstats.com/drawV2.php?year=${YEAR}`,
  `https://www.nrlsupercoachstats.com/draw.php?year=${YEAR}`
];

const USER_AGENT =
  "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";

const TEAMS = {
  BRO: ["broncos", "brisbane"],
  DOL: ["dolphins"],
  PEN: ["panthers", "penrith"],
  NQC: ["cowboys", "north queensland"],
  MEL: ["storm", "melbourne"],
  GLD: ["titans", "gold coast"],
  NEW: ["knights", "newcastle"],
  CBR: ["raiders", "canberra"],
  SYD: ["roosters", "sydney roosters"],
  MAN: ["sea eagles", "manly"],
  STH: ["rabbitohs", "south sydney"],
  WST: ["tigers", "wests tigers"],
  SHA: ["sharks", "cronulla"],
  STG: ["dragons", "st george"],
  CAN: ["bulldogs", "canterbury"],
  PAR: ["eels", "parramatta"],
  NZL: ["warriors", "new zealand"]
};

const TEAM_NAME = {
  BRO: "Broncos",
  DOL: "Dolphins",
  PEN: "Panthers",
  NQC: "Cowboys",
  MEL: "Storm",
  GLD: "Titans",
  NEW: "Knights",
  CBR: "Raiders",
  SYD: "Roosters",
  MAN: "Sea Eagles",
  STH: "Rabbitohs",
  WST: "Tigers",
  SHA: "Sharks",
  STG: "Dragons",
  CAN: "Bulldogs",
  PAR: "Eels",
  NZL: "Warriors"
};
const DRAW_CODE_TO_APP_CODE = {
  BRO: "BRO",
  BUL: "CAN",
  CBR: "CBR",
  DOL: "DOL",
  GCT: "GLD",
  MEL: "MEL",
  MNL: "MAN",
  NEW: "NEW",
  NQC: "NQC",
  NZL: "NZL",
  PAR: "PAR",
  PTH: "PEN",
  SHA: "SHA",
  STG: "STG",
  STH: "STH",
  SYD: "SYD",
  WST: "WST"
};

const DRAW_CODES = Object.keys(DRAW_CODE_TO_APP_CODE).join("|");

function appCodeFromDrawCode(value) {
  const text = clean(value).toUpperCase();
  const match = text.match(new RegExp(`\\b(${DRAW_CODES})\\b`));
  return match ? DRAW_CODE_TO_APP_CODE[match[1]] : "";
}

function opponentFromMatrixCell(value) {
  const text = clean(value).toUpperCase();

  if (!text || text.includes("BYE")) {
    return null;
  }

  const match = text.match(new RegExp(`\\b(${DRAW_CODES})(\\(A\\))?\\b`));
  if (!match) {
    return null;
  }

  return {
    code: DRAW_CODE_TO_APP_CODE[match[1]],
    away: Boolean(match[2])
  };
}
const VENUE_CITY = {
  "Suncorp Stadium": ["Brisbane", -27.4648, 153.0095, "Australia/Brisbane"],
  "Queensland Country Bank Stadium": ["Townsville", -19.2564, 146.8183, "Australia/Brisbane"],
  "Qld Country Bank Stadium": ["Townsville", -19.2564, 146.8183, "Australia/Brisbane"],
  "AAMI Park": ["Melbourne", -37.824, 144.9834, "Australia/Melbourne"],
  "Accor Stadium": ["Sydney", -33.8472, 151.0634, "Australia/Sydney"],
  "Allianz Stadium": ["Sydney", -33.889, 151.225, "Australia/Sydney"],
  "McDonald Jones Stadium": ["Newcastle", -32.9188, 151.726, "Australia/Sydney"],
  "GIO Stadium": ["Canberra", -35.2509, 149.1013, "Australia/Sydney"],
  "4 Pines Park": ["Sydney", -33.7855, 151.2847, "Australia/Sydney"],
  "PointsBet Stadium": ["Sydney", -34.0417, 151.1403, "Australia/Sydney"],
  "Sharks Stadium": ["Sydney", -34.0417, 151.1403, "Australia/Sydney"],
  "WIN Stadium": ["Wollongong", -34.4269, 150.9027, "Australia/Sydney"],
  "CommBank Stadium": ["Sydney", -33.8081, 150.9996, "Australia/Sydney"],
  "Commbank Stadium": ["Sydney", -33.8081, 150.9996, "Australia/Sydney"],
  "Go Media Stadium": ["Auckland", -36.9183, 174.812, "Pacific/Auckland"],
  "Cbus Super Stadium": ["Gold Coast", -28.0064, 153.3783, "Australia/Brisbane"],
  "Kayo Stadium": ["Brisbane", -27.2322, 153.1001, "Australia/Brisbane"],
  "Polytec Stadium": ["Sunshine Coast", -26.7398, 153.1247, "Australia/Brisbane"],
  "One NZ Stadium": ["Christchurch", -43.533, 172.6203, "Pacific/Auckland"],
  "SKY Stadium": ["Wellington", -41.2733, 174.7859, "Pacific/Auckland"],
  "Leichhardt Oval": ["Sydney", -33.8794, 151.1567, "Australia/Sydney"],
  "Campbelltown Stadium": ["Sydney", -34.0537, 150.8334, "Australia/Sydney"],
  "Netstrata Jubilee Stadium": ["Sydney", -33.9859, 151.1358, "Australia/Sydney"]
};

function nowIso() {
  return new Date().toISOString();
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
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

function clean(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html) {
  return clean(String(html || "").replace(/<[^>]+>/g, " "));
}

function normCol(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function codeFromText(value) {
  const low = String(value || "").toLowerCase();

  for (const [code, aliases] of Object.entries(TEAMS)) {
    if (aliases.some(alias => low.includes(alias))) {
      return code;
    }
  }

  return "";
}

function findColumn(headers, names) {
  const wanted = names.map(normCol);

  for (let i = 0; i < headers.length; i++) {
    const col = normCol(headers[i]);
    if (wanted.includes(col)) return i;
  }

  for (let i = 0; i < headers.length; i++) {
    const col = normCol(headers[i]);
    if (wanted.some(name => col.includes(name))) return i;
  }

  return -1;
}

function extractTables(html) {
  return String(html || "").match(/<table[\s\S]*?<\/table>/gi) || [];
}

function extractRows(tableHtml) {
  return String(tableHtml || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];
}

function extractCells(rowHtml) {
  const cells = [];
  const matches = String(rowHtml || "").match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];

  for (const cell of matches) {
    cells.push(stripTags(cell));
  }

  return cells;
}

function addVenueMeta(fixture) {
  const venue = String(fixture.venue || "").toLowerCase();

  for (const [key, meta] of Object.entries(VENUE_CITY)) {
    if (venue.includes(key.toLowerCase())) {
      const [city, lat, lon, timezone] = meta;
      fixture.city ??= city;
      fixture.lat ??= lat;
      fixture.lon ??= lon;
      fixture.timezone ??= timezone;
      return fixture;
    }
  }

  fixture.city ??= "";
  fixture.lat ??= null;
  fixture.lon ??= null;
  fixture.timezone ??= "Australia/Brisbane";

  return fixture;
}

function parseRound(value, fallbackText) {
  const match = String(value || fallbackText || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}
function extractFromMatrixTable(tableHtml) {
  const out = [];
  const seen = new Set();

  const text = stripTags(tableHtml);
  const tokens = text
    .split(/\s+/)
    .map(token => clean(token))
    .filter(Boolean);

  const headerIndex = tokens.findIndex((token, index) => {
    return (
      /^Team$/i.test(token) &&
      tokens.slice(index + 1, index + 30).some(next => /^Rd\s*1$/i.test(next)) &&
      tokens.slice(index + 1, index + 40).some(next => /^Rd\s*27$/i.test(next))
    );
  });

  if (headerIndex < 0) return out;

  let index = headerIndex + 1;

  while (index < tokens.length) {
    const team = appCodeFromDrawCode(tokens[index]);

    if (!team) {
      index++;
      continue;
    }

    index++;

    for (let round = 1; round <= 27 && index < tokens.length;) {
      const token = tokens[index];

      if (/^-?\d+(\.\d+)?$/.test(token)) {
        index++;
        continue;
      }

      const opponent = opponentFromMatrixCell(token);

      if (!opponent) {
        index++;
        continue;
      }

      const home = opponent.away ? opponent.code : team;
      const away = opponent.away ? team : opponent.code;

      if (home && away && home !== away) {
        const pairKey = [home, away].sort().join("-");
        const key = `${round}|${pairKey}`;

        if (!seen.has(key)) {
          seen.add(key);

          const fixture = {
            round,
            match: `${TEAM_NAME[home] || home} v ${TEAM_NAME[away] || away}`,
            homeTeam: home,
            awayTeam: away,
            venue: "",
            kickoffLocal: ""
          };

          addVenueMeta(fixture);
          out.push(fixture);
        }
      }

      round++;
      index++;
    }
  }

  return out;
}
function extractFromTable(tableHtml) {
  const matrixFixtures = extractFromMatrixTable(tableHtml);
  if (matrixFixtures.length) return matrixFixtures;

  const out = [];
  const rows = extractRows(tableHtml);
  if (!rows.length) return out;

  const parsedRows = rows.map(extractCells).filter(row => row.length);
  if (!parsedRows.length) return out;

  let headers = parsedRows[0];

  const headerLooksUseful = headers.some(h =>
    /round|rnd|rd|home|away|match|game|fixture|venue|stadium|ground|date|kickoff|kick off|time/i.test(h)
  );

  if (!headerLooksUseful) {
    headers = [];
  }

  const roundCol = findColumn(headers, ["Round", "Rnd", "Rd"]);
  const homeCol = findColumn(headers, ["Home", "Home Team"]);
  const awayCol = findColumn(headers, ["Away", "Away Team"]);
  const matchCol = findColumn(headers, ["Match", "Game", "Fixture"]);
  const venueCol = findColumn(headers, ["Venue", "Stadium", "Ground"]);
  const dateCol = findColumn(headers, ["Date", "Kickoff", "Kick Off", "Time"]);

  const bodyRows = headerLooksUseful ? parsedRows.slice(1) : parsedRows;

  for (const cells of bodyRows) {
    const text = clean(cells.join(" "));
    if (!text || /^round\b/i.test(text)) continue;

    let home = homeCol >= 0 ? codeFromText(cells[homeCol]) : "";
    let away = awayCol >= 0 ? codeFromText(cells[awayCol]) : "";

    const matchText = matchCol >= 0 ? clean(cells[matchCol]) : text;

    if (!(home && away)) {
      const found = [];

      for (const [code, aliases] of Object.entries(TEAMS)) {
        if (aliases.some(alias => matchText.toLowerCase().includes(alias))) {
          found.push(code);
        }
      }

      const unique = [...new Set(found)];

      if (unique.length >= 2) {
        home = unique[0];
        away = unique[1];
      }
    }

    if (!(home && away)) continue;

    const roundRaw = roundCol >= 0 ? cells[roundCol] : "";
    const round = parseRound(roundRaw, text);
    if (!round) continue;

    const venue = venueCol >= 0 ? clean(cells[venueCol]) : "";
    const kickoffLocal = dateCol >= 0 ? clean(cells[dateCol]) : "";

    const fixture = {
      round,
      match: `${TEAM_NAME[home] || home} v ${TEAM_NAME[away] || away}`,
      homeTeam: home,
      awayTeam: away,
      venue,
      kickoffLocal
    };

    addVenueMeta(fixture);
    out.push(fixture);
  }

  return out;
}

function calculateByes(fixtures) {
  const byes = {};
  const rounds = [...new Set(fixtures.map(f => Number(f.round)).filter(Boolean))].sort((a, b) => a - b);
  const allTeams = new Set(Object.keys(TEAMS));

  for (const round of rounds) {
    const teamsPlaying = new Set();

    for (const fixture of fixtures) {
      if (Number(fixture.round) !== Number(round)) continue;
      if (fixture.homeTeam) teamsPlaying.add(fixture.homeTeam);
      if (fixture.awayTeam) teamsPlaying.add(fixture.awayTeam);
    }

    byes[String(round)] = [...allTeams]
      .filter(team => !teamsPlaying.has(team))
      .sort();
  }

  return byes;
}

function dedupeFixtures(fixtures) {
  const seen = new Set();
  const cleanFixtures = [];

  for (const fixture of fixtures) {
    const key = `${fixture.round}|${fixture.homeTeam}|${fixture.awayTeam}`;

    if (seen.has(key)) continue;
    seen.add(key);
    cleanFixtures.push(fixture);
  }

  return cleanFixtures;
}

async function main() {
  const report = {
    updated: nowIso(),
    sources: [],
    fixturesFound: 0,
    warnings: [],
    status: "started"
  };

  const fixtures = [];

  for (const url of URLS) {
    const source = { url };

    try {
      const html = await fetchText(url);
      source.http_status = 200;
      source.content_length = html.length;

      const tables = extractTables(html);
      source.tables = tables.length;

      for (const table of tables) {
        fixtures.push(...extractFromTable(table));
      }

      source.fixtures_after = fixtures.length;
    } catch (error) {
      source.error = error.message;
    }

    report.sources.push(source);
  }

  const cleanFixtures = dedupeFixtures(fixtures);
  const rounds = [...new Set(cleanFixtures.map(f => Number(f.round)).filter(Boolean))].sort((a, b) => a - b);
  const byes = calculateByes(cleanFixtures);

  if (!cleanFixtures.length) {
    report.warnings.push("No fixtures parsed from public draw tables.");
  }

  const data = {
    updated: nowIso(),
    source: "auto update fixtures from public draw tables",
    year: YEAR,
    rounds,
    fixtures: cleanFixtures,
    byes,
    note: "If venue/kickoff is missing, next-5 model will lower confidence and refuse fake full averages."
  };

  report.status = cleanFixtures.length >= 50 ? "ok" : "failed";
  report.fixturesFound = cleanFixtures.length;
  report.roundsFound = rounds;
  report.byesRounds = Object.keys(byes).sort((a, b) => Number(a) - Number(b));
  report.sample = cleanFixtures.slice(0, 5);

  await writeJson(OUT, data);
  await writeJson(REPORT, report);

  console.log(JSON.stringify(report, null, 2));

  if (report.status !== "ok") {
    throw new Error("Fixture import did not produce enough fixtures. Check fixtures_update_report.json.");
  }
}

main().catch(async error => {
  const report = {
    updated: nowIso(),
    status: "failed",
    error: error.message,
    message: "Node fixture import failed. Check fixture source HTML and parser contract."
  };

  await writeJson(REPORT, report);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});
