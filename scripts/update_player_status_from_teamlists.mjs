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
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 WarRoomStatusBot/2.0 (+GitHub Actions)',
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
function hasName(text, playerName) {
  const t = ` ${norm(text)} `;
  const n = ` ${norm(playerName)} `;
  return t.includes(n);
}
function extractWindow(text, playerName, radius = 160) {
  const t = norm(text);
  const n = norm(playerName);
  const i = t.indexOf(n);
  if (i < 0) return '';
  return t.slice(Math.max(0, i - radius), Math.min(t.length, i + n.length + radius));
}
function safeStatusText(v) {
  const s = String(v ?? '').trim();
  if (!s || /^undefined$/i.test(s) || /^null$/i.test(s) || /^n\/a$/i.test(s)) return '';
  return s;
}
function collectPlayerStatusText(player) {
  const keys = [
    'status', 'availability', 'availabilityStatus', 'injuryStatus', 'injury', 'injuryNote',
    'returnRound', 'expectedReturn', 'expected_return', 'return', 'note', 'notes', 'reason',
    'comment', 'comments', 'news', 'teamNews'
  ];
  const chunks = [];
  for (const k of keys) {
    const v = player?.[k];
    if (v == null) continue;
    if (typeof v === 'object') {
      const text = safeStatusText(JSON.stringify(v));
      if (text) chunks.push(`${k}: ${text}`);
    } else {
      const text = safeStatusText(v);
      if (text) chunks.push(`${k}: ${text}`);
    }
  }
  return chunks.join(' | ');
}
function getRoundNumber(v) {
  const m = String(v || '').match(/\b(?:round|rd|r)\s*(\d{1,2})\b/i) || String(v || '').match(/\bavailable\s+(?:for|from)\s+(?:round|rd|r)?\s*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}
function evidenceFromPlayerJson(player, currentRound) {
  const text = collectPlayerStatusText(player);
  if (!text) return null;
  const lower = norm(text);

  if (/\b(available|fit|named|confirmed|playing|selected)\b/.test(lower) && !/\b(expected|return|available for round|available from round)\b/.test(lower)) {
    return null; // do not write weak available evidence from players.json
  }

  const rr = getRoundNumber(text);
  if (rr && currentRound && rr > currentRound) {
    return {
      source: 'players_json', status: 'out', confidence: 'medium', label: 'Out',
      context: text.slice(0, 300),
      reason: `players.json indicates return/available from Round ${rr}; current round is ${currentRound}.`
    };
  }

  if (/\b(out|ruled out|not playing|unavailable|rested|suspended|injured|failed fitness|withdrawn)\b/.test(lower)) {
    return { source: 'players_json', status: 'out', confidence: 'medium', label: 'Out', context: text.slice(0, 300), reason: `players.json indicates out/unavailable.` };
  }
  if (/\b(risk|monitor|doubt|doubtful|test|fitness test|late call|question mark|cloud|origin monitor|backing up)\b/.test(lower)) {
    return { source: 'players_json', status: 'risk', confidence: 'low', label: 'Monitor', context: text.slice(0, 300), reason: `players.json monitor note.` };
  }
  return null;
}
function directPlayerOutEvidence(text, playerName) {
  const n = norm(playerName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const t = norm(text);
  const hard = '(ruled out|set to miss|to miss|will miss|miss more time|miss another|out for|unavailable|rested|withdrawn|sidelined|injured|injury|calf injury|hamstring injury|mcl|acl|broken|fracture|forearm|arm|suspension|suspended)';
  const p1 = new RegExp(`${n}.{0,120}${hard}`, 'i');
  const p2 = new RegExp(`${hard}.{0,120}${n}`, 'i');
  return p1.test(t) || p2.test(t);
}
function directPlayerRiskEvidence(text, playerName) {
  const n = norm(playerName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const t = norm(text);
  const risk = '(monitor|doubt|doubtful|fitness test|late call|question mark|cloud|could miss|may miss|backing up)';
  const p1 = new RegExp(`${n}.{0,100}${risk}`, 'i');
  const p2 = new RegExp(`${risk}.{0,100}${n}`, 'i');
  return p1.test(t) || p2.test(t);
}

function timelineFromText(text, currentRound) {
  const raw = String(text || '');
  const t = norm(raw);
  let minWeeks = null;
  let maxWeeks = null;

  const wordNums = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12
  };
  function toNum(v) {
    if (v == null) return null;
    const s = String(v).toLowerCase();
    if (/^\d+$/.test(s)) return Number(s);
    return wordNums[s] ?? null;
  }
  function setRange(a, b) {
    const lo = toNum(a);
    const hi = toNum(b ?? a);
    if (!lo || !hi) return;
    minWeeks = Math.min(lo, hi);
    maxWeeks = Math.max(lo, hi);
  }

  let m = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:-|to|or)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:weeks?|rounds?)\b/i);
  if (m) setRange(m[1], m[2]);

  if (!minWeeks) {
    m = t.match(/\b(?:another|next|for|around|approximately|about|up to)?\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:weeks?|rounds?)\b/i);
    if (m) setRange(m[1], m[1]);
  }

  if (!minWeeks && /\b(month|four weeks)\b/i.test(t)) setRange(4, 4);
  if (!minWeeks && /\b(season|season ending|season-ending)\b/i.test(t)) setRange(12, 99);

  const rr = getRoundNumber(raw);
  if (rr && currentRound && rr > currentRound) {
    return {
      type: 'return_round',
      returnRound: rr,
      outUntilRound: rr - 1,
      riskUntilRound: rr + 1,
      summary: `return/available from Round ${rr}`
    };
  }

  if (!minWeeks) return null;
  const outUntilRound = currentRound ? currentRound + minWeeks - 1 : null;
  const riskUntilRound = currentRound ? currentRound + maxWeeks - 1 : null;
  const returnRound = currentRound ? currentRound + minWeeks : null;
  return {
    type: 'weeks',
    minWeeks,
    maxWeeks,
    returnRound,
    returnWindowMinRound: returnRound,
    returnWindowMaxRound: currentRound ? currentRound + maxWeeks : null,
    outUntilRound,
    riskUntilRound,
    summary: minWeeks === maxWeeks ? `${minWeeks} week injury window` : `${minWeeks}-${maxWeeks} week injury window`
  };
}
function roundStatusFromTimeline(timeline, currentRound) {
  if (!timeline || !currentRound) return 'out';
  if (timeline.outUntilRound && currentRound <= timeline.outUntilRound) return 'out';
  if (timeline.riskUntilRound && currentRound <= timeline.riskUntilRound) return 'risk';
  return 'risk';
}
function attachTimeline(evidence, timeline, currentRound) {
  if (!timeline) return evidence;
  const status = roundStatusFromTimeline(timeline, currentRound);
  return {
    ...evidence,
    status,
    label: status === 'out' ? 'Out' : 'Monitor',
    timeline,
    returnWindow: timeline,
    returnRound: timeline.returnRound,
    returnWindowMinRound: timeline.returnWindowMinRound || timeline.returnRound,
    returnWindowMaxRound: timeline.returnWindowMaxRound || timeline.riskUntilRound,
    reason: `${evidence.reason || 'Injury evidence.'} ${timeline.summary}; out through R${timeline.outUntilRound ?? '?'}, risk through R${timeline.riskUntilRound ?? '?'}.`
  };
}

function evidenceFromSource(sourceType, url, player, text, currentRound) {
  if (!hasName(text, player.name)) return null;
  const context = extractWindow(text, player.name, 220).slice(0, 360);

  if (sourceType === 'official_team_list') {
    // Official team-list article presence is strong named evidence only when source is valid.
    return { source: sourceType, url, status: 'available', confidence: 'high', label: 'Named', context, reason: 'Named/seen in official team-list source.' };
  }

  if (sourceType === 'late_mail') {
    if (directPlayerOutEvidence(text, player.name)) return { source: sourceType, url, status: 'out', confidence: 'high', label: 'Out', context, reason: 'Late mail indicates out/rested/unavailable.' };
    if (directPlayerRiskEvidence(text, player.name)) return { source: sourceType, url, status: 'risk', confidence: 'medium', label: 'Monitor', context, reason: 'Late mail indicates monitor/risk.' };
    return null;
  }

  if (sourceType === 'injury_source') {
    if (directPlayerOutEvidence(text, player.name)) {
      const timeline = timelineFromText(context || text, currentRound);
      return attachTimeline({ source: sourceType, url, status: 'out', confidence: 'high', label: 'Out', context, reason: 'Injury source indicates out/injured/unavailable.' }, timeline, currentRound);
    }
    if (directPlayerRiskEvidence(text, player.name)) {
      const timeline = timelineFromText(context || text, currentRound);
      return attachTimeline({ source: sourceType, url, status: 'risk', confidence: 'medium', label: 'Monitor', context, reason: 'Injury source indicates monitor/risk.' }, timeline, currentRound);
    }
    return null;
  }

  if (sourceType === 'origin_squad') {
    return { source: sourceType, url, status: 'risk', confidence: 'medium', label: 'Origin monitor', context, reason: 'Seen in Origin source; club team list must confirm availability.' };
  }

  return null;
}
function originManualEvidence(player, originConfig, currentRound) {
  const manual = originConfig.players?.[player.name] || originConfig.players?.[slug(player.name)];
  if (!manual) return null;
  const status = safeStatusText(manual.status || manual.note || manual.reason || 'origin monitor');
  if (/not selected|removed|unavailable/i.test(status)) return null;
  return { source: 'origin_players_json', status: 'risk', confidence: 'medium', label: 'Origin monitor', context: status, reason: 'Manual Origin list monitor; club team list must confirm availability.' };
}
function chooseStatus(evidences) {
  const named = evidences.find(e => e.status === 'available' && e.confidence === 'high');
  if (named) return { status: 'available', label: 'Available', sourceConfidence: 'high', reason: named.reason, sources: [named] };

  const hardOut = evidences.find(e => e.status === 'out' && e.confidence === 'high') || evidences.find(e => e.status === 'out');
  if (hardOut) return { status: hardOut.status || 'out', label: hardOut.label || 'Out', sourceConfidence: hardOut.confidence || 'medium', reason: hardOut.reason || 'Out/unavailable evidence.', sources: [hardOut], timeline: hardOut.timeline, returnWindow: hardOut.returnWindow, returnRound: hardOut.returnRound, returnWindowMinRound: hardOut.returnWindowMinRound, returnWindowMaxRound: hardOut.returnWindowMaxRound };

  const risk = evidences.find(e => e.status === 'risk');
  if (risk) return { status: risk.status || 'risk', label: risk.label || 'Monitor', sourceConfidence: risk.confidence || 'medium', reason: risk.reason || 'Risk/monitor evidence.', sources: [risk], timeline: risk.timeline, returnWindow: risk.returnWindow, returnRound: risk.returnRound, returnWindowMinRound: risk.returnWindowMinRound, returnWindowMaxRound: risk.returnWindowMaxRound };

  return null;
}
async function main() {
  const players = parsePlayers(await readJson('players.json', []));
  const previous = await readJson('player_status.json', { players: {} });
  const sourceConfig = await readJson('teamlist_sources.json', {});
  const originConfig = await readJson('origin_players.json', { players: {} });
  const currentRound = Number(sourceConfig.currentRound || 15);
  const minLen = Number(sourceConfig.minimumValidSourceLength || 1000);

  const groups = [
    ['official_team_list', sourceConfig.teamListUrls || []],
    ['late_mail', sourceConfig.lateMailUrls || []],
    ['injury_source', sourceConfig.injuryUrls || []],
    ['origin_squad', sourceConfig.originUrls || []]
  ];

  const fetched = [];
  for (const [sourceType, urls] of groups) {
    for (const url of urls) {
      try {
        const text = await fetchText(url);
        const valid = text.length >= minLen;
        fetched.push({ sourceType, source: sourceType, url, ok: valid, text: valid ? text : '', length: text.length, error: valid ? undefined : 'invalid/too-short source text' });
      } catch (err) {
        fetched.push({ sourceType, source: sourceType, url, ok: false, text: '', length: 0, error: String(err?.message || err) });
      }
    }
  }

  const warnings = [];
  if (!fetched.some(f => f.sourceType === 'official_team_list' && f.ok)) warnings.push('No valid official team-list source fetched. Named-player confidence is limited.');
  if (!fetched.some(f => f.sourceType === 'injury_source' && f.ok)) warnings.push('No valid injury source fetched. Injury/out confidence is limited.');

  const out = {
    updated: nowIso,
    currentRound,
    generatedBy: 'scripts/update_player_status_from_teamlists.mjs',
    mode: 'fail_safe_sparse_evidence_only',
    rules: {
      noHardCodedPlayers: true,
      noSourceDoesNotMeanAvailable: true,
      emptySourcesDoNotOverwriteAllAvailable: true,
      onlyWritePlayersWithEvidence: true,
      officialTeamListWins: true,
      injuriesCarryUntilNamed: true,
      originIsMonitorUntilClubListConfirms: true,
      injuryTimelineWindows: 'min weeks out, max weeks risk'
    },
    sources: fetched.map(f => ({ source: f.sourceType, url: f.url, ok: f.ok, length: f.length || 0, error: f.error })),
    players: {}
  };

  // Preserve previous hard evidence first so a temporarily failed source does not erase injuries.
  for (const [name, prev] of Object.entries(previous.players || {})) {
    if (prev && ['out', 'risk', 'rested', 'origin_monitor'].includes(String(prev.status || '').toLowerCase())) {
      out.players[name] = { ...prev, carriedForward: true, updated: prev.updated || prev.updatedAt || previous.updated || nowIso };
    }
  }

  for (const player of players) {
    const evidences = [];
    const pj = evidenceFromPlayerJson(player, currentRound);
    if (pj) evidences.push(pj);
    const originManual = originManualEvidence(player, originConfig, currentRound);
    if (originManual) evidences.push(originManual);
    for (const f of fetched.filter(x => x.ok && x.text)) {
      const ev = evidenceFromSource(f.sourceType, f.url, player, f.text, currentRound);
      if (ev) evidences.push(ev);
    }
    const chosen = chooseStatus(evidences);
    if (chosen) {
      out.players[player.name] = {
        ...chosen,
        updated: nowIso,
        sources: chosen.sources || evidences.slice(0, 2)
      };
    }
  }

  const counts = Object.values(out.players).reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {});
  const namedCount = Object.values(out.players).filter(p => p.status === 'available' && p.sourceConfidence === 'high').length;
  const evidencePlayersWritten = Object.keys(out.players).length;

  if (namedCount === 0) warnings.push('Named count is zero because official team-list sources did not fetch. This update is injury/risk evidence only.');
  if (evidencePlayersWritten < 5) warnings.push('Very low evidence count. Status output is sparse by design to avoid poisoning all players.');

  await writeJson('player_status.json', out);
  await writeJson('status_update_report.json', {
    updated: nowIso,
    currentRound,
    playersChecked: players.length,
    evidencePlayersWritten,
    namedCount,
    sourcesFetched: out.sources,
    warnings,
    counts,
    originMonitorCount: Object.values(out.players).filter(p => p.label === 'Origin monitor' || p.flags?.includes('origin_monitor')).length,
    sampleOutRisk: Object.entries(out.players).filter(([, p]) => ['out', 'risk', 'rested', 'origin_monitor'].includes(p.status)).slice(0, 20).map(([name, p]) => ({ name, status: p.status, label: p.label, reason: p.reason, timeline: p.timeline || p.returnWindow || null }))
  });

  console.log(`Updated sparse player_status.json. Players checked=${players.length}, evidence written=${evidencePlayersWritten}, counts=${JSON.stringify(counts)}`);
}

main().catch(async err => {
  const message = String(err?.stack || err?.message || err);
  console.error(message);
  try {
    await writeJson('status_update_report.json', { updated: nowIso, failed: true, error: message, note: 'Fail-safe: player_status.json was not overwritten by a crashing run.' });
  } catch {}
  process.exit(1);
});
