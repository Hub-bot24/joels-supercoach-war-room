import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const now = new Date();
const nowIso = now.toISOString();

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
function slug(s) { return norm(s).replace(/[’']/g, '').replace(/\s+/g, '-'); }
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
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 WarRoomStatusBot/2.0 (+GitHub Actions; source verification)',
        'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return htmlToText(await res.text());
  } finally { clearTimeout(timeout); }
}
function parsePlayers(playersJson) {
  const arr = Array.isArray(playersJson) ? playersJson : (playersJson.players || playersJson.data || []);
  return arr.map(p => {
    if (typeof p === 'string') return { name: cleanName(p) };
    return { ...p, name: cleanName(p.name || p.player || p.fullName || p.playerName) };
  }).filter(p => p.name);
}
function hasName(text, name) {
  const nText = ` ${norm(text)} `;
  const nName = ` ${norm(name)} `;
  return nText.includes(nName);
}
function extractWindow(text, name, radius = 280) {
  const nText = norm(text);
  const nName = norm(name);
  const i = nText.indexOf(nName);
  if (i < 0) return '';
  return nText.slice(Math.max(0, i - radius), Math.min(nText.length, i + nName.length + radius));
}
function firstDefined(...vals) { return vals.find(v => v !== undefined && v !== null && String(v).trim() !== ''); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function dateMs(v) { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : NaN; }
function sourceFresh(rec, hours = 96) {
  const t = dateMs(rec?.updatedAt || rec?.updated || rec?.date || rec?.timestamp);
  return Number.isFinite(t) && (Date.now() - t) <= hours * 3600000;
}
function isBadSourceText(t) {
  const s = String(t || '').trim();
  if (s.length < 350) return true;
  if (/enable javascript|access denied|captcha|blocked|forbidden|not available/i.test(s)) return true;
  return false;
}
function detectRound(sources, fixtures) {
  const explicit = num(sources.currentRound || sources.round);
  if (explicit) return explicit;
  const matches = [];
  function walk(x) {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const r = num(x.round || x.roundNumber || x.round_number || x.scRound || x.nrlRound);
    const d = x.kickoffLocal || x.kickoff || x.date || x.matchDate || x.startTime || x.start;
    const t = dateMs(d);
    if (r && Number.isFinite(t)) matches.push({ r, t });
    Object.values(x).forEach(v => { if (v && typeof v === 'object') walk(v); });
  }
  walk(fixtures);
  matches.sort((a,b) => a.t - b.t);
  const upcoming = matches.find(m => m.t + 10 * 3600000 >= Date.now());
  return upcoming?.r || matches.at(-1)?.r || null;
}
function hardOutWords(w) {
  return /\b(out|ruled out|withdrawn|omitted|rested|failed to back up|not playing|unavailable|suspended|injured|calf strain|hamstring|acl|hia|concussion|fracture|syndesmosis|shoulder injury|knee injury|failed fitness test|set to miss|will miss|sidelined|not named)\b/i.test(w);
}
function availableWords(w) {
  return /\b(named|selected|will play|available|cleared|confirmed|starts|starting|returns|included|final 17|final team|to play|back from injury|has been named)\b/i.test(w);
}
function riskWords(w) {
  return /\b(doubt|doubtful|monitor|chance|test|fitness test|late call|question mark|cloud|risk|may miss|could miss|back up|backing up|origin monitor|races clock|uncertain|awaiting scans|will be assessed)\b/i.test(w);
}
function returnRoundFromWindow(w) {
  const m = String(w || '').match(/\b(?:round|rd|r)\s*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}
function statusFromPlayerJson(player, currentRound) {
  const raw = String(firstDefined(player.status, player.injuryStatus, player.availability, player.playerStatus, '')).toLowerCase();
  const note = String(firstDefined(player.injuryNote, player.note, player.reason, player.news, '') || '');
  const ret = num(firstDefined(player.returnWindowMinRound, player.expectedReturnRound, player.returnRound, player.availableRound));
  const combined = `${raw} ${note}`.toLowerCase();
  if (!raw && !note && !ret) return null;
  if (/\b(fit|available|confirmed|named|playing|active)\b/.test(combined) && !/\b(out|injur|suspend|rest|doubt|risk|return)\b/.test(combined)) return null;
  if (ret && currentRound && currentRound < ret) {
    return { status:'out', label:'Out', sourceConfidence:'medium', reason:`players.json return window says not expected until R${ret}.`, source:'players_json', returnRound:ret };
  }
  if (/\b(out|injured|suspended|unavailable|rested)\b/.test(combined)) {
    return { status:'out', label:/rested/.test(combined)?'Rested':'Out', sourceConfidence:'medium', reason:`players.json says ${raw || note}.`, source:'players_json', returnRound:ret || null };
  }
  if (/\b(doubtful|risk|chance|monitor|question|test|return)\b/.test(combined)) {
    return { status:'risk', label:'Monitor', sourceConfidence:'low', reason:`players.json monitor note: ${raw || note}.`, source:'players_json', returnRound:ret || null };
  }
  return null;
}
function buildEvidenceFromSource(sourceType, url, text, player, currentRound) {
  if (!hasName(text, player.name)) return null;
  const window = extractWindow(text, player.name);
  let status = 'monitor';
  let label = 'Seen';
  let confidence = 'medium';
  let reason = `Seen in ${sourceType}.`;
  const rr = returnRoundFromWindow(window);

  if (sourceType === 'official_team_list') {
    status = 'available'; label = 'Named'; confidence = 'high'; reason = 'Named in current team-list source.';
  }
  if (sourceType === 'injury_source') {
    status = 'risk'; label = 'Monitor'; confidence = 'medium'; reason = 'Seen in injury source; monitor.';
  }
  if (hardOutWords(window)) {
    status = 'out'; label = /rested/i.test(window) ? 'Rested' : 'Out'; confidence = sourceType === 'injury_source' ? 'high' : 'high'; reason = `Current source indicates out/rested/injured: ${window.slice(0,180)}...`;
  } else if (availableWords(window)) {
    status = 'available'; label = sourceType === 'origin_squad' ? 'Origin selected' : 'Named'; confidence = sourceType === 'origin_squad' ? 'medium' : 'high'; reason = sourceType === 'origin_squad' ? 'Seen in Origin source.' : 'Current source indicates named/available.';
  } else if (riskWords(window)) {
    status = 'risk'; label = sourceType === 'origin_squad' ? 'Origin monitor' : 'Monitor'; confidence = sourceType === 'official_team_list' ? 'medium' : 'medium'; reason = `Current source indicates monitor/risk: ${window.slice(0,180)}...`;
  }
  if (rr && currentRound && currentRound < rr && sourceType === 'injury_source') {
    status = 'out'; label = 'Out'; confidence = 'high'; reason = `Injury source return estimate R${rr}; current round R${currentRound}.`;
  }
  return { source: sourceType, url, status, confidence, label, reason, context: window.slice(0,320), returnRound: rr || null };
}
function withinOriginWindow(originConfig, playerName) {
  const cfg = originConfig.settings || {};
  const before = Number(cfg.riskWindowDaysBeforeOrigin ?? 7);
  const after = Number(cfg.riskWindowDaysAfterOrigin ?? 4);
  const games = Array.isArray(originConfig.originGames) ? originConfig.originGames : [];
  const manual = originConfig.players?.[playerName] || originConfig.players?.[slug(playerName)] || null;
  const selectedManual = !!manual && !/not selected|removed|unavailable/i.test(String(manual.status || ''));
  const nowMs = Date.now();
  const inWindow = games.some(g => {
    const t = dateMs(g.date || g.kickoff || g.start);
    if (!Number.isFinite(t)) return false;
    return nowMs >= t - before * 86400000 && nowMs <= t + after * 86400000;
  });
  return { selectedManual, inWindow, manual };
}
function chooseStatus(player, evidences, previous, originConfig, currentRound) {
  const named = evidences.find(e => e.source === 'official_team_list' && e.status === 'available') || evidences.find(e => e.status === 'available' && e.confidence === 'high');
  const hardOut = evidences.find(e => e.status === 'out' && e.source !== 'origin_squad');
  const originEv = evidences.find(e => e.source === 'origin_squad');
  const risk = evidences.find(e => e.status === 'risk');
  const playerJson = statusFromPlayerJson(player, currentRound);
  const origin = withinOriginWindow(originConfig, player.name);

  // Team list wins. A current named/final-team source clears stale injury/screenshot uncertainty.
  if (named) {
    const flags = [];
    if ((origin.selectedManual || originEv) && (origin.inWindow || originEv)) flags.push('origin_back_up_monitor');
    return { status:'available', label:'Named', sourceConfidence:'high', updatedAt:nowIso, reason: flags.length ? 'Named in current club/team-list source. Origin/back-up monitor only; team list wins.' : 'Named in current club/team-list source.', sources:[named, ...(originEv ? [originEv] : [])], flags };
  }

  // Real out/injury evidence wins over weak assumptions.
  if (hardOut) return { status:'out', label:hardOut.label || 'Out', sourceConfidence:'high', updatedAt:nowIso, reason:hardOut.reason || 'Current source indicates out/rested/unavailable.', sources:[hardOut] };
  if (playerJson?.status === 'out') return { ...playerJson, updatedAt:nowIso, sources:[{source:playerJson.source, status:'out', confidence:playerJson.sourceConfidence, label:playerJson.label, returnRound:playerJson.returnRound || null}] };

  // Origin is monitor only unless team list confirms named or club/late mail says rested/out.
  if ((origin.selectedManual || originEv) && (origin.inWindow || originEv)) {
    return { status:'risk', label:'Origin monitor', sourceConfidence:'medium', updatedAt:nowIso, reason:'Origin player not confirmed in current club team-list source. Back-up/rest risk until named/final team confirms.', sources:[originEv || {source:'origin_players_json', status:'risk', confidence:'medium', label:'Origin monitor', context:origin.manual?.source || ''}], flags:['origin_monitor'] };
  }
  if (risk) return { status:'risk', label:risk.label || 'Monitor', sourceConfidence:risk.confidence || 'medium', updatedAt:nowIso, reason:risk.reason || 'Current source indicates monitor/risk.', sources:[risk] };
  if (playerJson?.status === 'risk') return { ...playerJson, updatedAt:nowIso, sources:[{source:playerJson.source, status:'risk', confidence:playerJson.sourceConfidence, label:playerJson.label, returnRound:playerJson.returnRound || null}] };

  // Preserve fresh real out/risk from previous status. Do NOT preserve old generated "available 563" junk.
  if (previous && sourceFresh(previous, 168) && ['out','risk','rested','origin_monitor'].includes(String(previous.status || '').toLowerCase()) && !/no current|available\*|assumed/i.test(String(previous.reason || ''))) {
    return { ...previous, updatedAt:nowIso, carriedForward:true, reason:`Carried forward previous ${previous.status}: ${previous.reason || ''}`.trim() };
  }

  // No evidence. Return null so the output does not poison all players as available.
  return null;
}
async function main() {
  const players = parsePlayers(await readJson('players.json', []));
  const previous = await readJson('player_status.json', { players:{} });
  const sources = await readJson('teamlist_sources.json', { teamListUrls:[], lateMailUrls:[], injuryUrls:[], originUrls:[] });
  const originConfig = await readJson('origin_players.json', { settings:{}, originGames:[], players:{} });
  const fixtures = await readJson('fixtures.json', []);
  const currentRound = detectRound(sources, fixtures) || 15;

  const sourceGroups = [
    ['official_team_list', sources.teamListUrls || []],
    ['late_mail', sources.lateMailUrls || []],
    ['injury_source', sources.injuryUrls || []],
    ['origin_squad', sources.originUrls || []]
  ];

  const fetched = [];
  for (const [sourceType, urls] of sourceGroups) {
    for (const url of urls) {
      try {
        const text = await fetchText(url);
        const invalid = isBadSourceText(text);
        fetched.push({ sourceType, url, text, ok:!invalid, fetched:true, length:text.length, invalid });
      } catch (err) {
        fetched.push({ sourceType, url, text:'', ok:false, fetched:false, length:0, error:String(err?.message || err) });
      }
    }
  }

  const valid = fetched.filter(f => f.ok && f.text);
  const validTeamLists = valid.filter(f => f.sourceType === 'official_team_list');
  const validInjury = valid.filter(f => f.sourceType === 'injury_source');
  const validLateMail = valid.filter(f => f.sourceType === 'late_mail');
  const validOrigin = valid.filter(f => f.sourceType === 'origin_squad');
  const warnings = [];
  if (!validTeamLists.length) warnings.push('No valid official team-list source fetched. Named-player confidence is limited.');
  if (!validInjury.length) warnings.push('No valid injury source fetched. Injury/out detection is limited.');

  // HARD FAIL-SAFE: if every source is empty/bad, do not overwrite player_status.json.
  if (!valid.length) {
    await writeJson('status_update_report.json', {
      updated: nowIso,
      error: 'ABORTED_NO_VALID_SOURCES',
      message: 'No valid status sources fetched. player_status.json was NOT overwritten.',
      playersChecked: players.length,
      currentRound,
      sourcesFetched: fetched.map(f => ({ source:f.sourceType, url:f.url, ok:f.ok, length:f.length || 0, error:f.error || (f.invalid ? 'invalid/too-short source text' : undefined) })),
      warnings
    });
    console.error('ABORTED: no valid sources fetched. player_status.json not overwritten.');
    process.exit(1);
  }

  const out = {
    updated: nowIso,
    generatedBy: 'scripts/update_player_status_from_teamlists.mjs',
    currentRound,
    mode: 'evidence-only-fail-safe',
    rules: {
      noHardCodedPlayers:true,
      currentTeamListWins:true,
      noSourceDoesNotMeanAvailable:true,
      emptySourcesDoNotOverwrite:true,
      originIsMonitorUntilClubTeamListConfirms:true
    },
    sources: fetched.map(f => ({ source:f.sourceType, url:f.url, ok:f.ok, length:f.length || 0, error:f.error || (f.invalid ? 'invalid/too-short source text' : undefined) })),
    warnings,
    players: {}
  };

  let namedCount = 0;
  let evidenceCount = 0;
  for (const player of players) {
    const evidences = [];
    for (const f of valid) {
      const ev = buildEvidenceFromSource(f.sourceType, f.url, f.text, player, currentRound);
      if (ev) evidences.push(ev);
    }
    if (evidences.some(e => e.status === 'available' && e.confidence === 'high')) namedCount++;
    const chosen = chooseStatus(player, evidences, previous.players?.[player.name], originConfig, currentRound);
    if (chosen) {
      out.players[player.name] = chosen;
      evidenceCount++;
    }
  }

  if (validTeamLists.length && namedCount < 100) warnings.push(`Low named-player count from team-list sources (${namedCount}). Check teamlist_sources.json; source coverage may be incomplete.`);
  if (evidenceCount < 20) warnings.push(`Very low evidence count (${evidenceCount}). Status output is sparse by design to avoid poisoning all players.`);

  await writeJson('player_status.json', out);
  await writeJson('status_update_report.json', {
    updated: out.updated,
    currentRound,
    playersChecked: players.length,
    evidencePlayersWritten: Object.keys(out.players).length,
    namedCount,
    sourcesFetched: out.sources,
    warnings,
    counts: Object.values(out.players).reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {}),
    originMonitorCount: Object.values(out.players).filter(p => p.flags?.includes('origin_monitor') || p.flags?.includes('origin_back_up_monitor')).length,
    sampleOutRisk: Object.entries(out.players).filter(([,p]) => ['out','risk'].includes(p.status)).slice(0,25).map(([name,p]) => ({ name, status:p.status, label:p.label, reason:p.reason }))
  });
  console.log(`Updated player_status.json. Players checked ${players.length}; evidence statuses written ${Object.keys(out.players).length}; named ${namedCount}.`);
}
main().catch(err => { console.error(err); process.exit(1); });
