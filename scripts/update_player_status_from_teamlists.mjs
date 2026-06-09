import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const now = new Date();

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, file), 'utf8')); }
  catch { return fallback; }
}
async function writeJson(file, data) {
  await fs.writeFile(path.join(ROOT, file), JSON.stringify(data, null, 2) + '\n');
}
function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function slug(s) { return norm(s).replace(/['’]/g, '').replace(/\s+/g, '-'); }
function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 WarRoomStatusBot/1.0 (+GitHub Actions)',
        'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return htmlToText(await res.text());
  } finally { clearTimeout(timeout); }
}
function extractWindow(text, name, radius = 180) {
  const nText = norm(text);
  const nName = norm(name);
  const i = nText.indexOf(nName);
  if (i < 0) return '';
  return nText.slice(Math.max(0, i - radius), Math.min(nText.length, i + nName.length + radius));
}
function hasName(text, name) {
  const nText = ` ${norm(text)} `;
  const nName = ` ${norm(name)} `;
  return nText.includes(nName);
}
function isHardOutContext(w) {
  return /\b(out|ruled out|withdrawn|omitted|rested|failed to back up|not playing|unavailable|suspended|injured|cut from the squad|failed fitness test|will miss|set to miss|expected to miss|dnp)\b/i.test(w);
}
function isAvailableContext(w) {
  return /\b(named|selected|will play|available|cleared|confirmed|starts|starting|returns|included|final 17|final team|to play|listed)\b/i.test(w);
}
function isSoftRiskContext(w) {
  return /\b(doubt|doubtful|monitor|chance|test|fitness test|late call|question mark|cloud|risk|may miss|could miss|back up|backing up|origin monitor|calf|hamstring|ankle|knee|shoulder|concussion)\b/i.test(w);
}
function sourceEvidence(sourceType, url, playerName, text) {
  if (!hasName(text, playerName)) return null;
  const window = extractWindow(text, playerName);
  let status = 'monitor';
  let confidence = 'medium';
  let label = 'Seen in source';

  if (sourceType === 'official_team_list') {
    status = 'available';
    confidence = 'high';
    label = 'Named';
  }
  if (isHardOutContext(window)) {
    status = 'out';
    confidence = sourceType === 'origin_squad' ? 'medium' : 'high';
    label = 'Out/Rested';
  } else if (isAvailableContext(window)) {
    status = 'available';
    confidence = sourceType === 'origin_squad' ? 'medium' : 'high';
    label = sourceType === 'origin_squad' ? 'Origin selected' : 'Named';
  } else if (isSoftRiskContext(window)) {
    status = 'risk';
    confidence = sourceType === 'official_team_list' ? 'medium' : 'low';
    label = sourceType === 'origin_squad' ? 'Origin monitor' : 'Monitor';
  }
  return { source: sourceType, url, status, confidence, label, context: window.slice(0, 320), seenAt: now.toISOString() };
}
function parsePlayers(playersJson) {
  const arr = Array.isArray(playersJson) ? playersJson : (playersJson.players || playersJson.data || []);
  return arr.map(p => {
    if (typeof p === 'string') return { name: cleanName(p) };
    return { ...p, name: cleanName(p.name || p.player || p.fullName || p.playerName) };
  }).filter(p => p.name);
}
function numberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function roundFromPlayer(player) {
  for (const k of ['returnWindowMinRound','expectedReturnRound','returnRound','roundReturn','injuryReturnRound']) {
    const n = numberOrNull(player?.[k]); if (n) return n;
  }
  const txt = `${player?.expectedReturn || ''} ${player?.injuryNote || ''} ${player?.statusNote || ''}`;
  const m = txt.match(/(?:round|rd|r)\s*(\d{1,2})/i);
  return m ? Number(m[1]) : null;
}
function playerLocalInjuryEvidence(player, currentRound) {
  const txt = [
    player.status, player.injuryStatus, player.availability, player.injury, player.injuryNote,
    player.statusNote, player.news, player.note, player.expectedReturn
  ].map(x => String(x || '')).join(' | ');
  const n = norm(txt);
  if (!n) return null;

  const retRound = roundFromPlayer(player);
  const hasInjuryWords = /\b(calf|hamstring|ankle|knee|shoulder|concussion|injur|strain|suspended|rested|unavailable|dnp|ruled out|out|expected to be available|expected return|return round)\b/i.test(txt);
  const hardOut = /\b(out|ruled out|unavailable|suspended|rested|dnp|will miss|expected to miss)\b/i.test(txt);
  const softRisk = /\b(risk|question mark|monitor|test|fitness|doubt|calf|hamstring|ankle|knee|shoulder|concussion|expected to be available)\b/i.test(txt);
  if (!hasInjuryWords && !retRound) return null;

  if (retRound && currentRound && retRound > currentRound) {
    return { source: 'players_json', status: 'out', confidence: 'medium', label: 'Injury return window', context: txt.slice(0, 320), returnRound: retRound };
  }
  if (hardOut) return { source: 'players_json', status: 'out', confidence: 'medium', label: 'Local injury/out flag', context: txt.slice(0, 320), returnRound: retRound };
  if (softRisk) return { source: 'players_json', status: 'risk', confidence: 'medium', label: 'Local injury monitor', context: txt.slice(0, 320), returnRound: retRound };
  return null;
}
function currentRoundFromFixtures(fixturesJson) {
  const all = [];
  function walk(x) {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const r = Number(x.round || x.roundNumber || x.round_number || x.scRound || x.nrlRound);
    const d = x.kickoffLocal || x.kickoff || x.date || x.matchDate || x.startTime || x.start;
    const t = new Date(d).getTime();
    if (Number.isFinite(r) && Number.isFinite(t)) all.push({ round: r, time: t });
    Object.values(x).forEach(v => { if (v && typeof v === 'object') walk(v); });
  }
  walk(fixturesJson);
  if (!all.length) return null;
  all.sort((a,b) => a.time-b.time);
  const buffer = 10 * 60 * 60 * 1000;
  const upcoming = all.find(m => m.time + buffer >= Date.now());
  return upcoming ? upcoming.round : all[all.length-1].round;
}
function dateMs(v) { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : NaN; }
function previousAgeHours(prev) {
  const t = dateMs(prev?.updatedAt || prev?.updated || prev?.seenAt);
  return Number.isFinite(t) ? (Date.now() - t) / 36e5 : 9999;
}
function withinOriginWindow(originConfig, playerName) {
  const cfg = originConfig.settings || {};
  const before = Number(cfg.riskWindowDaysBeforeOrigin ?? 7);
  const after = Number(cfg.riskWindowDaysAfterOrigin ?? 4);
  const games = Array.isArray(originConfig.originGames) ? originConfig.originGames : [];
  const manual = originConfig.players?.[playerName] || originConfig.players?.[slug(playerName)] || null;
  const selectedManual = !!manual && !/not selected|removed|unavailable/i.test(String(manual.status || ''));
  const nowMs = now.getTime();
  const inWindow = games.some(g => {
    const t = dateMs(g.date || g.kickoff || g.start);
    return Number.isFinite(t) && nowMs >= t - before * 86400000 && nowMs <= t + after * 86400000;
  });
  return { selectedManual, inWindow, manual };
}
function statusObj(status, label, confidence, reason, sources = [], flags = []) {
  return { status, label, sourceConfidence: confidence, updated: now.toISOString(), updatedAt: now.toISOString(), reason, sources, flags };
}
function chooseStatus(player, evidences, previous, originConfig, currentRound) {
  const named = evidences.find(e => e.source === 'official_team_list' && e.status === 'available') || evidences.find(e => e.status === 'available' && e.confidence === 'high');
  const hardOut = evidences.find(e => e.status === 'out' && e.source !== 'origin_squad');
  const originEv = evidences.find(e => e.source === 'origin_squad');
  const risk = evidences.find(e => e.status === 'risk');
  const local = playerLocalInjuryEvidence(player, currentRound);
  const origin = withinOriginWindow(originConfig, player.name);

  // Absolute rule: named/current team-list evidence wins over local stale injury notes and Origin uncertainty.
  if (named) {
    const flags = [];
    if ((origin.selectedManual || originEv) && (origin.inWindow || originEv)) flags.push('origin_back_up_monitor');
    return statusObj('available', 'Named', 'high', flags.length ? 'Named in current team-list source. Origin/back-up monitor only; team list wins.' : 'Named in current team-list source.', [named, ...(originEv ? [originEv] : [])], flags);
  }

  // Do not mark as available just because source did not mention them. Absence is not proof.
  if (hardOut) return statusObj('out', 'Out', 'high', 'Current team-list/late-mail source indicates out/rested/unavailable.', [hardOut]);
  if (local?.status === 'out') return statusObj('out', local.label || 'Out', local.confidence || 'medium', local.returnRound ? `Local player data says unavailable until around R${local.returnRound}.` : 'Local player data says out/unavailable/rested.', [local]);

  if ((origin.selectedManual || originEv) && (origin.inWindow || originEv)) {
    return statusObj('risk', 'Origin monitor', 'medium', 'Origin player not confirmed in current club team-list source. Back-up/rest risk until named/final team confirms.', [originEv || { source: 'origin_players_json', status: 'risk', confidence: 'medium', label: 'Origin monitor', context: origin.manual?.source || '' }], ['origin_monitor']);
  }
  if (risk) return statusObj('risk', risk.label || 'Monitor', risk.confidence || 'low', 'Current source indicates monitor/risk. This will be cleared automatically if player is named.', [risk]);
  if (local?.status === 'risk') return statusObj('risk', local.label || 'Monitor', local.confidence || 'medium', 'Local player data indicates injury/availability monitor. Team-list evidence is needed to clear it.', [local]);

  // Preserve a fresh previous high/medium out/risk if we did not find new named evidence. Do not wipe it.
  if (previous && ['out','risk','rested','origin_monitor'].includes(previous.status) && previousAgeHours(previous) < 72) {
    return statusObj(previous.status === 'origin_monitor' ? 'risk' : previous.status, previous.label || previous.status, previous.sourceConfidence || 'medium', `Carried forward previous ${previous.status}; no newer team-list evidence cleared it.`, previous.sources || [], previous.flags || []);
  }

  // Conservative fallback: unknown/monitor, not available. This prevents the Hynes bug.
  return statusObj('risk', 'Unconfirmed', 'low', 'No current named/out evidence found in configured sources. Do not treat as confirmed available.', []);
}

async function main() {
  const players = parsePlayers(await readJson('players.json', []));
  const fixtures = await readJson('fixtures.json', null);
  const currentRound = currentRoundFromFixtures(fixtures);
  const previous = await readJson('player_status.json', { players: {} });
  const sources = await readJson('teamlist_sources.json', { teamListUrls: [], lateMailUrls: [], originUrls: [] });
  const originConfig = await readJson('origin_players.json', { settings: {}, originGames: [], players: {} });

  const sourceGroups = [
    ['official_team_list', sources.teamListUrls || []],
    ['late_mail', sources.lateMailUrls || []],
    ['origin_squad', sources.originUrls || []]
  ];
  const fetched = [];
  for (const [sourceType, urls] of sourceGroups) {
    for (const url of urls) {
      try { const text = await fetchText(url); fetched.push({ sourceType, url, text, ok: true, length: text.length }); }
      catch (err) { fetched.push({ sourceType, url, text: '', ok: false, error: String(err?.message || err) }); }
    }
  }

  const out = {
    updated: now.toISOString(),
    generatedBy: 'scripts/update_player_status_from_teamlists.mjs',
    currentRound,
    rules: {
      noHardCodedPlayers: true,
      currentTeamListWins: true,
      absenceFromSourceIsNotAvailable: true,
      localInjuryDataCanHoldRiskUntilTeamListClears: true,
      originIsMonitorUntilClubTeamListConfirms: true,
      staleWeakRiskDoesNotBeatNamedPlayer: true
    },
    sources: fetched.map(f => ({ source: f.sourceType, url: f.url, ok: f.ok, length: f.length || 0, error: f.error })),
    players: {}
  };

  for (const player of players) {
    const evidences = [];
    for (const f of fetched.filter(x => x.ok && x.text)) {
      const ev = sourceEvidence(f.sourceType, f.url, player.name, f.text);
      if (ev) evidences.push(ev);
    }
    out.players[player.name] = chooseStatus(player, evidences, previous.players?.[player.name], originConfig, currentRound);
  }

  const counts = Object.values(out.players).reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {});
  await writeJson('player_status.json', out);
  await writeJson('status_update_report.json', {
    updated: out.updated,
    currentRound,
    playersChecked: players.length,
    sourcesFetched: out.sources,
    counts,
    originMonitorCount: Object.values(out.players).filter(p => p.flags?.includes('origin_monitor') || p.flags?.includes('origin_back_up_monitor')).length,
    warning: 'Players not found in current sources are Unconfirmed, not automatically Available. Named/current team-list evidence clears injury/risk.'
  });

  console.log(`Updated player_status.json for ${players.length} players. Counts: ${JSON.stringify(counts)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
