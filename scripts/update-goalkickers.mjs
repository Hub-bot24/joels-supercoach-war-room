import fs from "node:fs";

const readJson = (path, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
};

const writeJson = (path, data) => {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};

const goalKickers = readJson("goal_kickers.json", { teams: {} });
const statusTruth = readJson("data/status_truth.json", { players: {} });
const teamlists = readJson("data/teamlists.json", { players: {} });
const currentRound = readJson("data/current_round.json", {});
const players = readJson("players.json", { players: [] });

const playerNames = new Set((players.players || players || []).map(p => p.name).filter(Boolean));

function playerRecord(name) {
  return statusTruth.players?.[name] || teamlists.players?.[name] || null;
}

function isNamedAvailable(name) {
  const rec = playerRecord(name);
  if (!rec) return false;

  const display = String(rec.displayStatus || "").toUpperCase();
  const role = String(rec.lineupRole || rec.selectionRole || "").toLowerCase();

  if (rec.available === false) return false;
  if (display === "INJURED" || display === "SUSPENDED" || display === "NOT_NAMED" || display === "BYE") return false;

  return display === "NAMED" || role === "starter" || role === "interchange";
}

function ladderFor(teamData) {
  if (Array.isArray(teamData?.ladder)) return teamData.ladder;
  const out = [];
  if (teamData?.primary) out.push({ name: teamData.primary, role: "primary", confidence: "high" });
  for (const b of teamData?.backups || []) out.push(typeof b === "string" ? { name: b, role: "backup", confidence: "medium" } : b);
  for (const a of teamData?.active || []) out.push(typeof a === "string" ? { name: a, role: "active", confidence: "medium" } : a);
  return out;
}

const out = {
  season: Number(goalKickers.season || new Date().getFullYear()),
  round: Number(currentRound.round || currentRound.currentRound || 0),
  updated: new Date().toISOString(),
  source: "generated from goal_kickers.json ladder plus current status/teamlists; no match-by-match goals source yet",
  rule: "Select first named and available kicker from each team ladder. Recent goal-kicking evidence remains unknown until a goals/conversions source is added.",
  teams: {},
  players: {}
};

for (const [team, teamData] of Object.entries(goalKickers.teams || {})) {
  const ladder = ladderFor(teamData)
    .filter(x => x?.name)
    .filter(x => playerNames.has(x.name));

  const named = ladder.filter(x => isNamedAvailable(x.name));
  const chosen = named[0] || null;

  out.teams[team] = {
    chosenKicker: chosen?.name || null,
    chosenRole: chosen?.role || null,
    chosenConfidence: chosen?.confidence || null,
    ladder: ladder.map(x => ({
      name: x.name,
      role: x.role || null,
      confidence: x.confidence || null,
      namedAvailable: isNamedAvailable(x.name)
    }))
  };

  for (const x of ladder) {
    const isChosen = chosen?.name === x.name;
    out.players[x.name] = {
      team,
      role: x.role || null,
      confidence: x.confidence || null,
      namedAvailable: isNamedAvailable(x.name),
      chosenKicker: isChosen,
      recentGoalKicksKnown: false,
      seasonGoalKicksKnown: false,
      recentGoals: null,
      seasonGoals: null,
      gamesWithRecentGoals: null,
      upliftMode: isChosen ? "role-only-no-goals-source" : "not-current-kicker",
      recommendedUplift: isChosen ? null : 0,
      label: isChosen ? "GK role identified; goals evidence unavailable" : "No GK uplift"
    };
  }
}

writeJson("data/goal_kicker_evidence.json", out);

console.log(`Wrote data/goal_kicker_evidence.json`);
console.log(`Teams: ${Object.keys(out.teams).length}`);
console.log(`Players: ${Object.keys(out.players).length}`);
