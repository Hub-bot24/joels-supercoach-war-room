
import fs from "node:fs";

const ROOT = process.cwd();

const PATHS = {
  players: `${ROOT}/players.json`,
  seed: `${ROOT}/players_seed_round14.json`,
  overrides: `${ROOT}/position_overrides.json`,
  master: `${ROOT}/position_master.json`,
  dual: `${ROOT}/dual_positions.json`,
  report: `${ROOT}/position_audit_report.json`,
  dppStatus: `${ROOT}/dpp_import_status.json`
};

const VALID = new Set([
  "HOK",
  "FRF",
  "2RF",
  "HFB",
  "5/8",
  "CTW",
  "FLB"
]);

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function extractPlayers(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.players)) return data.players;
  return [];
}

function normName(name) {
  return String(name || "")
    .toLowerCase()
    .replaceAll("â€™", "'")
    .replaceAll(".", "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function posList(value) {
  if (!value) return [];

  const values = Array.isArray(value) ? value : [value];
  const out = [];

  for (const item of values) {
    for (const part of String(item).split(/[,|]/)) {
      const pos = part.trim().toUpperCase();
      if (VALID.has(pos) && !out.includes(pos)) {
        out.push(pos);
      }
    }
  }

  return out;
}

function playerName(player) {
  return player.name ||
    player.player ||
    player.playerName ||
    player.fullName;
}

function playerPositions(player) {
  const keys = [
    "positions",
    "eligiblePositions",
    "supercoachPositions",
    "dualPositions",
    "position",
    "pos",
    "role"
  ];

  for (const key of keys) {
    if (key in player) {
      const result = posList(player[key]);
      if (result.length) return result;
    }
  }

  return [];
}

function mergeSources() {
  const merged = {};

  for (const file of [PATHS.seed, PATHS.players]) {
    const data = readJson(file, []);
    for (const player of extractPlayers(data)) {
      const name = playerName(player);
      if (!name) continue;

      const key = normName(name);

      merged[key] = {
        ...(merged[key] || {}),
        ...player,
        name
      };
    }
  }

  return merged;
}

const players = mergeSources();

const overridesData = readJson(PATHS.overrides, { players: {} });
const overrides = overridesData.players || {};

const master = {};

const report = {
  updated: new Date().toISOString(),
  total_players_seen: Object.keys(players).length,
  positions_from_import: 0,
  manual_overrides_applied: 0,
  missing_positions: [],
  conflicts_fixed_by_override: []
};

for (const player of Object.values(players)) {
  const name = playerName(player);
  const positions = playerPositions(player);

  if (positions.length) {
    master[name] = positions;
    report.positions_from_import++;
  } else {
    report.missing_positions.push(name);
  }
}

for (const [name, positionsRaw] of Object.entries(overrides)) {
  const trusted = posList(positionsRaw);
  if (!trusted.length) continue;

  const existing = Object.keys(master)
    .find(player => normName(player) === normName(name));

  if (existing && JSON.stringify(master[existing]) !== JSON.stringify(trusted)) {
    report.conflicts_fixed_by_override.push({
      player: existing,
      imported: master[existing],
      trusted
    });

    delete master[existing];
  }

  master[name] = trusted;
  report.manual_overrides_applied++;
}

const sortedMaster = Object.fromEntries(
  Object.entries(master).sort((a, b) =>
    a[0].localeCompare(b[0])
  )
);

const dppPlayers = Object.fromEntries(
  Object.entries(sortedMaster)
    .filter(([, positions]) => positions.length > 1)
);

const dppStatus = readJson(PATHS.dppStatus, {});

report.dpp_import = {
  ...dppStatus,
  position_master_dpp_count: Object.keys(dppPlayers).length
};

writeJson(PATHS.master, {
  updated: new Date().toISOString(),
  source: "players.json + players_seed_round14.json + protected position_overrides.json",
  rule: "All app screens must read this file. Manual overrides win over imported data.",
  players: sortedMaster
});

writeJson(PATHS.dual, {
  updated: new Date().toISOString(),
  source: "generated from position_master.json",
  players: sortedMaster
});

writeJson(PATHS.report, report);

console.log(`Position master updated: ${Object.keys(sortedMaster).length} players`);
console.log(`DPP players: ${Object.keys(dppPlayers).length}`);
console.log(`Overrides applied: ${report.manual_overrides_applied}`);
