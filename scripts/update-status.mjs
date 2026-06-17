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
  - data/weather.json
  - data/official_teamlists.json
  - data/origin_unavailable.json
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
function enforceRoundContract(file, data, round, options = {}) {
  const actualRound = Number(data?.round);
  const expectedRound = Number(round);
  const allowNoRound = options.allowNoRound === true;

  if (allowNoRound && !Number.isFinite(actualRound)) return data;

  if (!Number.isFinite(expectedRound) || expectedRound <= 0) {
    return {
      updated: NOW_ISO,
      round: null,
      status: "invalid_round",
      error: `Blocked ${file}: active round is invalid`,
      games: [],
      matches: [],
      players: {},
      source: "contract_guard"
    };
  }

  if (Number.isFinite(actualRound) && actualRound === expectedRound) return data;

  return {
    updated: NOW_ISO,
    round: expectedRound,
    status: "round_mismatch_blocked",
    error: `Blocked ${file}: contract round ${data?.round ?? "unknown"} does not match active round ${expectedRound}`,
    previousRound: data?.round ?? null,
    previousUpdated: data?.updated || null,
    games: [],
    matches: [],
    players: {},
    source: "contract_guard"
  };
}
function generatedEmptyContract(extra={}){
  return {updated: NOW_ISO, round: null, ...extra, source: 'generated-empty', status: 'empty'};
}
function playersContract(round, players, source='core truth engine'){
  const hasPlayers = Object.keys(players || {}).length > 0;
  return {updated: NOW_ISO, round: round || null, players: players || {}, source: hasPlayers ? source : 'generated-empty', status: hasPlayers ? 'generated' : 'empty'};
}
function hasWeatherData(weather){
  return Boolean(weather && ((Array.isArray(weather.matches) && weather.matches.length) || (Array.isArray(weather.games) && weather.games.length) || (isObj(weather.fixtures) && Object.keys(weather.fixtures).length)));
}
function weatherRiskFromHours(hours){
  const probs = hours.map(h => Number(h.precipitation_probability)).filter(Number.isFinite);
  const rain = hours.map(h => Number(h.precipitation_mm)).filter(Number.isFinite);
  const winds = hours.map(h => Number(h.wind_speed_10m)).filter(Number.isFinite);
  const gusts = hours.map(h => Number(h.wind_gusts_10m)).filter(Number.isFinite);
  const temps = hours.map(h => Number(h.temperature_2m)).filter(Number.isFinite);
  const maxRainProbability = Math.max(0, ...probs);
  const totalGameRainMm = rain.reduce((s,n) => s + n, 0);
  const maxWindKmh = Math.max(0, ...winds);
  const maxGustKmh = Math.max(0, ...gusts);
  let score = 0;
  const reasons = [];
  if(maxRainProbability >= 70 || totalGameRainMm >= 5){ score += 45; reasons.push('high rain risk'); }
  else if(maxRainProbability >= 40 || totalGameRainMm >= 1){ score += 25; reasons.push('rain risk'); }
  if(maxGustKmh >= 45 || maxWindKmh >= 30){ score += 30; reasons.push('strong wind/gusts'); }
  else if(maxGustKmh >= 30 || maxWindKmh >= 20){ score += 15; reasons.push('moderate wind/gusts'); }
  const label = score >= 60 ? 'High' : (score >= 30 ? 'Medium' : 'Low');
  return {label, score, maxRainProbability, totalGameRainMm:Number(totalGameRainMm.toFixed(1)), maxWindKmh, maxGustKmh, avgTemp:temps.length ? Number((temps.reduce((s,n)=>s+n,0)/temps.length).toFixed(1)) : null, reasons, captainImpact: label === 'Low' ? 'Low weather risk over game window. Normal captain logic applies.' : `${label} weather risk over game window. Review outdoor captain/ceiling assumptions.`};
}
function venueMapFromJson(venuesJson){
  return new Map(asArray(venuesJson?.venues).map(v => [norm(v.venue), v]).filter(([k]) => k));
}
function datePart(localDateTime){
  return String(localDateTime || '').slice(0, 10);
}
function addMinutes(localDateTime, minutes){
  const d = new Date(String(localDateTime || ''));
  if(!Number.isFinite(d.getTime())) return '';
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().slice(0, 16);
}
async function fetchJsonUrl(url){
  return JSON.parse(await fetchText(url));
}
async function fetchOpenMeteoGameWeather(fixture, venue){
  const lat = Number(fixture.lat ?? venue?.lat);
  const lon = Number(fixture.lon ?? venue?.lon);
  const kickoffLocal = fixture.kickoffLocal || fixture.kickoff || fixture.startTime || '';
  const timezone = fixture.timezone || venue?.timezone || 'Australia/Sydney';
  if(!Number.isFinite(lat) || !Number.isFinite(lon) || !kickoffLocal) throw new Error(`missing weather coordinates or kickoff for ${fixture.match || fixture.venue || 'fixture'}`);
  const startDate = datePart(kickoffLocal);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m');
  url.searchParams.set('timezone', timezone);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', startDate);
  const data = await fetchJsonUrl(url.href);
  const hourly = data?.hourly || {};
  const times = hourly.time || [];
  const from = addMinutes(kickoffLocal, -30);
  const to = addMinutes(kickoffLocal, 110);
  const gameWindowWeather = times.map((time, i) => ({time, phase: i === 0 ? 'pre_game' : 'game_window', temperature_2m:hourly.temperature_2m?.[i], precipitation_probability:hourly.precipitation_probability?.[i], precipitation_mm:hourly.precipitation?.[i], wind_speed_10m:hourly.wind_speed_10m?.[i], wind_gusts_10m:hourly.wind_gusts_10m?.[i]})).filter(h => h.time >= from && h.time <= to);
  if(!gameWindowWeather.length) throw new Error(`no hourly weather returned for ${fixture.match || fixture.venue || 'fixture'}`);
  return {...fixture, city:fixture.city || venue?.city || '', lat, lon, timezone, weatherStatus:'updated', gameWindow:{from, to, gameMinutes:110}, gameWindowWeather, weatherRisk:weatherRiskFromHours(gameWindowWeather)};
}
async function generateFreshWeatherContract(round){
  const fixturesJson = await readJson('fixtures.json', {});
  const venuesJson = await readJson('venues.json', {});
  const venues = venueMapFromJson(venuesJson);
  const fixtures = asArray(fixturesJson.fixtures).filter(f => Number(f.round) === Number(round) && (f.kickoffLocal || f.kickoff || f.startTime));
  if(!round) throw new Error('active round unavailable for weather generation');
  if(!fixtures.length) throw new Error(`no fixtures with kickoff times found for round ${round}`);
  const matches = [];
  const failures = [];
  for(const fixture of fixtures){
    const venue = venues.get(norm(fixture.venue));
    try{
      matches.push(await fetchOpenMeteoGameWeather(fixture, venue));
    }catch(e){
      failures.push({match:fixture.match || '', venue:fixture.venue || '', reason:e.message});
      matches.push({...fixture, weatherStatus:'source_failed', gameWindowWeather:[], weatherRisk:{score:0,label:'Unknown',reasons:[e.message]}});
    }
  }
  if(!matches.some(m => Array.isArray(m.gameWindowWeather) && m.gameWindowWeather.length)) throw new Error(`fresh weather failed for all round ${round} fixtures`);
  return {updated: NOW_ISO, round, source:'Open-Meteo hourly forecast API', status:'fresh', note:'Weather covers pre-game through full game window. Forecast updates when workflow runs.', fixtures:{}, games:matches, matches, failures};
}
function sameRoundWeather(weather, round){
  return Number(weather?.round) === Number(round);
}
function unavailableWeather(round, staleReason, oldWeather=null){
  return {updated: NOW_ISO, round: round || null, fixtures:{}, games:[], matches:[], source:'generated-weather-contract', status: oldWeather ? 'stale' : 'unavailable', staleReason, previousRound: oldWeather?.round ?? null, previousUpdated: oldWeather?.updated || null};
}
function staleWeather(weather, round, staleReason, fallbackSource){
  return {...weather, updated:weather.updated || NOW_ISO, round, source:weather.source || fallbackSource, status:'stale', staleReason};
}
async function weatherContract(round){
  let freshError = null;
  try{
    const freshWeather = await generateFreshWeatherContract(round);
    if(!sameRoundWeather(freshWeather, round)) return unavailableWeather(round, `fresh weather round ${freshWeather?.round ?? 'unknown'} did not match active round ${round}`);
    return freshWeather;
  }catch(e){
    freshError = e;
  }
  const dataWeather = await readJson('data/weather.json', null);
  if(hasWeatherData(dataWeather)){
    if(sameRoundWeather(dataWeather, round)) return staleWeather(dataWeather, round, freshError.message, 'data/weather.json');
    return unavailableWeather(round, freshError.message, dataWeather);
  }
  const rootWeather = await readJson('weather.json', null);
  if(hasWeatherData(rootWeather)){
    if(sameRoundWeather(rootWeather, round)) return staleWeather(rootWeather, round, freshError.message, 'weather.json');
    return unavailableWeather(round, freshError.message, rootWeather);
  }
  return unavailableWeather(round, freshError?.message || 'weather generation unavailable and no previous weather file exists');
}
function appDataContractDefaults(){
  return {
    officialTeamlists: generatedEmptyContract({teamlistsLoaded:false, teams:{}, players:{}}),
    originUnavailable: generatedEmptyContract({players:{}}),
    injuries: generatedEmptyContract({players:{}}),
    suspensions: generatedEmptyContract({players:{}})
  };
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

function suspensionMetaFromRecord(rec, round){
  const blob = textOf(rec);
  const directText = [rec?.reason, rec?.note, rec?.details, rec?.suspension, rec?.suspensionText, rec?.duration, rec?.expectedReturn, rec?.return, rec?.timeframe, rec?.expectedReturnText].filter(Boolean).join(' ');
  const txt = `${directText} ${blob}`.toLowerCase();
  const startRound = Number(rec?.suspensionStartRound || rec?.startRound || rec?.round || round || 0) || Number(round || 0) || null;
  const meta = {
    suspensionSourceText: rec?.source || rec?.sourceName || rec?.provider || rec?.url || '',
    suspensionUpdatedAt: rec?.updatedAt || rec?.updated || rec?.lastUpdated || NOW_ISO,
    suspensionStartRound: startRound,
    suspensionReturnKnown: false
  };

  const matchCount = firstMatchText(txt, [
    /\b(\d{1,2})\s*(?:match|matches|game|games)\b/i,
    /\b(?:suspended|suspension|ban|banned)\s*(?:for)?\s*(\d{1,2})\b/i
  ]);
  if(matchCount){
    const n = Number(matchCount[1]);
    meta.suspensionMatches = n;
    meta.suspensionReturnKnown = true;
    meta.expectedReturnText = `${n} match${n===1?'':'es'}`;
    if(startRound){
      meta.suspensionEndRound = startRound + n - 1;
      meta.expectedReturnRoundMin = startRound + n;
      meta.expectedReturnRoundMax = startRound + n;
    }
    return meta;
  }

  const weekCount = firstMatchText(txt, [/\b(\d{1,2})\s*(?:week|weeks|wks?)\b/i]);
  if(weekCount){
    const n = Number(weekCount[1]);
    meta.suspensionWeeks = n;
    meta.suspensionReturnKnown = true;
    meta.expectedReturnText = `${n} week${n===1?'':'s'}`;
    if(startRound){
      meta.suspensionEndRound = startRound + n - 1;
      meta.expectedReturnRoundMin = startRound + n;
      meta.expectedReturnRoundMax = startRound + n;
    }
    return meta;
  }

  const roundMatch = firstMatchText(txt, [/(?:round|rd|r)\s*(\d{1,2})\b/i, /\breturn\s*r\s*(\d{1,2})\b/i]);
  if(roundMatch){
    const rr = Number(roundMatch[1]);
    meta.expectedReturnText = `Round ${rr}`;
    meta.suspensionReturnKnown = true;
    meta.expectedReturnRoundMin = rr;
    meta.expectedReturnRoundMax = rr;
    meta.suspensionEndRound = Math.max(0, rr - 1);
    return meta;
  }

  if(/\btbc\b|indefinite|unknown|no timeline|yet to be confirmed/i.test(txt)){
    meta.expectedReturnText = /indefinite/i.test(txt) ? 'Indefinite' : 'TBC';
  }

  // Safety rule: if a suspension source gives no duration, do not poison future rounds forever.
  // Mark the current round only; a later source/run can extend it when duration becomes available.
  if(startRound){
    meta.suspensionEndRound = startRound;
  }
  return meta;
}
function suspensionPhaseForRound(rec, round){
  const r = Number(round || 0);
  const start = Number(rec?.suspensionStartRound || rec?.round || 0);
  const end = Number(rec?.suspensionEndRound || 0);
  if(!r) return '';
  if(start && r < start) return '';
  if(end && r <= end) return 'pink';
  if(!end && String(rec?.displayStatus || '').toUpperCase() === STATUS.SUSPENDED && (!start || r === start)) return 'pink';
  return '';
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
function fixtureRoundFromDate(fixturesJson, now=NOW){
  const fixtures = asArray(fixturesJson?.fixtures).map(f => ({...f, round:Number(f.round), kickoff:f.kickoffLocal || f.kickoff || f.startTime || ''})).filter(f => Number.isFinite(f.round) && f.round > 0 && f.kickoff);
  const upcoming = fixtures.map(f => ({...f, time:new Date(f.kickoff)})).filter(f => Number.isFinite(f.time.getTime()) && f.time.getTime() >= now.getTime()).sort((a,b) => a.time - b.time);
  if(upcoming.length) return {round:upcoming[0].round, source:'fixtures'};
  const past = fixtures.map(f => ({...f, time:new Date(f.kickoff)})).filter(f => Number.isFinite(f.time.getTime()) && f.time.getTime() < now.getTime()).sort((a,b) => b.time - a.time);
  return past.length ? {round:past[0].round, source:'fixtures'} : {round:0, source:'unknown'};
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
function roundNumbersFromUrlText(text){
  return [...String(text || '').matchAll(/(?:^|[^a-z])round[-\s]*(\d{1,2})(?:[^a-z]|$)/gi)].map(m => Number(m[1])).filter(Number.isFinite);
}
function teamlistPageRoundNumbers(page){
  const urlRounds = roundNumbersFromUrlText(page?.url || '');
  if(urlRounds.length) return urlRounds;
  return roundNumbersFromUrlText(String(page?.text || '').slice(0, 30000));
}
function detectedTeamlistRound(pages){
  const rounds = (pages || []).flatMap(teamlistPageRoundNumbers).filter(n => Number.isFinite(n) && n > 0);
  return rounds.length ? Math.max(...rounds) : 0;
}
function filterTeamPagesForRound(pages, round){
  if(!Number(round)) return {used:pages || [], rejected:[]};
  const used = [];
  const rejected = [];
  for(const page of pages || []){
    const rounds = teamlistPageRoundNumbers(page);
    if(rounds.length && !rounds.includes(Number(round))) rejected.push({url:page.url, rounds, reason:'wrong_round_page'});
    else used.push(page);
  }
  return {used, rejected};
}
function rejectTeamlistCandidateLink(href, label, activeRound){
  const raw = String(href || '').trim();
  if(!raw || /^#?$|#respond|#comment/i.test(raw)) return 'anchor_or_comment_link';
  if(/^(mailto:|tel:|sms:|javascript:)/i.test(raw) || /whatsapp/i.test(raw)) return 'non_http_or_share_link';
  let u;
  try{ u = new URL(raw); }catch{ return 'invalid_url'; }
  if(u.hash) return 'anchor_or_fragment_link';
  if(!['http:', 'https:'].includes(u.protocol)) return 'non_http_or_share_link';
  const lower = u.href.toLowerCase();
  const haystack = norm(`${u.hostname} ${u.pathname} ${label}`);
  if(/twitter\.com|x\.com|facebook\.com\/sharer|reddit\.com\/submit|whatsapp|mailto:/i.test(lower)) return 'social_or_share_link';
  if(/\/wp-login|\/login|\/account|my-account/i.test(lower)) return 'login_or_account_page';
  if(/\bstate of origin\b|\borigin\b|\bgame [123]\b/.test(haystack)) return 'origin_page';
  if(/\brumou?r\b|\brumours\b|\bsigning\b|\bsignings\b|\bcontract\b|\btransfer\b|\bsquad tracker\b|\bbest 17\b/.test(haystack)) return 'non_teamlist_news_page';
  if(Number(activeRound)){
    const rounds = roundNumbersFromUrlText(haystack);
    if(rounds.some(r => r < Number(activeRound))) return 'older_round_url';
    if(rounds.some(r => r > Number(activeRound))) return 'future_round_url';
    const isTeamlist = haystack.includes('team list') || haystack.includes('team lists') || haystack.includes('teamlists') || haystack.includes('team');
    const isLateMail = haystack.includes('late mail') || haystack.includes('updated team lists');
    if((isTeamlist || isLateMail) && rounds.length && !rounds.includes(Number(activeRound))) return 'wrong_round_url';
  }
  return '';
}
function normalizedTeamPageUrl(url){
  try{
    const u = new URL(url);
    if(u.hash) return '';
    if((u.pathname === '/' || u.pathname === '') && !u.search) return '';
    u.hash = '';
    u.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    return u.href;
  }catch{
    return '';
  }
}
function teamPageDedupeKey(url){
  const cleanUrl = normalizedTeamPageUrl(url);
  if(!cleanUrl) return '';
  try{
    const u = new URL(cleanUrl);
    const finalId = u.pathname.match(/(\d+)(?:\/)?$/)?.[1];
    if(/(^|\.)zerotackle\.com$/i.test(u.hostname) && finalId) return `zerotackle.com:${finalId}`;
  }catch{}
  return cleanUrl;
}
function cleanTeamPages(pages){
  const seen = new Set();
  const out = [];
  for(const page of pages || []){
    const cleanUrl = normalizedTeamPageUrl(page?.url);
    const key = teamPageDedupeKey(cleanUrl);
    if(!cleanUrl || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({...page, url:cleanUrl});
  }
  return out;
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
async function discoverPages(urls, kind, activeRound=0){
  const pages = [];
  for(const url of urls || []){
    try{
      const html = await fetchText(url);
      const text = stripHtml(html);
      if((kind === 'teamlist' && pageLooksLikeTeamList(url, text)) || (kind === 'injury' && pageLooksLikeCasualty(url, text))){
        pages.push({url, html, text, sourceName: sourceNameFromUrl(url)});
      }
      const links = extractLinks(html, url).filter(l => {
        if(kind === 'teamlist' && rejectTeamlistCandidateLink(l.href, l.label, activeRound)) return false;
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
  // Generic source order. No player names. Later/final club-team evidence must beat the Tuesday baseline.
  // IMPORTANT: priority must be URL/type driven. The original Tuesday NRL article can contain words
  // like "late mail" in its body/sidebar, but that must not promote it above updated/final pages.
  if(url.includes('updated-team-lists')) return 4;
  if(url.includes('late-mail')) return 3;
  if(url.includes('nrl-team-lists-round') || url.includes('round-') || url.includes('team-lists')) return 2;
  return 1;
}
function allowWholeArticleJerseyScan(page){
  const url = String(page?.url || '').toLowerCase();
  // Avoid whole-page scans on the official Tuesday NRL article because it can preserve old named
  // players and mix in social/share/sidebar content. Use structured/team-block parsing there only.
  if(url.includes('nrl-team-lists-round')) return false;
  if(url.includes('updated-team-lists')) return true;
  if(url.includes('late-mail')) return true;
  // Zero Tackle round team-list pages are more regular and are still needed as a broad source,
  // but any later updated-team-list page will override them through sourcePriority.
  if(url.includes('zerotackle.com/round-') && url.includes('team-lists')) return true;
  return false;
}
function sourcePriorityOf(rec){
  return Number(rec?.sourcePriority || rec?.sources?.[0]?.priority || 0) || 0;
}
function sourceOrderOf(rec){
  return Number(rec?.sourceOrder || rec?.sources?.[0]?.order || 0) || 0;
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

  // CORE v33: when two team-list records have the same priority, the later fetched/source-ordered
  // team-list evidence wins. This prevents an older same-priority mention/duplicate article block
  // from staying green if a later current/final source moves the player to extended/not named.
  // This is generic source ordering, not a player override.
  const newOrder = sourceOrderOf(statusRec);
  const oldOrder = sourceOrderOf(prev);
  if(newOrder !== oldOrder){
    if(newOrder > oldOrder) map[key] = {...prev, ...statusRec, sources: mergedSources};
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
      suspensionsOut[p.name] = makeStatus(STATUS.SUSPENDED, rec.reason || rec.note || 'Suspension from reliable judiciary/suspension source status file', [src], {...suspensionMetaFromRecord(rec, round), raw:rec});
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
function collectJerseysNearPlayerName(text, playerName, surnameCounts){
  const rawText = compactTextForPlayerScan(text);
  const jerseys = [];

  // Parser A: strict regex against the raw stripped source text.
  const re = playerNameNearJerseyRegex(playerName, surnameCounts);
  const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while((m = globalRe.exec(rawText))){
    const jersey = Number(m[1] || m[2]);
    if(Number.isFinite(jersey) && jersey >= 1 && jersey <= 25) jerseys.push(jersey);
    if(globalRe.lastIndex === m.index) globalRe.lastIndex++;
  }

  // Parser B: normalised local-window scan.
  // CORE v32: source pages often render rows like:
  //   Full NameFull Name | 6
  //   Full Name Full Name 6
  //   6 Full Name
  // The previous template-regex accidentally used non-escaped \s in string building and could
  // miss the "name name number" pattern, leaving older 18-25 evidence in control.
  // This remains fully generic: it only reads jersey numbers immediately around that player's name.
  const nText = norm(rawText);
  const nName = normName(playerName);
  if(nName){
    let idx = 0;
    while((idx = nText.indexOf(nName, idx)) !== -1){
      const before = nText.slice(Math.max(0, idx - 90), idx).trim();
      const after = nText.slice(idx + nName.length, idx + nName.length + 140).trim();

      const beforeMatch = before.match(/(?:^|\s)([1-9]|1[0-9]|2[0-5])\s*$/);
      if(beforeMatch) jerseys.push(Number(beforeMatch[1]));

      const escapedName = nName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const afterPatterns = [
        new RegExp(`^(?:${escapedName}\\s+)?([1-9]|1[0-9]|2[0-5])(?:\\s|$)`),
        new RegExp(`^.{0,45}?(?:${escapedName}\\s+)?([1-9]|1[0-9]|2[0-5])(?:\\s|$)`)
      ];
      for(const afterRe of afterPatterns){
        const afterMatch = after.match(afterRe);
        if(afterMatch) jerseys.push(Number(afterMatch[1]));
      }

      idx += Math.max(1, nName.length);
    }
  }

  return [...new Set(jerseys)].filter(j => Number.isFinite(j) && j >= 1 && j <= 25);
}


function fromKnownPlayerJerseyPatterns(players, page){
  const rows = [];
  const surnameCounts = surnameFrequency(players);
  for(const p of players){
    // CORE v32: collect all jersey numbers from strict regex + fixed local normalised windows.
    // If a player appears as both extended and final-17 in the same updated source, final-17 wins.
    // No player names, no one-off overrides.
    const jerseys = collectJerseysNearPlayerName(page.text, p.name, surnameCounts);
    if(!jerseys.length) continue;
    const final17 = jerseys.filter(j => j <= 17).sort((a,b)=>a-b);
    const extended = jerseys.filter(j => j > 17).sort((a,b)=>a-b);
    const jersey = final17.length ? final17[0] : extended[0];
    rows.push({player:p, jersey, seenJerseys:jerseys});
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
  let pageOrder = 0;

  for(const page of pages){
    pageOrder++;
    const priority = teamlistSourcePriority(page);
    const src = sourceObj('teamlist', page.sourceName, page.url, NOW_ISO);
    src.priority = priority;
    src.order = pageOrder;
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
        addOrMerge(teamlistsOut, p, makeStatus(status, `${label} (${page.sourceName}, jersey ${row.jersey}).`, [src], {selectionStatus: row.jersey <= 17 ? 'named' : 'extended', team:p.team, teamCanonical:teamCanon, jersey:row.jersey, sourcePriority:priority, sourceOrder:pageOrder}));
        markSeen(teamCanon, p.name);
        addTeamCount(teamCanon);
        matchedForTeam++;
        totalFound++;
        sectionFound++;
      }
      if(matchedForTeam >= 10) teamFound.set(teamCanon, Math.max(teamFound.get(teamCanon)||0, matchedForTeam));
    }

    // Parser 2: generic known-player + jersey-number patterns from stripped team-list article text.
    // This is needed because some source pages render rows as "1 Player Player" or "Player Player 1" rather than "1. Player".
    // v22 guard: never whole-scan the official Tuesday NRL team-list article; that caused stale
    // Tuesday selections to stay green after late-mail changes. Updated/final pages still override
    // older pages using sourcePriority.
    if(allowWholeArticleJerseyScan(page)){
      const jerseyRows = fromKnownPlayerJerseyPatterns(players, page);
      for(const row of jerseyRows){
        const p = row.player;
        const teamCanon = playerTeam(p);
        if(!teamCanon) continue;
        addTeamCount(teamCanon);
        markSeen(teamCanon, p.name);
        const status = row.jersey <= 17 ? STATUS.NAMED : STATUS.EXPECTED;
        const label = row.jersey <= 17 ? 'Named in team-list article final 17' : 'Named in team-list article extended squad only';
        addOrMerge(teamlistsOut, p, makeStatus(status, `${label} (${page.sourceName}, jersey ${row.jersey}).`, [src], {selectionStatus: row.jersey <= 17 ? 'named' : 'extended', team:p.team, teamCanonical:teamCanon, jersey:row.jersey, sourcePriority:priority, sourceOrder:pageOrder}));
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
          addOrMerge(teamlistsOut, p, makeStatus(STATUS.NOT_NAMED, `Not present in higher-priority current team-list source (${page.sourceName}).`, [src], {selectionStatus:'not_named', team:p.team, teamCanonical:teamCanon, sourcePriority:priority, sourceOrder:pageOrder}));
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
  return {totalFound, loadedTeams:[...loadedTeams], parser:'section_parser_plus_local_window_jersey_patterns_with_source_priority_v33_latest_same_priority_wins', sectionFound, knownPatternFound, pageLevelMissingCount};
}
function localWindowAroundName(text, name, before=360, after=520){
  const src = String(text || '').replace(/\s+/g,' ');
  const re = nameRegex(name);
  if(!re) return '';
  const m = re.exec(src);
  if(!m) return '';
  const start = Math.max(0, m.index - before);
  const end = Math.min(src.length, m.index + String(m[0]).length + after);
  return src.slice(start, end);
}
function injuryWindowHasPlayerEvidence(windowText){
  const txt = String(windowText || '').toLowerCase();
  if(!hasInjuryWords(txt)) return false;
  // Do not assign a player an injury just because their name appears on a giant casualty page.
  // The injury word must be near that player, and the window must look like an injury/return row.
  return /injur|hamstring|calf|knee|shoulder|ankle|hia|concussion|groin|quad|neck|back|wrist|rib|return|round|week|tbc|indefinite|test|monitor|ruled out/i.test(txt);
}
function fromFetchedInjuries(players, pages, injuriesOut){
  let count = 0;
  let skippedBroadPageMentions = 0;
  for(const page of pages){
    const found = findPlayerNamesInText(players, page.text);
    for(const p of found){
      const window = localWindowAroundName(page.text, p.name);
      if(!injuryWindowHasPlayerEvidence(window)){
        skippedBroadPageMentions++;
        continue;
      }
      const src = sourceObj('injury', page.sourceName, page.url, NOW_ISO);
      const meta = injuryReturnMetaFromRecord({reason:window, source:page.sourceName, url:page.url, updatedAt:NOW_ISO}, null);
      addOrMerge(injuriesOut, p, makeStatus(STATUS.INJURED, `${meta.injuryType || 'Injury'} context found near player on injury/casualty source page (${page.sourceName}).`, [src], {...meta, injuryStatus:'injury_local_context_match', team:p.team, teamCanonical:playerTeam(p)}));
      count++;
    }
  }
  return {count, skippedBroadPageMentions};
}

function fromFetchedOriginContext(players, pages){
  const out = {};
  let count = 0;
  const originWords = ['origin duty','origin duties','state of origin','origin camp','origin squad','origin selection','representative duty','rep duty','unavailable due to origin','rested after origin','rested following origin'];
  for(const page of pages || []){
    const text = String(page.text || '').replace(/\s+/g,' ');
    for(const p of players){
      const re = nameRegex(p.name);
      if(!re) continue;
      const m = re.exec(text);
      if(!m) continue;
      const start = Math.max(0, m.index - 260);
      const end = Math.min(text.length, m.index + String(m[0]).length + 260);
      const window = text.slice(start, end).toLowerCase();
      if(!originWords.some(w => window.includes(w))) continue;
      const src = sourceObj('origin_context', page.sourceName, page.url, NOW_ISO);
      out[p.name] = makeStatus(STATUS.ORIGIN, `Origin/representative-duty context found in current team-list source (${page.sourceName}).`, [src], {originContextOnly:true, team:p.team, teamCanonical:playerTeam(p)});
      count++;
    }
  }
  return {players:out, count};
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
    } else if(s && suspensionPhaseForRound(s, round) === 'pink'){
      rec = {...s, selectionStatus:'suspended'};
    } else if(t){
      rec = t;
      if(i){
        const phase = injuryPhaseForRound(i, round);
        const injuryExtra = {
          injuryNote:i.reason,
          injurySources:i.sources,
          injuryType:i.injuryType,
          expectedReturnText:i.expectedReturnText,
          expectedReturnRoundMin:i.expectedReturnRoundMin,
          expectedReturnRoundMax:i.expectedReturnRoundMax,
          injuryRedUntilRound:i.injuryRedUntilRound,
          injuryRiskUntilRound:i.injuryRiskUntilRound
        };
        if(t.displayStatus === STATUS.NAMED){
          rec = {...t, ...injuryExtra, reason:`${t.reason}; injury note: ${i.reason}`, sources:[...(t.sources||[]), ...(i.sources||[])]};
        } else if(t.displayStatus === STATUS.EXPECTED){
          rec = {...t, ...injuryExtra, reason:`${t.reason}; injury note: ${i.reason}`, sources:[...(t.sources||[]), ...(i.sources||[])]};
        } else if(t.displayStatus === STATUS.NOT_NAMED){
          // Current team-list truth beats a return-risk injury note.
          // A player not in the current club list is grey, not yellow, even if an injury page says return/test this round.
          // Only a still-active red injury window can override the grey not-named status.
          if(phase === 'red'){
            rec = {...i, selectionStatus:'injured'};
          } else {
            rec = {...t, ...injuryExtra, reason:`${t.reason}; injury/return note: ${i.reason}`, sources:[...(t.sources||[]), ...(i.sources||[])]};
          }
        }
      }
    } else if(i){
      const phase = injuryPhaseForRound(i, round);
      if(phase === 'yellow' && i.injuryReturnKnown){
        rec = makeStatus(STATUS.EXPECTED, `${i.reason || 'Injury return window'}; return risk${i.expectedReturnText ? ` (${i.expectedReturnText})` : ''}`, i.sources || [], {...i, displayStatus:STATUS.EXPECTED, colour:COLOUR[STATUS.EXPECTED], available:true, selectionStatus:'injury_return_risk'});
      } else {
        rec = {...i, selectionStatus:'injured'};
      }
      if(o){
        const originReason = o.originContextOnly ? 'Origin/representative-duty context present' : 'Origin note present';
        rec = {...rec, originStatus:'origin_context', originContextOnly:!!o.originContextOnly, reason:`${rec.reason}; ${originReason}`, sources:[...(rec.sources||[]), ...(o.sources||[])]};
      }
    } else if(o && !o.originContextOnly){
      rec = {...o, selectionStatus:'origin_context'};
    } else {
      // Previous week/reference fallback only: never green.
      const old = findInPool(getPool(existingStatus), p);
      const oldStatus = statusFromRecord(old);
      if(oldStatus === STATUS.NOT_NAMED){
        rec = makeStatus(STATUS.NOT_NAMED, 'No current club team-list truth. Previous/source reference suggests not named.', [sourceObj('previous_week','Reference layer','player_status.json')], {selectionStatus:'previous_reference'});
      } else {
        // STRICT COLOUR RULE: missing/uncertain current team-list truth is NOT yellow.
        // Yellow is reserved for real extended squad (18-25) or injury return-risk windows only.
        // If we cannot confirm the current club list, show a grey data-unknown/not-confirmed state.
        rec = makeStatus(STATUS.NOT_NAMED, 'No current club team-list truth. Source missing/uncertain; not confirmed named.', [sourceObj('source_missing','Current club team-list not confirmed','data/status_truth.json')], {selectionStatus:'source_missing', dataUnknown:true});
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
  // Data contract: the browser reads generated JSON from /data, and this script owns creating it.
  // Missing or unavailable upstream sources must become valid generated JSON, not missing files.
  const contractDefaults = appDataContractDefaults();
  const config = await readJson('data/source_config.json', {});
  const players = toPlayersArray(await readJson('players.json', []));
  if(!players.length) throw new Error('players.json missing or empty. Cannot build status truth.');

  const previousTruth = await readJson('data/status_truth.json', {});
  const currentRoundMeta = await readJson('data/current_round.json', {});
  const oldPlayerStatus = await readJson('player_status.json', {});
  const statusReport = await readJson('status_update_report.json', {});
  const fixturesJson = await readJson('fixtures.json', {});
  const originFile = await readJson('origin_players.json', {});
  const existingOrigin = await readJson('data/origin.json', {});

  let roundInfo = currentRoundFromFiles(process.env.ACTIVE_ROUND ? {round:process.env.ACTIVE_ROUND} : null, currentRoundMeta);
  if(!Number(roundInfo.round)) roundInfo = fixtureRoundFromDate(fixturesJson);

  const teamlists = {};
  const injuries = {};
  const suspensions = {};
  const origin = {...fromOriginFile(players, existingOrigin), ...fromOriginFile(players, originFile)};

  // CORE FIX: direct round article URLs must be included. Previously the updater only read
  // teamlistIndexUrls, so teamlistArticleUrls in data/source_config.json were ignored and
  // data/teamlists.json stayed empty even after the config was corrected.
  const teamSourceUrls = [
    ...asArray(config.teamlistArticleUrls),
    ...asArray(config.teamlistUrls),
    ...asArray(config.lateMailUrls),
    ...asArray(config.teamlistIndexUrls)
  ].filter(Boolean);

  const discoveredTeamPages = cleanTeamPages(await discoverPages(teamSourceUrls, 'teamlist', 0));
  const detectedRound = detectedTeamlistRound(discoveredTeamPages);
  if(detectedRound) roundInfo = {round:detectedRound, source:'detected_teamlist'};
  const round = roundInfo.round;
  const filteredTeamPages = filterTeamPagesForRound(discoveredTeamPages, round);
  const teamPages = filteredTeamPages.used;
  console.log(JSON.stringify({step:'teamlist_sources', configured:teamSourceUrls.length, fetched:discoveredTeamPages.length, used:teamPages.length, detectedRound, round, urls:teamPages.map(p=>p.url), rejected:filteredTeamPages.rejected}, null, 2));

  const backupStats = fromBackupStatus(players, oldPlayerStatus, teamlists, injuries, suspensions, round);

  const injuryPages = await discoverPages(config.casualtyWardUrls || [], 'injury');
  const fetchedTeamStats = fromFetchedTeamlists(players, teamPages, teamlists);
  const fetchedInjuryStats = fromFetchedInjuries(players, injuryPages, injuries);
  const fetchedOriginContext = fromFetchedOriginContext(players, teamPages);
  Object.assign(origin, fetchedOriginContext.players);

  const {playersOut, teamlistsLoaded, teamsWithLoadedList} = combineTruth(players, round, teamlists, injuries, suspensions, origin, oldPlayerStatus);
  const summary = summarise(playersOut);
  const weather = await weatherContract(round);
  const currentRoundContract = {round, phase:teamlistsLoaded ? 'teamlists_loaded' : 'waiting_for_teamlists', updated:NOW_ISO, teamlistsLoaded, detectedRound:detectedRound || null, roundSource:roundInfo.source, status:'fresh'};
  const weatherRoundMismatch = Number(weather?.round) !== Number(round);

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
        ...(players.length ? [] : ['players.json empty']),
        ...(weatherRoundMismatch ? [`Weather round ${weather?.round ?? 'unknown'} does not match active round ${round || 'unknown'}`] : [])
      ],
      detectedRound,
      roundSource: roundInfo.source,
      fetchedTeamListPages: teamPages.map(p => p.url),
      usedTeamListPages: teamPages.map(p => p.url),
      rejectedTeamListPages: filteredTeamPages.rejected,
      fetchedInjuryPages: injuryPages.map(p => p.url),
      backupStats,
      fetchedTeamStats,
      fetchedInjuryStats,
      fetchedOriginContextStats: {count:fetchedOriginContext.count},
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
      'Team-list status is decided by source priority first, then latest source order; older 1-17 evidence must not beat newer extended/not-named evidence',
      'Suspension windows behave like injury windows in Bye Planner: pink only for suspended rounds, then clear',
      'Origin/representative-duty context can explain NOT_NAMED, but cannot make a player GREEN/NAMED by itself',
      'Yellow/EXPECTED is allowed only for real extended squad, confirmed return-risk windows, or explicit test/monitor status; missing team-list data must be grey/source_missing, not yellow',
      'Injury windows use red through minimum weeks out, then yellow during the return-risk window until maximum weeks/round',
      'Injury pages are scoped to text near the player name; a broad casualty page mention cannot create a player injury/return status',
      'Current team-list NOT_NAMED beats injury return-risk yellow unless the injury window is still red/ruled out'
    ],
    players: playersOut
  };

  const prevPlayers = previousTruth?.players || {};
  const changes = changedStatus(prevPlayers, playersOut);
  const existingChanges = await readJson('data/teamlist_changes.json', []);
  const prevChangeIds = new Set(asArray(existingChanges).map(c => `${c.player}|${c.from}|${c.to}|${c.round||round}`));
  const newChanges = changes.filter(c => !prevChangeIds.has(`${c.player}|${c.from}|${c.to}|${round}`)).map(c => ({...c, round}));
  const allChanges = [...asArray(existingChanges), ...newChanges].slice(-500);
  const roundSpecificContracts = [
    {file:'data/current_round.json', data:currentRoundContract},
    {file:'data/teamlists.json', data:{updated: NOW_ISO, round, loaded: teamlistsLoaded, teamsWithLoadedList, players: teamlists}},
    {file:'data/weather.json', data:weather},
    {file:'data/injuries.json', data:playersContract(round, injuries, 'core truth engine injuries')},
    {file:'data/suspensions.json', data:playersContract(round, suspensions, 'core truth engine suspensions')},
    {file:'data/origin.json', data:playersContract(round, origin, 'core truth engine origin context')},
    {file:'data/notifications.json', data:{updated: NOW_ISO, round, newChanges, allChangeCount: allChanges.length}}
  ].map(c => ({...c, data:enforceRoundContract(c.file, c.data, round)}));
  const guardedContracts = Object.fromEntries(roundSpecificContracts.map(c => [c.file, c.data]));
  const blockedContracts = roundSpecificContracts.filter(c => c.data?.status === 'round_mismatch_blocked' || c.data?.status === 'invalid_round');
  const baseline = await readJson('data/teamlist_baseline_tuesday.json', {});
  const nextBaseline = teamlistsLoaded && (!baseline?.round || Number(baseline.round) !== Number(round)) ? enforceRoundContract('data/teamlist_baseline_tuesday.json', {round, capturedAt: NOW_ISO, players: playersOut}, round) : null;
  const guardedWeather = guardedContracts['data/weather.json'];
  const weatherUnavailable = ['unavailable', 'stale', 'round_mismatch_blocked', 'invalid_round'].includes(String(guardedWeather?.status || '')) && !hasWeatherData(guardedWeather);
  truth.dataHealth.warnings.push(
    ...(weatherUnavailable ? [`Weather unavailable for active round ${round || 'unknown'}: ${guardedWeather?.staleReason || guardedWeather?.error || 'weather contract unavailable'}`] : []),
    ...(guardedWeather?.status === 'round_mismatch_blocked' ? [guardedWeather.error] : []),
    ...blockedContracts.filter(c => c.file !== 'data/weather.json').map(c => c.data.error).filter(Boolean)
  );

  await writeJson('data/status_previous.json', previousTruth || {});
  await writeJson('data/status_truth.json', truth);
  await writeJson('data/current_round.json', guardedContracts['data/current_round.json']);
  await writeJson('data/teamlists.json', guardedContracts['data/teamlists.json']);
  await writeJson('data/weather.json', guardedContracts['data/weather.json']);
  await writeJson('data/official_teamlists.json', contractDefaults.officialTeamlists);
  await writeJson('data/origin_unavailable.json', contractDefaults.originUnavailable);
  await writeJson('data/injuries.json', guardedContracts['data/injuries.json']);
  await writeJson('data/suspensions.json', guardedContracts['data/suspensions.json']);
  await writeJson('data/origin.json', guardedContracts['data/origin.json']);
  await writeJson('data/teamlist_changes.json', allChanges);
  await writeJson('data/notifications.json', guardedContracts['data/notifications.json']);
  await writeJson(`data/history/round_${round || 'unknown'}_status.json`, truth);

  if(nextBaseline) await writeJson('data/teamlist_baseline_tuesday.json', nextBaseline);

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
