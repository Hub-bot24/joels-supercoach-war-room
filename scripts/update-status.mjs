#!/usr/bin/env node
/*
  SuperCoach War Room core truth updater
  Rule #1: NO hardcoded player fixes. No one-player overrides.

  Purpose:
  - Build data/status_truth.json from source files + live source pages.
  - Current club team-list truth is required for GREEN / NAMED.
  - Previous-week data is reference only and can never create GREEN.
  - Origin is ORANGE only unless current club team list confirms named/not named.

  Outputs:
  - data/status_truth.json
  - data/current_round.json
  - data/teamlists.json
  - data/injuries.json
  - data/suspensions.json
  - data/origin.json
  - data/status_previous.json
  - data/teamlist_baseline_tuesday.json
  - data/teamlist_changes.json
  - data/notifications.json
  - data/notification_message.md when new changes are detected
*/

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const USER_AGENT = 'Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0; +https://github.com/Hub-bot24/joels-supercoach-war-room)';

const STATUS = {
  NAMED: 'NAMED',
  EXPECTED: 'EXPECTED',
  ORIGIN: 'ORIGIN',
  NOT_NAMED: 'NOT_NAMED',
  INJURED: 'INJURED',
  SUSPENDED: 'SUSPENDED',
  BYE: 'BYE'
};

const COLOUR = {
  NAMED: 'green',
  EXPECTED: 'yellow',
  ORIGIN: 'orange',
  NOT_NAMED: 'grey',
  'NOT NAMED': 'grey',
  INJURED: 'red',
  SUSPENDED: 'pink',
  BYE: 'purple'
};

const TEAM_ALIASES = {
  BRISBANE: ['BRI','BRO','BRONCOS','BRISBANE','BRISBANE BRONCOS'],
  CANBERRA: ['CBR','RAIDERS','CANBERRA RAIDERS'],
  CANTERBURY: ['CBY','BUL','BULLDOGS','CANTERBURY','CANTERBURY-BANKSTOWN'],
  CRONULLA: ['SHA','SHARKS','CRONULLA','CRONULLA-SUTHERLAND'],
  GOLDCOAST: ['GLD','TITANS','GOLD COAST','GOLD COAST TITANS'],
  MANLY: ['MAN','SEA EAGLES','MANLY','MANLY WARRINGAH'],
  MELBOURNE: ['MEL','STORM','MELBOURNE STORM'],
  NEWCASTLE: ['NEW','KNIGHTS','NEWCASTLE KNIGHTS'],
  NZWARRIORS: ['NZL','NZ','NZW','WAR','WARRIORS','NEW ZEALAND WARRIORS','NZ WARRIORS'],
  NORTHQLD: ['NQL','NQC','COW','COWBOYS','NORTH QUEENSLAND'],
  PARRAMATTA: ['PAR','EELS','PARRAMATTA EELS'],
  PENRITH: ['PEN','PANTHERS','PENRITH PANTHERS'],
  SOUTHS: ['STH','SOU','RABBITOHS','SOUTH SYDNEY','SOUTHS'],
  STGEORGE: ['SGI','DRAGONS','ST GEORGE','ST GEORGE ILLAWARRA'],
  ROOSTERS: ['SYD','SYDNEY','ROOSTERS','SYDNEY ROOSTERS'],
  DOLPHINS: ['DOL','DOLPHINS'],
  TIGERS: ['WST','Wests','TIGERS','WESTS TIGERS'],
  WARRIORS: ['WAR','NZW','WARRIORS']
};

const TEAM_CANON = Object.entries(TEAM_ALIASES).flatMap(([canon, aliases]) => aliases.map(a => [normTeam(a), canon]));
const TEAM_CANON_MAP = new Map(TEAM_CANON);

function norm(s){
  return String(s || '').toLowerCase().replace(/&amp;/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function normName(s){ return norm(s); }
function slug(s){ return norm(s).replace(/\s+/g,'-'); }
function normTeam(s){ return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g,'').trim(); }
function canonicalTeam(team){
  const t = normTeam(team);
  if(!t) return '';
  return TEAM_CANON_MAP.get(t) || t;
}
function isObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
async function ensureDir(dir){ await fs.mkdir(dir, {recursive:true}); }
async function readJson(rel, fallback=null){
  try{ return JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8')); }
  catch{ return fallback; }
}
async function writeJson(rel, data){
  const abs = path.join(ROOT, rel);
  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, JSON.stringify(data, null, 2) + '\n');
}
async function writeText(rel, text){
  const abs = path.join(ROOT, rel);
  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, text);
}
async function removeFile(rel){ try{ await fs.rm(path.join(ROOT, rel)); }catch{} }
function asArray(v){ return Array.isArray(v) ? v : (v ? [v] : []); }
function getPool(obj){
  if(!obj) return {};
  if(isObj(obj.players)) return obj.players;
  if(isObj(obj.data)) return obj.data;
  if(isObj(obj.status)) return obj.status;
  return isObj(obj) ? obj : {};
}
function findInPool(pool, player){
  if(!pool || !player) return null;
  const keys = [player.name, normName(player.name), slug(player.name), String(player.id||''), String(player.playerId||''), String(player.scId||'')].filter(Boolean);
  for(const k of keys){ if(pool[k]) return pool[k]; }
  const target = normName(player.name);
  for(const [k,v] of Object.entries(pool)){
    if(normName(k) === target) return v;
    if(isObj(v) && normName(v.name || v.player || v.playerName) === target) return v;
  }
  return null;
}
function sourceObj(type, name, url='', updatedAt=NOW_ISO){ return {type, name, url, updatedAt}; }
function playerTeam(p){ return canonicalTeam(p.team || p.club || p.squad || ''); }
function playerByeRounds(p){
  const raw = p.bye ?? p.byes ?? p.byeRounds ?? [];
  if(Array.isArray(raw)) return raw.map(Number).filter(Boolean);
  return String(raw||'').split(/[,/\s]+/).map(Number).filter(Boolean);
}
function textOf(v){
  try{ return JSON.stringify(v || {}).toLowerCase(); }catch{ return String(v || '').toLowerCase(); }
}
function hasAny(txt, words){ return words.some(w => txt.includes(w)); }
const INJURY_WORDS = ['ruled out','injured','injury','hamstring','calf','knee','shoulder','ankle','hia','concussion','casualty ward','syndesmosis','acl','mcl','fracture','broken','pec','pectoral','adductor','quad','quadriceps','groin','neck','back','wrist','foot','toe','rib'];
const SUSPENSION_WORDS = ['suspended','suspension','judiciary','ban','banned','charge','charged','guilty plea','dangerous contact','high tackle','grade 1','grade 2','grade 3'];
function hasInjuryWords(txt){ return hasAny(txt, INJURY_WORDS); }
function hasSuspensionWords(txt){ return hasAny(txt, SUSPENSION_WORDS); }

function titleCaseWords(s){
  return String(s||'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase());
}
function firstMatchText(txt, patterns){
  for(const re of patterns){
    const m = re.exec(txt);
    if(m) return m;
  }
  return null;
}
function injuryTypeFromText(txt){
  const bodyParts = ['hamstring','calf','knee','shoulder','ankle','hia','concussion','syndesmosis','acl','mcl','fracture','broken','pec','pectoral','adductor','quad','quadriceps','groin','neck','back','wrist','foot','toe','rib'];
  const lower = String(txt||'').toLowerCase();
  const hit = bodyParts.find(w => lower.includes(w));
  return hit ? titleCaseWords(hit === 'hia' ? 'HIA' : hit) : '';
}
function injuryReturnMetaFromRecord(rec, round){
  const blob = textOf(rec);
  const directText = [rec?.reason, rec?.injury, rec?.note, rec?.details, rec?.expectedReturn, rec?.return, rec?.timeframe, rec?.expectedReturnText].filter(Boolean).join(' ');
  const txt = `${directText} ${blob}`.toLowerCase();
  const startRound = Number(rec?.injuryStartRound || rec?.startRound || rec?.round || round || 0) || Number(round || 0) || null;
  const meta = {
    injuryType: injuryTypeFromText(`${directText} ${blob}`),
    injurySourceText: rec?.source || rec?.sourceName || rec?.provider || rec?.url || '',
    injuryUpdatedAt: rec?.updatedAt || rec?.updated || rec?.lastUpdated || NOW_ISO,
    injuryStartRound: startRound,
    injuryReturnKnown: false
  };

  const weeks = firstMatchText(txt, [
    /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:weeks?|wks?)\b/i,
    /\b(\d{1,2})\s*(?:weeks?|wks?)\s*(?:-|–|to)\s*(\d{1,2})\b/i
  ]);
  if(weeks){
    let minW = Number(weeks[1]);
    let maxW = Number(weeks[2]);
    if(maxW < minW) [minW,maxW] = [maxW,minW];
    meta.injuryMinWeeks = minW;
    meta.injuryMaxWeeks = maxW;
    meta.expectedReturnText = `${minW}-${maxW} weeks`;
    meta.injuryReturnKnown = true;
    if(startRound){
      meta.injuryRedUntilRound = startRound + minW - 1;
      meta.injuryRiskUntilRound = startRound + maxW - 1;
      meta.expectedReturnRoundMin = startRound + minW;
      meta.expectedReturnRoundMax = startRound + maxW;
    }
    return meta;
  }
  const oneWeeks = firstMatchText(txt, [/\b(\d{1,2})\s*(?:weeks?|wks?)\b/i]);
  if(oneWeeks){
    const w = Number(oneWeeks[1]);
    meta.injuryMinWeeks = w;
    meta.injuryMaxWeeks = w;
    meta.expectedReturnText = `${w} week${w===1?'':'s'}`;
    meta.injuryReturnKnown = true;
    if(startRound){
      meta.injuryRedUntilRound = startRound + w - 1;
      meta.injuryRiskUntilRound = startRound + w - 1;
      meta.expectedReturnRoundMin = startRound + w;
      meta.expectedReturnRoundMax = startRound + w;
    }
    return meta;
  }
  const roundMatch = firstMatchText(txt, [/(?:round|rd|r)\s*(\d{1,2})\b/i, /\breturn\s*r\s*(\d{1,2})\b/i]);
  if(roundMatch){
    const rr = Number(roundMatch[1]);
    meta.expectedReturnText = `Round ${rr}`;
    meta.injuryReturnKnown = true;
    meta.expectedReturnRoundMin = rr;
    meta.expectedReturnRoundMax = rr;
    meta.injuryRedUntilRound = Math.max(0, rr - 1);
    meta.injuryRiskUntilRound = rr;
    return meta;
  }
  if(/\btbc\b|indefinite|unknown|no timeline|yet to be confirmed/i.test(txt)){
    meta.expectedReturnText = /indefinite/i.test(txt) ? 'Indefinite' : 'TBC';
  }
  return meta;
}
function injuryPhaseForRound(rec, round){
  const r = Number(round || 0);
  const redUntil = Number(rec?.injuryRedUntilRound || 0);
  const riskUntil = Number(rec?.injuryRiskUntilRound || 0);
  if(r && redUntil && r <= redUntil) return 'red';
  if(r && riskUntil && r <= riskUntil) return 'yellow';
  return 'red';
}
function statusFromRecord(rec){
  const blob = textOf(rec);
  const direct = String(rec?.displayStatus || rec?.status || rec?.selectionStatus || rec?.availabilityStatus || rec?.label || rec?.colour || rec?.color || '').toLowerCase();
  const reason = String(rec?.reason || rec?.injury || rec?.note || rec?.details || '').toLowerCase();
  const combo = `${direct} ${reason} ${blob}`;
  if(hasAny(combo, ['bye'])) return STATUS.BYE;
  // CORE RULE: body-part/recovery words are injury, not suspension. This prevents legacy files
  // with bad labels like "suspended" + "Calf" from creating pink cards.
  if(hasInjuryWords(combo)) return STATUS.INJURED;
  if(hasSuspensionWords(combo)) return STATUS.SUSPENDED;
  if(hasAny(combo, ['not named','not selected','omitted','cut from squad','not in team','dropped'])) return STATUS.NOT_NAMED;
  if(hasAny(combo, ['origin'])) return STATUS.ORIGIN;
  if(hasAny(combo, ['final 17','final17','named','confirmed','selected','starting','interchange','bench'])) return STATUS.NAMED;
  if(hasAny(combo, ['available','expected','likely','played last week','previous week','fit','cleared'])) return STATUS.EXPECTED;
  return '';
}
function isWeakNameFoundEvidence(rec){
  const blob = textOf(rec);
  return hasAny(blob, [
    'name found on team-list source page',
    'name found on team list source page',
    'found on team-list source page',
    'found on team list source page',
    'name found on source page',
    'name match on team-list page',
    'source page mention'
  ]);
}
function isTeamListEvidence(rec){
  const blob = textOf(rec);
  return hasAny(blob, ['teamlist','team list','team-list','final 17','final17','named in team','selected in team','tuesday team','late mail','final team','source_type":"teamlist','sourceType":"teamlist'.toLowerCase()]) || rec?.teamListLoaded === true || rec?.teamlistLoaded === true || rec?.sourceType === 'teamlist' || rec?.sourceType === 'final_team';
}
function isStrongNamedEvidence(rec){
  if(!rec || isWeakNameFoundEvidence(rec)) return false;
  const direct = String(rec.displayStatus || rec.status || rec.selectionStatus || rec.label || '').toLowerCase();
  const blob = textOf(rec);
  // GREEN/NAMED must come from explicit selection language, not generic available or a name mention.
  const explicitNamed = /\b(named|selected|final\s*17|starting|interchange|bench)\b/i.test(`${direct} ${blob}`);
  const genericOnly = /\b(available|expected|likely|fit|cleared)\b/i.test(direct) && !explicitNamed;
  return isTeamListEvidence(rec) && explicitNamed && !genericOnly;
}
function isStrongNotNamedEvidence(rec){
  if(!rec || isWeakNameFoundEvidence(rec)) return false;
  const blob = textOf(rec);
  return isTeamListEvidence(rec) && hasAny(blob, ['not named','not selected','omitted','cut from squad','not in team','dropped']);
}
function isStrongInjuryEvidence(rec){
  if(!rec) return false;
  const blob = textOf(rec);
  const officialish = /casualty|injur|club|nrl|official/i.test(blob);
  const injuryWords = hasInjuryWords(blob);
  return injuryWords && officialish;
}
function isStrongSuspensionEvidence(rec){
  if(!rec) return false;
  const blob = textOf(rec);
  const direct = String(rec.displayStatus || rec.status || rec.selectionStatus || rec.label || '').toLowerCase();
  const combo = `${direct} ${blob}`;
  // Must be an actual judiciary/suspension source, not a generic legacy status label.
  // Injury words explicitly block suspension classification.
  if(hasInjuryWords(combo)) return false;
  return hasSuspensionWords(combo) && /judiciary|suspension|suspended|ban|charge|nrl|official|match review/i.test(combo);
}
function confidenceFromSources(sources){
  const official = sources.some(s => /nrl|club|official/i.test(`${s.name} ${s.url}`));
  const count = sources.length;
  if(official || count >= 2) return 'high';
  if(count === 1) return 'medium';
  return 'low';
}
function makeStatus(displayStatus, reason, sources=[], extra={}){
  return {
    displayStatus,
    colour: COLOUR[displayStatus] || 'yellow',
    available: displayStatus === STATUS.NAMED || displayStatus === STATUS.EXPECTED || displayStatus === STATUS.ORIGIN,
    reason,
    confidence: extra.confidence || confidenceFromSources(sources),
    sources,
    updatedAt: NOW_ISO,
    ...extra
  };
}
function toPlayersArray(playersJson){
  const raw = Array.isArray(playersJson) ? playersJson : (playersJson?.players || playersJson?.data || []);
  return raw.map(x => {
    if(typeof x === 'string') return {name:x};
    const name = String(x?.name || x?.player || x?.playerName || x?.fullName || '').trim();
    return {...x, name, team:x?.team || x?.club || x?.squad || '', pos:x?.pos || x?.position || x?.positions || ''};
  }).filter(p => p.name);
}
function currentRoundFromFiles(...objs){
  const env = Number(process.env.ACTIVE_ROUND || process.env.ROUND || process.env.NRL_ROUND || 0);
  if(Number.isFinite(env) && env > 0) return {round:env, source:'env'};
  for(const obj of objs){
    const candidates = [obj?.round, obj?.activeRound, obj?.currentRound, obj?.meta?.round, obj?.meta?.activeRound];
    for(const v of candidates){ const n = Number(v); if(Number.isFinite(n) && n > 0) return {round:n, source:'file'}; }
  }
  return {round:0, source:'unknown'};
}
async function fetchText(url){
  const r = await fetch(url, {headers:{'user-agent': USER_AGENT}});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.text();
}
function extractLinks(html, baseUrl){
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m = re.exec(html))){
    let href = m[1];
    const label = stripHtml(m[2]);
    try{ href = new URL(href, baseUrl).href; }catch{}
    links.push({href, label});
  }
  return links;
}
function stripHtml(html){ return String(html || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&[a-z0-9#]+;/gi,' ').replace(/\s+/g,' ').trim(); }
function pageLooksLikeTeamList(url, text){
  const u = norm(url);
  const t = norm(text).slice(0, 30000);
  return (u.includes('team list') || u.includes('team lists') || u.includes('team-lists') || u.includes('teamlists') || t.includes('team lists') || t.includes('team list')) && (u.includes('round') || t.includes('round'));
}
function pageLooksLikeCasualty(url, text){
  const u = norm(url), t = norm(text).slice(0, 30000);
  return u.includes('casualty') || u.includes('injur') || t.includes('casualty ward') || t.includes('injury');
}
function nameRegex(name){
  const parts = String(name).trim().split(/\s+/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if(parts.length < 2) return null;
  return new RegExp(`\\b${parts.join('\\s+')}\\b`, 'i');
}
function findPlayerNamesInText(players, text){
  const out = [];
  for(const p of players){
    const re = nameRegex(p.name);
    if(re && re.test(text)) out.push(p);
  }
  return out;
}
async function discoverPages(urls, kind){
  const pages = [];
  for(const url of urls || []){
    try{
      const html = await fetchText(url);
      const text = stripHtml(html);
      if((kind === 'teamlist' && pageLooksLikeTeamList(url, text)) || (kind === 'injury' && pageLooksLikeCasualty(url, text))){
        pages.push({url, html, text, sourceName: sourceNameFromUrl(url)});
      }
      const links = extractLinks(html, url).filter(l => {
        const all = norm(`${l.href} ${l.label}`);
        if(kind === 'teamlist') return all.includes('team list') || all.includes('team lists') || all.includes('team-lists') || (all.includes('round') && all.includes('teams'));
        if(kind === 'injury') return all.includes('casualty') || all.includes('injur');
        return false;
      }).slice(0, 12);
      for(const l of links){
        try{
          const pageHtml = await fetchText(l.href);
          const pageText = stripHtml(pageHtml);
          if((kind === 'teamlist' && pageLooksLikeTeamList(l.href, pageText)) || (kind === 'injury' && pageLooksLikeCasualty(l.href, pageText))){
            pages.push({url:l.href, html:pageHtml, text:pageText, sourceName:sourceNameFromUrl(l.href)});
          }
        }catch(e){ console.warn(`[warn] Could not fetch linked ${kind} page: ${l.href} :: ${e.message}`); }
      }
    }catch(e){ console.warn(`[warn] Could not fetch ${kind} source: ${url} :: ${e.message}`); }
  }
  const seen = new Set();
  return pages.filter(p => !seen.has(p.url) && seen.add(p.url));
}
function sourceNameFromUrl(url){
  if(/nrl\.com/i.test(url)) return 'Official NRL';
  if(/zerotackle/i.test(url)) return 'Zero Tackle';
  return new URL(url).hostname.replace(/^www\./,'');
}
function teamlistSourcePriority(page){
  const url = String(page?.url || page || '').toLowerCase();
  const text = norm(String(page?.text || '')).slice(0, 20000);
  // Generic source order. No player names. Later/final club-team evidence must beat the Tuesday baseline.
  if(url.includes('updated-team-lists') || text.includes('updated team lists') || text.includes('late mail') || text.includes('final team') || text.includes('final 17') || text.includes('final 19') || text.includes('one hour') || text.includes('1 hour')) return 4;
  if(url.includes('late-mail') || text.includes('late mail')) return 3;
  if(url.includes('team-lists-round') || url.includes('round-') || text.includes('team lists')) return 2;
  return 1;
}
function sourcePriorityOf(rec){
  return Number(rec?.sourcePriority || rec?.sources?.[0]?.priority || 0) || 0;
}
function addOrMerge(map, player, statusRec){
  const key = player.name;
  const prev = map[key];
  if(!prev){ map[key] = statusRec; return; }
  const newPriority = sourcePriorityOf(statusRec);
  const oldPriority = sourcePriorityOf(prev);
  const mergedSources = [...(prev.sources||[]), ...(statusRec.sources||[])];
  if(newPriority !== oldPriority){
    if(newPriority > oldPriority) map[key] = {...prev, ...statusRec, sources: mergedSources};
    else map[key] = {...prev, sources: mergedSources};
    return;
  }
  const rank = {[STATUS.BYE]:6,[STATUS.SUSPENDED]:5,[STATUS.INJURED]:4,[STATUS.NAMED]:3,[STATUS.NOT_NAMED]:2,[STATUS.ORIGIN]:1,[STATUS.EXPECTED]:0};
  const a = rank[statusRec.displayStatus] ?? 0, b = rank[prev.displayStatus] ?? 0;
  if(a > b) map[key] = {...prev, ...statusRec, sources: mergedSources};
  else map[key] = {...prev, sources: mergedSources};
}
function fromBackupStatus(players, playerStatus, teamlistsOut, injuriesOut, suspensionsOut, round){
  const pool = getPool(playerStatus);
  let namedCount = 0, injuryCount = 0, suspensionCount = 0;
  for(const p of players){
    const rec = findInPool(pool, p);
    if(!rec) continue;
    const st = statusFromRecord(rec);
    const srcName = rec.source || rec.sourceName || rec.provider || 'Existing player_status.json updater';
    const src = sourceObj(isTeamListEvidence(rec) ? 'teamlist' : 'status', srcName, rec.sourceUrl || rec.url || 'player_status.json', rec.updatedAt || rec.updated || NOW_ISO);
    if(st === STATUS.SUSPENDED && isStrongSuspensionEvidence(rec)){
      suspensionsOut[p.name] = makeStatus(STATUS.SUSPENDED, rec.reason || rec.note || 'Suspension from reliable judiciary/suspension source status file', [src], {raw:rec});
      suspensionCount++;
    } else if(st === STATUS.INJURED && isStrongInjuryEvidence(rec)){
      injuriesOut[p.name] = makeStatus(STATUS.INJURED, rec.reason || rec.injury || rec.note || 'Injury from reliable source status file', [src], {...injuryReturnMetaFromRecord(rec, round), raw:rec});
      injuryCount++;
    } else if(st === STATUS.NAMED && isStrongNamedEvidence(rec)){
      teamlistsOut[p.name] = makeStatus(STATUS.NAMED, rec.reason || rec.note || 'Explicitly named from team-list source status file', [src], {selectionStatus:'named', team:p.team, teamCanonical:playerTeam(p), raw:rec});
      namedCount++;
    } else if(st === STATUS.NOT_NAMED && isStrongNotNamedEvidence(rec)){
      teamlistsOut[p.name] = makeStatus(STATUS.NOT_NAMED, rec.reason || rec.note || 'Explicitly not named from team-list source status file', [src], {selectionStatus:'not_named', team:p.team, teamCanonical:playerTeam(p), raw:rec});
    }
  }
  return {namedCount, injuryCount, suspensionCount};
}
function fromOriginFile(players, originJson){
  const pool = getPool(originJson);
  const out = {};
  for(const p of players){
    const rec = findInPool(pool, p);
    if(!rec) continue;
    const blob = textOf(rec);
    if(rec === true || hasAny(blob, ['origin','nsw','qld','queensland','blues','maroons','18th','19th','20th'])){
      out[p.name] = makeStatus(STATUS.ORIGIN, rec.reason || rec.note || 'Origin context source found; club team-list truth still decides named/not named', [sourceObj('origin', rec.source || 'origin_players.json', rec.url || 'origin_players.json', rec.updatedAt || rec.updated || NOW_ISO)], {raw:rec});
    }
  }
  return out;
}
function escapedRe(s){ return String(s).replace(/[.*+?^${}()|[\\]\\]/g,'\\$&'); }
function playerLookupByName(players){
  const map = new Map();
  for(const p of players){
    map.set(normName(p.name), p);
    const parts = String(p.name||'').trim().split(/\s+/);
    if(parts.length >= 2) map.set(normName(`${parts[0][0]} ${parts.slice(1).join(' ')}`), p);
  }
  return map;
}
function extractNumberedPlayers(segment){
  const clean = String(segment||'').replace(/\s+/g,' ');
  const out = [];
  // Pull true numbered team-list entries only: 1. Player Name ... 2. Next Player.
  const re = /(?:^|\s)([1-9]|1[0-9]|2[0-9])\.\s+([A-Z][A-Za-zÀ-ÿ'’.-]+(?:\s+(?:[A-Z][A-Za-zÀ-ÿ'’.-]+|[a-z]{2,})){0,4})(?=\s+(?:[1-9]|1[0-9]|2[0-9])\.|\s+(?:Coach|Analysis|Late Mail|Reserves|Interchange|Team|Ins:|Outs:|Extended|Squad|Updated)|$)/g;
  let m;
  while((m = re.exec(clean))){
    const jersey = Number(m[1]);
    const name = String(m[2]||'').replace(/\b(?:captain|coach|analysis|late|mail|reserves|interchange|updated)$/i,'').trim();
    if(name.length > 2) out.push({jersey, name});
  }
  const seen = new Set();
  return out.filter(p => {
    const k = `${p.jersey}|${normName(p.name)}`;
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function aliasPatternsForTeam(canon){
  const aliases = TEAM_ALIASES[canon] || [canon];
  return aliases.map(a => escapedRe(String(a).replace(/-/g,' '))).join('|');
}
function parseTeamSectionsFromPage(text){
  const sourceText = String(text||'').replace(/\s+/g,' ');
  const found = {};
  for(const canon of Object.keys(TEAM_ALIASES)){
    const aliases = aliasPatternsForTeam(canon);
    // Look for a team heading/label and only inspect the nearby numbered list block.
    const re = new RegExp(`(?:${aliases})(?:\\s+(?:team|line[- ]?up|squad|final team|late mail|team list))?\\s*[:\\-]?\\s*([\\s\\S]{0,4200}?)(?=(?:BRISBANE|BRONCOS|CANBERRA|RAIDERS|BULLDOGS|CANTERBURY|CRONULLA|SHARKS|TITANS|GOLD COAST|MANLY|SEA EAGLES|MELBOURNE|STORM|NEWCASTLE|KNIGHTS|WARRIORS|NORTH QUEENSLAND|COWBOYS|PARRAMATTA|EELS|PENRITH|PANTHERS|SOUTH SYDNEY|RABBITOHS|SOUTHS|DRAGONS|ROOSTERS|DOLPHINS|TIGERS)\\s+(?:team|line[- ]?up|squad|final team|late mail|team list)|$)`, 'i');
    const m = sourceText.match(re);
    if(!m) continue;
    const players = extractNumberedPlayers(m[1]);
    if(players.length >= 10) found[canon] = players;
  }
  return found;
}

function teamSegmentFromPage(text, canon){
  const sourceText = String(text||'').replace(/\s+/g,' ');
  const aliases = aliasPatternsForTeam(canon);
  const nextTeamHeading = '(?:BRISBANE|BRONCOS|CANBERRA|RAIDERS|BULLDOGS|CANTERBURY|CRONULLA|SHARKS|TITANS|GOLD COAST|MANLY|SEA EAGLES|MELBOURNE|STORM|NEWCASTLE|KNIGHTS|WARRIORS|NORTH QUEENSLAND|COWBOYS|PARRAMATTA|EELS|PENRITH|PANTHERS|SOUTH SYDNEY|RABBITOHS|SOUTHS|DRAGONS|ROOSTERS|DOLPHINS|TIGERS)';
  const re = new RegExp(`(?:${aliases})(?:\\s+(?:team|line[- ]?up|squad|final team|late mail|team list))?\\s*[:\\-]?\\s*([\\s\\S]{0,5200}?)(?=${nextTeamHeading}\\s+(?:team|line[- ]?up|squad|final team|late mail|team list)|$)`, 'i');
  const m = sourceText.match(re);
  return m ? m[1] : '';
}

function teamScopedKnownPlayerRows(players, page, teamCanon){
  const segment = teamSegmentFromPage(page.text, teamCanon);
  if(!segment) return [];
  const teamPlayers = players.filter(p => playerTeam(p) === teamCanon);
  return fromKnownPlayerJerseyPatterns(teamPlayers, {...page, text:segment}).map(r => ({...r, teamCanon}));
}


function compactTextForPlayerScan(text){
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}
function surnameKeyForName(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return normName(parts.length >= 2 ? parts.slice(1).join(' ') : String(name || ''));
}
function surnameFrequency(players){
  const m = new Map();
  for(const p of players || []){
    const k = surnameKeyForName(p.name);
    if(!k) continue;
    m.set(k, (m.get(k)||0) + 1);
  }
  return m;
}
function playerNameNearJerseyRegex(name, surnameCounts){
  const raw = String(name || '').trim();
  const full = escapedRe(raw).replace(/\s+/g, '\\s+');
  const parts = raw.split(/\s+/).filter(Boolean);
  const surnameRaw = parts.length >= 2 ? parts.slice(1).join(' ') : raw;
  const surname = escapedRe(surnameRaw).replace(/\s+/g, '\\s+');
  const surnameKey = surnameKeyForName(raw);
  const isUniqueSurname = surnameKey && (surnameCounts?.get(surnameKey) || 0) === 1;

  const labels = [
    `${full}\\s+${full}`,
    full
  ];

  // Generic initial/surname support for source pages that strip full names down to labels like:
  //   KL Iro KL Iro 4
  //   D. Watene-Zelezniak Dallin Watene-Zelezniak 2
  // Use broad 1–3 initial letters ONLY where the surname is unique in the player database.
  // This avoids dangerous B Smith-style collisions.
  if(parts.length >= 2 && isUniqueSurname){
    labels.push(`[A-Z]{1,3}\\.?\\s+${surname}`);
    labels.push(`[A-Z]{1,3}\\.?\\s+${surname}\\s+[A-Z]{1,3}\\.?\\s+${surname}`);
  } else if(parts.length >= 2){
    const firstInitial = escapedRe(parts[0][0] || '');
    labels.push(`${firstInitial}\\.?\\s+${surname}\\s+${full}`);
  }

  const playerLabel = `(?:${labels.join('|')})`;
  // Zero Tackle/NRL stripped article text can appear with jersey number before or after name.
  return new RegExp(`(?:^|\\s)([1-9]|1[0-9]|2[0-5])\\s+${playerLabel}(?=\\s|$)|(?:^|\\s)${playerLabel}\\s+([1-9]|1[0-9]|2[0-5])(?=\\s|$)`, 'i');
}
function fromKnownPlayerJerseyPatterns(players, page){
  const text = compactTextForPlayerScan(page.text);
  const rows = [];
  const surnameCounts = surnameFrequency(players);
  for(const p of players){
    const re = playerNameNearJerseyRegex(p.name, surnameCounts);
    const m = re.exec(text);
    if(!m) continue;
    const jersey = Number(m[1] || m[2]);
    if(!Number.isFinite(jersey) || jersey < 1 || jersey > 25) continue;
    rows.push({player:p, jersey});
  }
  return rows;
}

function fromFetchedTeamlists(players, pages, teamlistsOut){
  const lookup = playerLookupByName(players);
  const teamFound = new Map();
  let totalFound = 0;
  let sectionFound = 0;
  let knownPatternFound = 0;
  let pageLevelMissingCount = 0;

  for(const page of pages){
    const priority = teamlistSourcePriority(page);
    const src = sourceObj('teamlist', page.sourceName, page.url, NOW_ISO);
    src.priority = priority;
    const pageTeamCounts = new Map();
    const pageSeenByTeam = new Map();

    function markSeen(teamCanon, playerName){
      if(!pageSeenByTeam.has(teamCanon)) pageSeenByTeam.set(teamCanon, new Set());
      pageSeenByTeam.get(teamCanon).add(playerName);
    }
    function addTeamCount(teamCanon){
      pageTeamCounts.set(teamCanon, (pageTeamCounts.get(teamCanon)||0) + 1);
    }

    // Parser 1: structured team-heading numbered sections.
    const sections = parseTeamSectionsFromPage(page.text);
    for(const [teamCanon, numbered] of Object.entries(sections)){
      let matchedForTeam = 0;
      for(const row of numbered){
        const p = lookup.get(normName(row.name));
        if(!p) continue;
        if(playerTeam(p) !== teamCanon) continue;
        const status = row.jersey <= 17 ? STATUS.NAMED : STATUS.EXPECTED;
        const label = row.jersey <= 17 ? 'Named in numbered team-list final 17' : 'Named in numbered extended squad only';
        addOrMerge(teamlistsOut, p, makeStatus(status, `${label} (${page.sourceName}, jersey ${row.jersey}).`, [src], {selectionStatus: row.jersey <= 17 ? 'named' : 'extended', team:p.team, teamCanonical:teamCanon, jersey:row.jersey, sourcePriority:priority}));
        markSeen(teamCanon, p.name);
        addTeamCount(teamCanon);
        matchedForTeam++;
        totalFound++;
        sectionFound++;
      }
      if(matchedForTeam >= 10) teamFound.set(teamCanon, Math.max(teamFound.get(teamCanon)||0, matchedForTeam));
    }

    // Parser 2: team-scoped known-player + jersey-number patterns.
    // Important: never scan the whole article for every player. Some pages contain older
    // Tuesday lists, Origin mentions, share text, or other teams. A player can only be
    // matched inside that player's own club/team block. This prevents false greens from
    // stale or unrelated page mentions, without hardcoding any player.
    for(const teamCanon of Object.keys(TEAM_ALIASES)){
      const jerseyRows = teamScopedKnownPlayerRows(players, page, teamCanon);
      for(const row of jerseyRows){
        const p = row.player;
        addTeamCount(teamCanon);
        markSeen(teamCanon, p.name);
        const status = row.jersey <= 17 ? STATUS.NAMED : STATUS.EXPECTED;
        const label = row.jersey <= 17 ? 'Named in team-scoped team-list final 17' : 'Named in team-scoped extended squad only';
        addOrMerge(teamlistsOut, p, makeStatus(status, `${label} (${page.sourceName}, jersey ${row.jersey}).`, [src], {selectionStatus: row.jersey <= 17 ? 'named' : 'extended', team:p.team, teamCanonical:teamCanon, jersey:row.jersey, sourcePriority:priority}));
        totalFound++;
        knownPatternFound++;
      }
    }

    // CORE SOURCE-PRIORITY FIX:
    // If a newer updated/final/late-mail page contains a real club list (10+ players), that page is
    // the current truth for that club. Players from that club who are absent from this newer page
    // must be downgraded to NOT_NAMED at the same high priority. This lets final-team/late-mail
    // evidence override older Tuesday lists without hardcoding any player.
    for(const [teamCanon, n] of pageTeamCounts.entries()){
      if(n >= 10){
        teamFound.set(teamCanon, Math.max(teamFound.get(teamCanon)||0, n));
        const seen = pageSeenByTeam.get(teamCanon) || new Set();
        for(const p of players){
          if(playerTeam(p) !== teamCanon) continue;
          if(seen.has(p.name)) continue;
          addOrMerge(teamlistsOut, p, makeStatus(STATUS.NOT_NAMED, `Not present in higher-priority current team-list source (${page.sourceName}).`, [src], {selectionStatus:'not_named', team:p.team, teamCanonical:teamCanon, sourcePriority:priority}));
          pageLevelMissingCount++;
        }
      }
    }
  }

  // Only infer NOT_NAMED for teams where a real numbered team list was parsed.
  const loadedTeams = new Set([...teamFound.entries()].filter(([,n]) => n >= 10).map(([t]) => t));
  for(const p of players){
    const t = playerTeam(p);
    if(loadedTeams.has(t) && !teamlistsOut[p.name]){
      teamlistsOut[p.name] = makeStatus(STATUS.NOT_NAMED, 'Current club team list loaded for club and player was not in that list.', [sourceObj('teamlist','Parsed current team-list source','',NOW_ISO)], {selectionStatus:'not_named', team:p.team, teamCanonical:t, sourcePriority:1});
    }
  }
  return {totalFound, loadedTeams:[...loadedTeams], parser:'section_parser_plus_team_scoped_jersey_patterns_with_source_priority', sectionFound, knownPatternFound, pageLevelMissingCount};
}
function fromFetchedInjuries(players, pages, injuriesOut){
  let count = 0;
  for(const page of pages){
    const found = findPlayerNamesInText(players, page.text);
    for(const p of found){
      const src = sourceObj('injury', page.sourceName, page.url, NOW_ISO);
      addOrMerge(injuriesOut, p, makeStatus(STATUS.INJURED, `Name found on injury/casualty source page (${page.sourceName}).`, [src], {...injuryReturnMetaFromRecord({reason:page.text, source:page.sourceName, url:page.url, updatedAt:NOW_ISO}, null), injuryStatus:'injury_source_match', team:p.team, teamCanonical:playerTeam(p)}));
      count++;
    }
  }
  return {count};
}
function combineTruth(players, round, teamlists, injuries, suspensions, origin, existingStatus){
  const playersOut = {};
  const teamsWithLoadedList = new Set(Object.values(teamlists).map(r => r.teamCanonical).filter(Boolean));
  for(const p of players){
    const bye = playerByeRounds(p).includes(Number(round));
    const t = teamlists[p.name];
    const i = injuries[p.name];
    const s = suspensions[p.name];
    const o = origin[p.name];
    let rec;
    if(bye){
      rec = makeStatus(STATUS.BYE, `Bye round ${round}`, [sourceObj('fixture','players.json bye data','players.json')], {selectionStatus:'bye', team:p.team});
    } else if(s){
      rec = {...s, selectionStatus:'suspended'};
    } else if(i && (!t || t.displayStatus !== STATUS.NAMED)){
      const phase = injuryPhaseForRound(i, round);
      if(phase === 'yellow'){
        rec = makeStatus(STATUS.EXPECTED, `${i.reason || 'Injury return window'}; return risk${i.expectedReturnText ? ` (${i.expectedReturnText})` : ''}`, i.sources || [], {...i, displayStatus:STATUS.EXPECTED, colour:COLOUR[STATUS.EXPECTED], available:true, selectionStatus:'injury_return_risk'});
      } else {
        rec = {...i, selectionStatus:'injured'};
      }
    } else if(t){
      rec = t;
      if(i && t.displayStatus === STATUS.NAMED){
        rec = {...t, injuryNote:i.reason, injurySources:i.sources, reason:`${t.reason}; injury note: ${i.reason}`, sources:[...(t.sources||[]), ...(i.sources||[])]};
      }
      if(o && t.displayStatus === STATUS.NAMED){
        rec = {...rec, originStatus:'origin_context', reason:`${rec.reason}; Origin note present`, sources:[...(rec.sources||[]), ...(o.sources||[])]};
      }
    } else if(o){
      rec = {...o, selectionStatus:'origin_context'};
    } else {
      // Previous week/reference fallback only: never green.
      const old = findInPool(getPool(existingStatus), p);
      const oldStatus = statusFromRecord(old);
      if(oldStatus === STATUS.NOT_NAMED){
        rec = makeStatus(STATUS.NOT_NAMED, 'No current club team-list truth. Previous/source reference suggests not named.', [sourceObj('previous_week','Reference layer','player_status.json')], {selectionStatus:'previous_reference'});
      } else {
        rec = makeStatus(STATUS.EXPECTED, 'No current club team-list truth. Previous-week/reference layer only; not confirmed named.', [sourceObj('previous_week','Reference layer','player_status.json')], {selectionStatus:'expected_reference'});
      }
    }
    playersOut[p.name] = {
      ...rec,
      player: p.name,
      team: p.team || '',
      teamCanonical: playerTeam(p),
      pos: p.pos || p.position || '',
      round
    };
  }
  const teamlistsLoaded = teamsWithLoadedList.size > 0 || Object.values(teamlists).some(r => r.displayStatus === STATUS.NAMED || r.displayStatus === STATUS.NOT_NAMED);
  return {playersOut, teamlistsLoaded, teamsWithLoadedList:[...teamsWithLoadedList]};
}
function summarise(playersOut){
  const out = {NAMED:0, EXPECTED:0, ORIGIN:0, NOT_NAMED:0, INJURED:0, SUSPENDED:0, BYE:0};
  for(const r of Object.values(playersOut)) out[r.displayStatus] = (out[r.displayStatus] || 0) + 1;
  return out;
}
function changedStatus(prevPlayers, nextPlayers){
  const changes = [];
  for(const [name,next] of Object.entries(nextPlayers || {})){
    const prev = prevPlayers?.[name];
    if(!prev) continue;
    if(prev.displayStatus !== next.displayStatus){
      changes.push({player:name, team:next.team, from:prev.displayStatus, to:next.displayStatus, reason:next.reason, detectedAt:NOW_ISO, sources:next.sources || []});
    }
  }
  return changes;
}
async function main(){
  await ensureDir(DATA_DIR);
  const config = await readJson('data/source_config.json', {});
  const players = toPlayersArray(await readJson('players.json', []));
  if(!players.length) throw new Error('players.json missing or empty. Cannot build status truth.');

  const previousTruth = await readJson('data/status_truth.json', {});
  const currentRoundMeta = await readJson('data/current_round.json', {});
  const oldPlayerStatus = await readJson('player_status.json', {});
  const statusReport = await readJson('status_update_report.json', {});
  const originFile = await readJson('origin_players.json', {});
  const existingOrigin = await readJson('data/origin.json', {});

  const roundInfo = currentRoundFromFiles(process.env.ACTIVE_ROUND ? {round:process.env.ACTIVE_ROUND} : null, currentRoundMeta, previousTruth, oldPlayerStatus, statusReport);
  const round = roundInfo.round;

  const teamlists = {};
  const injuries = {};
  const suspensions = {};
  const origin = {...fromOriginFile(players, existingOrigin), ...fromOriginFile(players, originFile)};

  const backupStats = fromBackupStatus(players, oldPlayerStatus, teamlists, injuries, suspensions, round);

  // CORE FIX: direct round article URLs must be included. Previously the updater only read
  // teamlistIndexUrls, so teamlistArticleUrls in data/source_config.json were ignored and
  // data/teamlists.json stayed empty even after the config was corrected.
  const teamSourceUrls = [
    ...asArray(config.teamlistArticleUrls),
    ...asArray(config.teamlistUrls),
    ...asArray(config.lateMailUrls),
    ...asArray(config.teamlistIndexUrls)
  ].filter(Boolean);

  const teamPages = await discoverPages(teamSourceUrls, 'teamlist');
  console.log(JSON.stringify({step:'teamlist_sources', configured:teamSourceUrls.length, fetched:teamPages.length, urls:teamPages.map(p=>p.url)}, null, 2));

  const injuryPages = await discoverPages(config.casualtyWardUrls || [], 'injury');
  const fetchedTeamStats = fromFetchedTeamlists(players, teamPages, teamlists);
  const fetchedInjuryStats = fromFetchedInjuries(players, injuryPages, injuries);

  const {playersOut, teamlistsLoaded, teamsWithLoadedList} = combineTruth(players, round, teamlists, injuries, suspensions, origin, oldPlayerStatus);
  const summary = summarise(playersOut);

  const truth = {
    updated: NOW_ISO,
    round,
    roundSource: roundInfo.source,
    source: 'core truth engine - source pages + existing updater files; no hardcoded player fixes',
    teamlistsLoaded,
    teamsWithLoadedList,
    summary,
    dataHealth: {
      ok: teamlistsLoaded,
      warnings: [
        ...(round ? [] : ['Round could not be inferred. Set ACTIVE_ROUND in workflow or data/current_round.json.']),
        ...(teamlistsLoaded ? [] : ['No current team-list data was loaded. No player can be GREEN/NAMED from fallback data.']),
        ...(players.length ? [] : ['players.json empty'])
      ],
      fetchedTeamListPages: teamPages.map(p => p.url),
      fetchedInjuryPages: injuryPages.map(p => p.url),
      backupStats,
      fetchedTeamStats,
      fetchedInjuryStats,
    },
    rules: [
      'No hardcoded player fixes',
      'Current club team-list truth is required for GREEN/NAMED',
      'Previous week is reference only and can never make a player GREEN',
      'Origin is ORANGE unless club team-list truth confirms NAMED or NOT NAMED',
      'One official injury source can mark INJURED; one unofficial source only is an injury watch/reference',
      'A raw name mention on a team-list article is never enough to mark NAMED',
      'Backup player_status can support NAMED only when it contains explicit team-list selection evidence',
      'Backup player_status can support SUSPENDED only with explicit judiciary/suspension evidence',
      'Injury body-part words such as calf, shoulder, knee, HIA classify as INJURED, never SUSPENDED',
      'All not-named output must use NOT_NAMED internally, not NOT NAMED',
      'Injury windows use red through minimum weeks out, then yellow during the return-risk window until maximum weeks/round'
    ],
    players: playersOut
  };

  const prevPlayers = previousTruth?.players || {};
  const changes = changedStatus(prevPlayers, playersOut);
  const existingChanges = await readJson('data/teamlist_changes.json', []);
  const prevChangeIds = new Set(asArray(existingChanges).map(c => `${c.player}|${c.from}|${c.to}|${c.round||round}`));
  const newChanges = changes.filter(c => !prevChangeIds.has(`${c.player}|${c.from}|${c.to}|${round}`)).map(c => ({...c, round}));
  const allChanges = [...asArray(existingChanges), ...newChanges].slice(-500);

  await writeJson('data/status_previous.json', previousTruth || {});
  await writeJson('data/status_truth.json', truth);
  await writeJson('data/current_round.json', {round, phase: teamlistsLoaded ? 'teamlists_loaded' : 'waiting_for_teamlists', updated: NOW_ISO, teamlistsLoaded});
  await writeJson('data/teamlists.json', {updated: NOW_ISO, round, loaded: teamlistsLoaded, teamsWithLoadedList, players: teamlists});
  await writeJson('data/injuries.json', {updated: NOW_ISO, round, players: injuries});
  await writeJson('data/suspensions.json', {updated: NOW_ISO, round, players: suspensions});
  await writeJson('data/origin.json', {updated: NOW_ISO, round, players: origin});
  await writeJson('data/teamlist_changes.json', allChanges);
  await writeJson('data/notifications.json', {updated: NOW_ISO, round, newChanges, allChangeCount: allChanges.length});
  await writeJson(`data/history/round_${round || 'unknown'}_status.json`, truth);

  // Establish Tuesday/teamlist baseline only when real teamlist data has loaded and no baseline exists for round.
  const baseline = await readJson('data/teamlist_baseline_tuesday.json', {});
  if(teamlistsLoaded && (!baseline?.round || Number(baseline.round) !== Number(round))){
    await writeJson('data/teamlist_baseline_tuesday.json', {round, capturedAt: NOW_ISO, players: playersOut});
  }

  if(newChanges.length){
    const lines = [];
    lines.push(`# SuperCoach War Room status changes — Round ${round || 'unknown'}`);
    lines.push('');
    lines.push(`Detected: ${NOW_ISO}`);
    lines.push('');
    for(const c of newChanges.slice(0, 50)){
      lines.push(`- **${c.player}** (${c.team || 'team unknown'}): ${c.from} → ${c.to}`);
      if(c.reason) lines.push(`  - ${c.reason}`);
      const src = asArray(c.sources).map(s => s.name || s.url).filter(Boolean).join(', ');
      if(src) lines.push(`  - Source: ${src}`);
    }
    await writeText('data/notification_message.md', lines.join('\n') + '\n');
  } else {
    await removeFile('data/notification_message.md');
  }

  console.log(JSON.stringify({ok:true, round, players:players.length, teamlistsLoaded, summary, newChanges:newChanges.length, warnings:truth.dataHealth.warnings}, null, 2));
}

main().catch(err => {
  console.error('[fatal] update-status.mjs failed');
  console.error(err.stack || err.message || err);
  process.exit(1);
});
