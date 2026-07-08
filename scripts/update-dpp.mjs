import fs from "node:fs";

const readJson = (path, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

const writeJson = (path, data) => {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};

const sourceConfig = readJson("data/source_config.json", {});
const SEASON = sourceConfig.season;

const DPP_URL = `https://www.nrlsupercoachstats.com/dualposngrid.php?year=${SEASON}`;

const VALID_POSITIONS = new Set([
  "HOK",
  "FRF",
  "2RF",
  "HFB",
  "5/8",
  "CTW",
  "FLB"
]);

const playersPath = "players.json";
async function fetchDppHtml() {
  const response = await fetch(DPP_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 SuperCoachWarRoom"
    }
  });

  if (!response.ok) {
    throw new Error(`DPP fetch failed: ${response.status}`);
  }

  return await response.text();
}

function normaliseName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]/g, "");
}
function parsePositions(text) {
  const positions = [];

  for (const pos of VALID_POSITIONS) {
    if (text.includes(pos)) {
      positions.push(pos);
    }
  }

  return positions;
}

function extractDppPlayers(html) {
  const out = {};

  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const clean = row.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const positions = parsePositions(clean);

    if (positions.length < 2) continue;

    const nameMatch = clean.match(/^([A-Za-z .'-]+)/);

    if (!nameMatch) continue;

    const name = nameMatch[1].trim();

    if (name) {
      out[normaliseName(name)] = {
        name,
        positions
      };
    }
  }

  return out;
}
async function main() {
  const html = await fetchDppHtml();

  const dppPlayers = extractDppPlayers(html);

  const playersData = readJson(playersPath, { players: [] });

  const players = playersData.players || [];

  let matched = 0;

  for (const player of players) {
    const key = normaliseName(player.name);

    const dpp = dppPlayers[key];

    if (!dpp) continue;

player.dualPositions = dpp.positions;

    matched++;
  }

  playersData.players = players;

  writeJson(playersPath, playersData);

  console.log(`DPP source players: ${Object.keys(dppPlayers).length}`);
  console.log(`DPP matched players: ${matched}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
