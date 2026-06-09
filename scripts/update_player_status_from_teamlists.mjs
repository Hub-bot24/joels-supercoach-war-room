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

function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
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
function extractWindow(text, name, radius = 140) {
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
  return /\b(out|ruled out|withdrawn|omitted|rested|failed to back up|not playing|unavailable|suspended|injured|cut from the squad|failed fitness test)\b/i.test(w);
}
function isAvailableContext(w) {
  return /\b(named|selected|will play|available|cleared|confirmed|starts|starting|returns|included|final 17|final team|to play)\b/i.test(w);
}
function isSoftRiskContext(w) {
  return /\b(doubt|doubtful|monitor|chance|test|fitness test|late call|question mark|cloud|risk|may miss|could miss|back up|backing up|origin monitor)\b/i.test(w);
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

  return { source: sourceType, url, status, confidence, label, context: window.slice(0, 260) };
}
function parsePlayers(playersJson) {
  const arr = Array.isArray(playersJson) ? playersJson : (playersJson.players || playersJson.data || []);
  return arr.map(p => {
    if (typeof p === 'string') return { name: cleanName(p) };
    return { ...p, name: cleanName(p.name || p.player || p.fullName || p.playerName) };
  }).filter(p => p.name);
}
function dateMs(v) {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
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
    if (!Number.isFinite(t)) return false;
    return nowMs >= t - before * 86400000 && nowMs <= t + after * 86400000;
  });
  return { selectedManual, inWindow, manual };
}
function chooseStatus(player, evidences, previous, originConfig) {
  const named = evidences.find(e => e.source === 'official_team_list' && e.status === 'available') || evidences.find(e => e.status === 'available' && e.confidence === 'high');
  const hardOut = evidences.find(e => e.status === 'out' && e.source !== 'origin_squad');
  const originEv = evidences.find(e => e.source === 'origin_squad');
  const risk = evidences.find(e => e.status === 'risk');
  const origin = withinOriginWindow(originConfig, player.name);

  // Absolute rule: current official club team-list evidence beats old injury/screenshot/Origin uncertainty.
  if (named) {
    const flags = [];
    if ((origin.selectedManual || originEv) && (origin.inWindow || originEv)) flags.push('origin_back_up_monitor');
    return {
      status: 'available',
      label: 'Named',
      sourceConfidence: 'high',
      updated: now.toISOString(),
      reason: flags.includes('origin_back_up_monitor')
        ? 'Named in current club/team-list source. Origin/back-up monitor only; team list wins.'
        : 'Named in current team-list source.',
      sources: [named, ...(originEv ? [originEv] : [])],
      flags
    };
  }

  if (hardOut) {
    return {
      status: 'out', label: 'Out', sourceConfidence: 'high', updated: now.toISOString(),
      reason: 'Current team-list/late-mail source indicates out/rested/unavailable.',
      sources: [hardOut]
    };
  }

  // Origin logic: only a monitor/risk when the player is selected/seen in Origin source and NOT confirmed in club team list.
  if ((origin.selectedManual || originEv) && (origin.inWindow || originEv)) {
    return {
      status: 'risk', label: 'Origin monitor', sourceConfidence: 'medium', updated: now.toISOString(),
      reason: 'Origin player not confirmed in current club team-list source. Back-up/rest risk until named/final team confirms.',
      sources: [originEv || { source: 'origin_players_json', status: 'risk', confidence: 'medium', label: 'Origin monitor', context: origin.manual?.source || '' }],
      flags: ['origin_monitor']
    };
  }

  if (risk) {
    return {
      status: 'risk', label: risk.label || 'Monitor', sourceConfidence: risk.confidence || 'low', updated: now.toISOString(),
      reason: 'Current source indicates monitor/risk. This should be overridden automatically if player is named.',
      sources: [risk]
    };
  }

  // Do not carry stale weak junk forever. If no current source says risk/out, default to available with low certainty.
  return {
    status: 'available', label: 'Available*', sourceConfidence: 'low', updated: now.toISOString(),
    reason: 'No current out/risk evidence found in configured sources. Verify if source coverage is incomplete.',
    sources: []
  };
}

async function main() {
  const players = parsePlayers(await readJson('players.json', []));
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
      try {
        const text = await fetchText(url);
        fetched.push({ sourceType, url, text, ok: true, length: text.length });
      } catch (err) {
        fetched.push({ sourceType, url, text: '', ok: false, error: String(err?.message || err) });
      }
    }
  }

  const out = {
    updated: now.toISOString(),
    generatedBy: 'scripts/update_player_status_from_teamlists.mjs',
    rules: {
      noHardCodedPlayers: true,
      currentTeamListWins: true,
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
    out.players[player.name] = chooseStatus(player, evidences, previous.players?.[player.name], originConfig);
  }

  await writeJson('player_status.json', out);
  await writeJson('status_update_report.json', {
    updated: out.updated,
    playersChecked: players.length,
    sourcesFetched: out.sources,
    counts: Object.values(out.players).reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {}),
    originMonitorCount: Object.values(out.players).filter(p => p.flags?.includes('origin_monitor') || p.flags?.includes('origin_back_up_monitor')).length
  });

  console.log(`Updated player_status.json for ${players.length} players.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
