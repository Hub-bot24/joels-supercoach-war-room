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
import { pathToFileURL } from 'node:url';

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
  CANTERBURY: ['CAN','CBY','BUL','BULLDOGS','CANTERBURY','CANTERBURY-BANKSTOWN','CANTERBURY BANKSTOWN','CANTERBURY BANKSTOWN BULLDOGS'],
  CRONULLA: ['SHA','SHARKS','CRONULLA','CRONULLA-SUTHERLAND'],
  GOLDCOAST: ['GLD','TITANS','GOLD COAST','GOLD COAST TITANS'],
  MANLY: ['MAN','SEA EAGLES','MANLY','MANLY WARRINGAH'],
  MELBOURNE: ['MEL','STORM','MELBOURNE STORM'],
  NEWCASTLE: ['NEW','NEWC','NCL','KNIGHTS','NEWCASTLE','NEWCASTLE KNIGHTS'],
  NZWARRIORS: ['NZL','NZ','NZW','WAR','WARRIORS','NEW ZEALAND WARRIORS','NZ WARRIORS'],
  NORTHQLD: ['NQL','NQC','COW','COWBOYS','NORTH QUEENSLAND'],
  PARRAMATTA: ['PAR','EELS','PARRAMATTA EELS'],
  PENRITH: ['PEN','PANTHERS','PENRITH PANTHERS'],
  SOUTHS: ['STH','SOU','RABBITOHS','SOUTH SYDNEY','SOUTHS'],
  STGEORGE: ['STG','SGI','SGD','STI','DRAGONS','ST GEORGE','ST GEORGE ILLAWARRA','ST GEORGE ILLAWARRA DRAGONS'],
  ROOSTERS: ['SYD','SYDNEY','ROOSTERS','SYDNEY ROOSTERS'],
  DOLPHINS: ['DOL','DOLPHINS'],
  TIGERS: ['WST','WTI','WES','WESTS','Wests','TIGERS','WESTS TIGERS'],
  WARRIORS: ['WAR','NZW','WARRIORS']
};

const TEAM_CANON = Object.entries(TEAM_ALIASES).flatMap(([canon, aliases]) => [[normTeam(canon), canon], ...aliases.map(a => [normTeam(a), canon])]);
const TEAM_CANON_MAP = new Map(TEAM_CANON);

function norm(s){
  return String(s || '').toLowerCase().replace(/&amp;/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function normName(s){ return norm(s); }
function slug(s){ return norm(s).replace(/\s+/g,'-'); }
function normTeam(s){ return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g,'').trim(); }
function canonicalTeam(team){
  const compact = normTeam(team);
  if(!compact) return '';

  const exact = TEAM_CANON_MAP.get(compact);
  if(exact) return exact;

  const sourceWords = norm(team);
  const paddedSource = ` ${sourceWords} `;
  const matches = [];

  for(const [canon, aliases] of Object.entries(TEAM_ALIASES)){
    for(const alias of [canon, ...aliases]){
      const aliasWords = norm(alias);

      if(aliasWords.length < 4) continue;
      if(!paddedSource.includes(` ${aliasWords} `)) continue;

      matches.push({
        canon,
        score: aliasWords.replace(/\s+/g, '').length
      });
    }
  }

  if(!matches.length) return compact;

  const strongestScore = Math.max(
    ...matches.map(match => match.score)
  );

  const strongestCanons = new Set(
    matches
      .filter(match => match.score === strongestScore)
      .map(match => match.canon)
  );

  return strongestCanons.size === 1
    ? [...strongestCanons][0]
    : compact;
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
async function readBackRoundContract(file, round, options = {}) {
  const data = await readJson(file, null);
  const expectedRound = Number(round);
  const actualRound = Number(data?.round);

  if (!Number.isFinite(expectedRound) || expectedRound <= 0) {
    throw new Error(`Invalid active round while validating ${file}: ${round}`);
  }

  if (!data || !Number.isFinite(actualRound) || actualRound !== expectedRound) {
    throw new Error(`Round contract write failed for ${file}: expected round ${expectedRound}, got ${data?.round ?? 'missing'}`);
  }

  if (file === 'data/current_round.json' && data.status !== 'fresh') {
    throw new Error(`current_round contract is not fresh after write: ${data.status ?? 'missing'}`);
  }

  if (file === 'data/weather.json' && data.status === 'fresh' && actualRound !== expectedRound) {
    throw new Error(`weather contract is falsely fresh for wrong round: ${actualRound} vs ${expectedRound}`);
  }

  return data;
}
function requireContractShape(file, data) {
  if (!data || typeof data !== 'object') {
    throw new Error(`${file}: contract is null or invalid object`);
  }

  if (file === 'data/current_round.json') {
    if (!Number(data.round)) throw new Error('current_round missing round');
    if (!data.status) throw new Error('current_round missing status');
  }

  if (file === 'data/weather.json') {
    if (!Number(data.round)) throw new Error('weather missing round');
    if (!Array.isArray(data.games)) throw new Error('weather missing games');
    if (!data.games.length) throw new Error('weather games empty');
  }

  return data;
}
function enforceRoundContract(file, data, round) {
  if (!data || Number(data.round) !== Number(round)) {
    throw new Error(`${file}: round mismatch or missing. expected ${round}, got ${data?.round}`);
  }
  return data;
}
function strictRoundContract(file, data, round) {
  return enforceRoundContract(file, requireContractShape(file, data), round);
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
  if(r && (rec?.injuryReturnKnown === true || rec?.expectedReturnRoundMin || rec?.expectedReturnRoundMax || riskUntil || redUntil)) return '';
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
function fixtureRoundFromDate(fixturesJson, now=NOW){
  const fixtures = asArray(fixturesJson?.fixtures).map(f => ({...f, round:Number(f.round), kickoff:f.kickoffLocal || f.kickoff || f.startTime || ''})).filter(f => Number.isFinite(f.round) && f.round > 0 && f.kickoff);
  const upcoming = fixtures.map(f => ({...f, time:new Date(f.kickoff)})).filter(f => Number.isFinite(f.time.getTime()) && f.time.getTime() >= now.getTime()).sort((a,b) => a.time - b.time);
  if(upcoming.length) return {round:upcoming[0].round, source:'fixtures'};
  const past = fixtures.map(f => ({...f, time:new Date(f.kickoff)})).filter(f => Number.isFinite(f.time.getTime()) && f.time.getTime() < now.getTime()).sort((a,b) => b.time - a.time);
  return past.length ? {round:past[0].round, source:'fixtures'} : {round:0, source:'unknown'};
}
function resolveActiveRound({teamlistRound, fixtureRound, storedRound, envRound}) {
  const explicit = Number(envRound);
  if(Number.isFinite(explicit) && explicit > 0) return explicit;

  const tl = Number(teamlistRound);
  const fixture = Number(fixtureRound);
  const stored = Number(storedRound);

  // Fixture round is the safest anchor. Do not let noisy news/index pages
  // jump the updater into a future round such as Round 25.
  if(Number.isFinite(fixture) && fixture > 0) {
    if(Number.isFinite(tl) && tl > 0 && Math.abs(tl - fixture) > 1) {
      console.warn(`[round-guard] Ignoring detected teamlist round ${tl}; fixture round is ${fixture}`);
    }
    return fixture;
  }

  if(Number.isFinite(stored) && stored > 0) {
    if(Number.isFinite(tl) && tl > 0 && Math.abs(tl - stored) > 1) {
      console.warn(`[round-guard] Ignoring detected teamlist round ${tl}; stored round is ${stored}`);
    }
    return stored;
  }

  if(Number.isFinite(tl) && tl > 0) return tl;

  throw new Error("No valid active round could be resolved");
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
function representativeTeamlistPageReason(pageOrUrl, label=''){
  // Reject representative/Origin pages from club team-list truth.
  // Generic rule: this blocks NSW v QLD / Blues v Maroons / Origin pages,
  // but it does not block normal club pages like Cowboys, Broncos, Dolphins, etc.
  const haystack = norm(`${typeof pageOrUrl === 'string' ? pageOrUrl : pageOrUrl?.url || ''} ${label}`);
  const isRepMatch =
    haystack.includes('state of origin') ||
    haystack.includes('origin') ||
    (haystack.includes('nsw') && haystack.includes('qld')) ||
    (haystack.includes('blues') && haystack.includes('maroons'));
  return isRepMatch ? 'origin_or_representative_page' : '';
}
function pageFixturePairKey(teams){
  return [...new Set(asArray(teams).filter(Boolean))].sort().join('|');
}
function activeFixturePairKeys(fixturesJson, round){
  const out = new Set();
  for(const f of asArray(fixturesJson?.fixtures).filter(x => Number(x.round) === Number(round))){
    const teams = fixtureTeamsFromMatchRecord(f).filter(Boolean);
    if(teams.length >= 2) out.add(pageFixturePairKey(teams.slice(0, 2)));
  }
  return out;
}
function updatedTeamlistUrlTeams(url){
  const raw = String(url || '').toLowerCase();
  if(!raw.includes('zerotackle.com/updated-team-lists')) return [];
  let pathname = '';
  try{ pathname = new URL(raw).pathname; }catch{ pathname = raw; }
  const slugPart = String(pathname || '')
    .split('/')
    .filter(Boolean)
    .pop() || '';
  const fixtureSlug = slugPart
    .replace(/^updated-team-lists-/, '')
    .replace(/-\d+(?:-\d+)*$/, '');
  return teamsFromFixtureText(fixtureSlug);
}
function filterTeamPagesForRound(pages, round, fixturesJson=null){
  if(!Number(round)) return {used:pages || [], rejected:[]};
  const used = [];
  const rejected = [];
  const activePairs = activeFixturePairKeys(fixturesJson, round);
  for(const page of pages || []){
    const repReason = representativeTeamlistPageReason(page);
    if(repReason){
      rejected.push({url:page.url, rounds:teamlistPageRoundNumbers(page), reason:repReason});
      continue;
    }
    const updatedTeams = updatedTeamlistUrlTeams(page.url);
    if(updatedTeams.length >= 2 && activePairs.size && !activePairs.has(pageFixturePairKey(updatedTeams))){
      rejected.push({url:page.url, rounds:teamlistPageRoundNumbers(page), reason:'non_active_fixture_pair', teams:updatedTeams});
      continue;
    }
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
  const repReason = representativeTeamlistPageReason(u.href, label);
  if(repReason) return repReason;
  if(/\bgame [123]\b/.test(haystack)) return 'origin_page';
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
  const teamListSignal =
    u.includes('team list') || u.includes('team lists') || u.includes('team-lists') || u.includes('teamlists') ||
    u.includes('final-teams') || u.includes('final teams') ||
    t.includes('team lists') || t.includes('team list') ||
    t.includes('team lists and selections') || t.includes('final teams') || t.includes('final team');
  return teamListSignal && (u.includes('round') || t.includes('round'));
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
        if(kind === 'teamlist'){
          const hasTeamListSignal = all.includes('team list') || all.includes('team lists') || all.includes('team-lists') || all.includes('teamlists') || all.includes('team lists and selections');
          const hasFinalTeamSignal = all.includes('final teams') || all.includes('final team') || all.includes('final-teams');
          const hasUpdatedTeamSignal = all.includes('updated team lists') || all.includes('updated-team-lists');
          return hasTeamListSignal || hasFinalTeamSignal || hasUpdatedTeamSignal || (all.includes('round') && all.includes('teams'));
        }
        if(kind === 'injury') return all.includes('casualty') || all.includes('injur');
        return false;
      }).slice(0, 40);
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
  if(url.includes('final-teams')) return 5;
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
  if(url.includes('final-teams')) return true;
  if(url.includes('zerotackle.com/updated-team-lists')) return true;
  if(url.includes('updated-team-lists')) return false;
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
      const injuryMeta = injuryReturnMetaFromRecord(rec, round);
      const injuryPhase = injuryPhaseForRound(injuryMeta, round);
      if(injuryPhase){
        injuriesOut[p.name] = makeStatus(STATUS.INJURED, rec.reason || rec.injury || rec.note || 'Injury from reliable source status file', [src], {...injuryMeta, raw:rec});
        injuryCount++;
      }
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
      // Preserve soft Origin context so it does not become a hard orange status on reload.
      // Only explicit Origin-unavailable/rested evidence should be primary ORIGIN.
      const softOriginContext = !!rec.originContextOnly || /origin\/representative-duty context found/i.test(String(rec.reason || rec.note || ''));
      const explicitOriginUnavailable = /unavailable due to origin|rested after origin|rested following origin|ruled out.*origin|origin.*ruled out|not available.*origin/i.test(blob);
      out[p.name] = makeStatus(
        STATUS.ORIGIN,
        rec.reason || rec.note || 'Origin context source found; club team-list truth still decides named/not named',
        [sourceObj('origin', rec.source || 'origin_players.json', rec.url || 'origin_players.json', rec.updatedAt || rec.updated || NOW_ISO)],
        {raw:rec, originContextOnly:softOriginContext && !explicitOriginUnavailable}
      );
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
    // CORE v34: collect all jersey numbers from strict regex + fixed local normalised windows.
    // Do not blindly prefer final-17 numbers when mixed evidence exists.
    // Head-to-head pages can place the opposition jersey beside a player's name.
    // No player names, no one-off overrides.
    const jerseys = collectJerseysNearPlayerName(page.text, p.name, surnameCounts);
    if(!jerseys.length) continue;

    const unique = [...new Set(jerseys)].filter(j => Number.isFinite(j) && j >= 1 && j <= 25);
    const final17 = unique.filter(j => j <= 17).sort((a,b)=>a-b);
    const extended = unique.filter(j => j > 17).sort((a,b)=>a-b);

    let jersey = null;
    let ambiguous = false;

    if(unique.length === 1){
      jersey = unique[0];
    }else if(extended.length && final17.length){
      // CORE RULE: playable jersey evidence beats extended-squad evidence for the same player.
      jersey = final17[0];
      ambiguous = true;
    }else{
      jersey = final17.length ? final17[0] : extended[0];
    }

    rows.push({player:p, jersey, seenJerseys:unique, ambiguousJerseyEvidence:ambiguous, pageIndex:norm(compactTextForPlayerScan(page.text)).indexOf(normName(p.name))});
  }
  return rows;
}

function lineupRoleForIndex(index){
  const n = Number(index || 0);
  if(n >= 1 && n <= 13) return 'starter';
  if(n >= 14 && n <= 17) return 'interchange';
  if(n >= 18) return 'extended';
  return '';
}

function lineupRoleFromOfficialNrlRole(role, jersey){
  const number = Number(jersey || 0);
  const value = norm(role);

  // Core invariant: jerseys 18+ are extended squad entries.
  // Role text must never promote them to NAMED.
  if(number >= 18){
    return 'extended';
  }

  if(value === 'interchange' || value === 'bench'){
    return 'interchange';
  }

  if(
    value === 'reserve' ||
    value === 'extended' ||
    value === 'replacement'
  ){
    return 'extended';
  }

  const starterRoles = new Set([
    'fullback',
    'wing',
    'winger',
    'centre',
    'center',
    'five eighth',
    'halfback',
    'prop',
    'hooker',
    'second row',
    '2nd row',
    'lock'
  ]);

  if(starterRoles.has(value)){
    return 'starter';
  }

  return lineupRoleForIndex(number);
}

function statusForLineupRole(role){
  return role === 'starter' || role === 'interchange' ? STATUS.NAMED : STATUS.EXPECTED;
}

function selectionStatusForLineupRole(role){
  return role === 'extended' ? 'extended' : 'named';
}

/**
 * Normalise a complete structured team-list record from ordered lineup
 * placement. The player's shirt number may differ after replacements or
 * positional changes, but ordered position remains the role truth.
 */
function normaliseStructuredPlacementRecord(record){
  if(
    !record ||
    record.structuredSnapshot !== true
  ){
    return record;
  }

  const lineupIndex = Number(record.lineupIndex);

  if(
    !Number.isInteger(lineupIndex) ||
    lineupIndex < 1
  ){
    return record;
  }

  const lineupRole =
    lineupRoleForIndex(lineupIndex);

  if(!lineupRole){
    return record;
  }

  const displayStatus =
    statusForLineupRole(lineupRole);

  return {
    ...record,
    lineupRole,
    selectionRole: lineupRole,
    displayStatus,
    status: displayStatus,
    available:
      displayStatus === STATUS.NAMED ||
      displayStatus === STATUS.EXPECTED ||
      displayStatus === STATUS.ORIGIN,
    colour: COLOUR[displayStatus],
    selectionStatus:
      selectionStatusForLineupRole(lineupRole)
  };
}

function labelForLineupRole(role, sourceKind){
  if(role === 'starter') return `Named in ${sourceKind} starting side`;
  if(role === 'interchange') return `Named in ${sourceKind} interchange`;
  return `Named in ${sourceKind} extended squad only`;
}
function decodeHtmlLite(text){
  return String(text || '')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtmlLite(html){
  return decodeHtmlLite(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNrlHiddenTeamListRowsFromHtml(html){
  const rows = [];
  const source = String(html || '');

  const blockRe = /<div[^>]*class=["'][^"']*team-list-profile__name[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m;

  while((m = blockRe.exec(source))){
    const block = String(m[1] || '');
    const hiddenMatch = block.match(/<span[^>]*class=["'][^"']*u-visually-hidden[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    if(!hiddenMatch) continue;

    const hidden = stripHtmlLite(hiddenMatch[1]);
    const h = hidden.match(/^\s*(.+?)\s+for\s+(.+?)\s+is\s+number\s+([1-9]|1[0-9]|2[0-5])\s*$/i);
    if(!h) continue;

    const role = String(h[1] || '').trim();
    const rawTeam = String(h[2] || '').trim();
    const jersey = Number(h[3]);

    const visibleHtml = block.replace(hiddenMatch[0], ' ');
    const name = stripHtmlLite(visibleHtml);

    let teamCanon = canonicalTeam(rawTeam);
    if(teamCanon === 'WARRIORS') teamCanon = 'NZWARRIORS';

    if(!teamCanon || !Number.isFinite(jersey) || jersey < 1 || jersey > 25 || name.length < 3) continue;

    rows.push({
      teamCanon,
      rawTeam,
      role,
      jersey,
      name
    });
  }

  const seen = new Set();
  return rows.filter(row => {
    const key = `${row.teamCanon}|${row.jersey}|${normName(row.name)}`;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function parseNrlRoleLineRowsFromPage(text){
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const rows = [];

  const roleWords = [
    'Fullback',
    'Wing',
    'Winger',
    'Centre',
    'Five-Eighth',
    'Five Eighth',
    'Halfback',
    'Prop',
    'Hooker',
    'Second Row',
    'Second-row',
    '2nd Row',
    '2nd-row',
    'Back Row',
    'Back-row',
    'Lock',
    'Interchange',
    'Reserve',
    'Replacement'
  ];

  const rolePattern = roleWords.map(escapedRe).join('|');

  // Official NRL stripped article format, for example:
  // Fullback for Wests Tigers is number 1 Jahream Bula
  // Interchange for Warriors is number 14 Dylan Walker
  const re = new RegExp(
    `\\b(${rolePattern})\\s+for\\s+(.+?)\\s+is\\s*number\\s*([1-9]|1[0-9]|2[0-5])\\s*(.+?)(?=\\s*(?:[1-9]|1[0-9]|2[0-5])?\\s*(?:${rolePattern})\\s+for\\s+|\\s+Team Lists\\s+|\\s+Match:\\s+|$)`,
    'gi'
  );

  let m;
  while((m = re.exec(clean))){
    const role = String(m[1] || '').trim();
    const rawTeam = String(m[2] || '').trim();
    const jersey = Number(m[3]);
    let name = String(m[4] || '').trim();

    name = name
      .replace(/\b(?:Team Lists|Backs|Forwards|Interchange|Reserves|Coach|Late Mail|Analysis)\b.*$/i, '')
      .replace(/\s*(?:[1-9]|1[0-9]|2[0-5])\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    let teamCanon = canonicalTeam(rawTeam);

    // The source writes "Warriors", but the app/player data uses NZWARRIORS.
    // This is a generic team-alias correction, not a player fix.
    if(teamCanon === 'WARRIORS') teamCanon = 'NZWARRIORS';

    if(!teamCanon || !Number.isFinite(jersey) || jersey < 1 || jersey > 25 || name.length < 3) continue;

    rows.push({
      teamCanon,
      rawTeam,
      role,
      jersey,
      name
    });
  }

  const seen = new Set();
  return rows.filter(row => {
    const key = `${row.teamCanon}|${row.jersey}|${normName(row.name)}`;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function parseZeroTackleStructuredSnapshots(page){
  const html = String(page?.html || '');
  const url = String(page?.url || '').toLowerCase();

  if(
    !url.includes('zerotackle.com') ||
    !html.includes('teamlist-players-home') ||
    !html.includes('teamlist-players-away')
  ){
    return [];
  }

  function teamFromSide(side){
    const re = new RegExp(
      `<div[^>]*class=["'][^"']*fixture_middle_${side}[^"']*["'][^>]*>` +
      `[\\s\\S]*?<a[^>]*href=["']/rugby-league/teams/([^/"']+)/?["']`,
      'i'
    );

    const match = html.match(re);
    if(!match) return '';

    let teamCanon = canonicalTeam(
      String(match[1] || '').replace(/-/g, ' ')
    );


    return teamCanon;
  }

  function tableBlock(className){
    const re = new RegExp(
      `<div[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>` +
      `([\\s\\S]*?)</table>\\s*</div>`,
      'i'
    );

    return String(html.match(re)?.[1] || '');
  }

  function rowFragments(block){
    return String(block || '')
      .split(/<tr[^>]*>/i)
      .slice(1);
  }

  function parseHomeRows(block){
    const rows = [];

    for(const fragment of rowFragments(block)){
      const match = fragment.match(
        /^\s*<td[^>]*>\s*(\d{1,2})\s*<\/td>\s*<td[^>]*>\s*<a[^>]*href=["'][^"']*\/players\/[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*show-mobile[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      );

      if(!match) continue;

      const jersey = Number(match[1]);
      const name = stripHtmlLite(match[2]);

      if(
        !Number.isFinite(jersey) ||
        jersey < 1 ||
        jersey > 30 ||
        name.length < 3
      ){
        continue;
      }

      rows.push({name, jersey});
    }

    return rows;
  }

  function parseAwayRows(block){
    const rows = [];

    for(const fragment of rowFragments(block)){
      const match = fragment.match(
        /^\s*<td[^>]*>\s*<a[^>]*href=["'][^"']*\/players\/[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*show-mobile[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>\s*<\/td>\s*<td[^>]*>\s*(\d{1,2})\s*<\/td>/i
      );

      if(!match) continue;

      const name = stripHtmlLite(match[1]);
      const jersey = Number(match[2]);

      if(
        !Number.isFinite(jersey) ||
        jersey < 1 ||
        jersey > 30 ||
        name.length < 3
      ){
        continue;
      }

      rows.push({name, jersey});
    }

    return rows;
  }

  function createSnapshot(teamCanon, side, rows){
    if(!teamCanon || rows.length < 17){
      return null;
    }

    return {
      teamCanon,
      side,
      rows: rows.map((row, index) => {
        const lineupIndex = index + 1;

        return {
          ...row,
          lineupIndex,
          lineupRole: lineupRoleForIndex(lineupIndex)
        };
      })
    };
  }

  const home = createSnapshot(
    teamFromSide('home'),
    'home',
    parseHomeRows(tableBlock('teamlist-players-home'))
  );

  const away = createSnapshot(
    teamFromSide('away'),
    'away',
    parseAwayRows(tableBlock('teamlist-players-away'))
  );

  return [home, away].filter(Boolean);
}

function fromFetchedTeamlists(players, pages, teamlistsOut){
  const lookup = playerLookupByName(players);
  const teamFound = new Map();
   let totalFound = 0;
  let sectionFound = 0;
  let knownPatternFound = 0;
  let nrlRoleLineFound = 0;
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
    const pageJerseysByTeam = new Map();

    function markSeen(teamCanon, playerName){
      if(!pageSeenByTeam.has(teamCanon)) pageSeenByTeam.set(teamCanon, new Set());
      pageSeenByTeam.get(teamCanon).add(playerName);
    }
    function addTeamCount(teamCanon){
      pageTeamCounts.set(teamCanon, (pageTeamCounts.get(teamCanon)||0) + 1);
    }
    function markJersey(teamCanon, jersey){
      const n = Number(jersey);
      if(!Number.isFinite(n) || n < 1 || n > 17) return;
      if(!pageJerseysByTeam.has(teamCanon)) pageJerseysByTeam.set(teamCanon, new Set());
      pageJerseysByTeam.get(teamCanon).add(n);
    }
    function findPlayerForTeamName(rawName, teamCanon){
      const exact = lookup.get(normName(rawName));
      if(exact) return exact;

      const rawNorm = normName(rawName);
      const rawParts = rawNorm.split(' ').filter(Boolean);
      if(rawParts.length < 2) return null;

      const rawFirst = rawParts[0];
      const rawLast = rawParts[rawParts.length - 1];
      const rawSurnameCompact = rawParts.slice(1).join('');

      const candidates = players.filter(p => {
        if(playerTeam(p) !== teamCanon) return false;

        const playerNorm = normName(p.name);
        const parts = playerNorm.split(' ').filter(Boolean);
        if(parts.length < 2) return false;

        const playerFirst = parts[0];
        const playerLast = parts[parts.length - 1];
        const playerSurnameCompact = parts.slice(1).join('');

        // Generic source/player surname normalisation.
        // Handles punctuation/spacing differences like Fa'alogo vs Faalogo.
        // Same-team scope above prevents broad cross-club guessing.
        const surnameMatches =
          playerLast === rawLast ||
          playerSurnameCompact === rawSurnameCompact ||
          playerSurnameCompact.endsWith(rawLast) ||
          rawSurnameCompact.endsWith(playerLast);

        if(!surnameMatches) return false;

        const directFirstMatch =
          rawFirst.startsWith(playerFirst) ||
          playerFirst.startsWith(rawFirst);

        // Official sources may use initials or abbreviated given names.
        // Matching remains restricted to the same club and a unique surname candidate.
        const abbreviatedFirstMatch =
          rawFirst.length <= 3 &&
          playerFirst.length >= 3 &&
          rawFirst[0] === playerFirst[0];

        return directFirstMatch || abbreviatedFirstMatch;
      });

      return candidates.length === 1 ? candidates[0] : null;
    }

    function pageStarterCoverageOk(teamCanon){
      const jerseys = pageJerseysByTeam.get(teamCanon) || new Set();

      // Core trust rule:
      // A current team list cannot be used to infer NOT_NAMED if the parsed 1-17 is incomplete.
      // This prevents a partial parse, e.g. jerseys 3-22 only, from greying players who are actually named.
      // Jersey coverage must come directly from parsed source rows, not merged player status records.
      return jerseys.has(1) && jerseys.has(2) && jerseys.size >= 16;
    }
    // Parser 0: structured Zero Tackle home/away snapshots.
    // Row order is lineup placement; jersey remains the shirt number.
    const structuredSnapshots =
      parseZeroTackleStructuredSnapshots(page);

    const structuredTeams = new Set();

    for(const snapshot of structuredSnapshots){
      const teamCanon = snapshot.teamCanon;
      const resolvedRows = [];

      for(const row of snapshot.rows){
        const p = findPlayerForTeamName(row.name, teamCanon);

        if(!p || playerTeam(p) !== teamCanon){
          continue;
        }

        resolvedRows.push({row, player: p});
      }

      const sourcePlayable = snapshot.rows.filter(
        row =>
          row.lineupIndex >= 1 &&
          row.lineupIndex <= 17
      );

      const playablePositions = new Set(
        sourcePlayable.map(row => row.lineupIndex)
      );

      const playableSourceNames = new Set(
        sourcePlayable.map(row => normName(row.name))
      );

      const completePlayableSnapshot =
        sourcePlayable.length === 17 &&
        playablePositions.size === 17 &&
        playableSourceNames.size === 17 &&
        Array.from(
          {length: 17},
          (_, index) => index + 1
        ).every(position => playablePositions.has(position));

      if(!completePlayableSnapshot){
        continue;
      }

      structuredTeams.add(teamCanon);

      let matchedPlayable = 0;

      for(const {row, player: p} of resolvedRows){
        const status = statusForLineupRole(row.lineupRole);
        const label = labelForLineupRole(
          row.lineupRole,
          'structured team-list snapshot'
        );

        addOrMerge(
          teamlistsOut,
          p,
          makeStatus(
            status,
            `${label} (${page.sourceName}, lineup position ${row.lineupIndex}, jersey ${row.jersey}).`,
            [src],
            {
              selectionStatus:
                selectionStatusForLineupRole(row.lineupRole),
              lineupRole: row.lineupRole,
              lineupIndex: row.lineupIndex,
              team: p.team,
              teamCanonical: teamCanon,
              jersey: row.jersey,
              sourcePriority: priority,
              sourceOrder: pageOrder,
              structuredSnapshot: true
            }
          )
        );

        markSeen(teamCanon, p.name);
        markJersey(teamCanon, row.jersey);
        addTeamCount(teamCanon);

        if(row.lineupIndex <= 17){
          matchedPlayable++;
        }

        totalFound++;
        knownPatternFound++;
      }

      teamFound.set(
        teamCanon,
        Math.max(
          teamFound.get(teamCanon) || 0,
          matchedPlayable
        )
      );
    }
    // Parser 1: structured team-heading numbered sections.
    const sections = parseTeamSectionsFromPage(page.text);
    for(const [teamCanon, numbered] of Object.entries(sections)){
      if(structuredTeams.has(teamCanon)) continue;

      let matchedForTeam = 0;
      for(const row of numbered){
        const p = findPlayerForTeamName(row.name, teamCanon);
        if(!p) continue;
        if(playerTeam(p) !== teamCanon) continue;
        matchedForTeam++;
        const lineupIndex = matchedForTeam;
        const lineupRole = lineupRoleForIndex(row.jersey);
        const status = statusForLineupRole(lineupRole);
        const label = labelForLineupRole(lineupRole, 'numbered team-list');
        addOrMerge(teamlistsOut, p, makeStatus(status, `${label} (${page.sourceName}, jersey ${row.jersey}).`, [src], {selectionStatus: selectionStatusForLineupRole(lineupRole), lineupRole, lineupIndex, team:p.team, teamCanonical:teamCanon, jersey:row.jersey, sourcePriority:priority, sourceOrder:pageOrder}));
        markSeen(teamCanon, p.name);
        markJersey(teamCanon, row.jersey);
        addTeamCount(teamCanon);
        totalFound++;
        sectionFound++;
      }
      if(matchedForTeam >= 10 && pageStarterCoverageOk(teamCanon)) teamFound.set(teamCanon, Math.max(teamFound.get(teamCanon)||0, matchedForTeam));
    }
    // Parser 3: Official NRL role-line format.
    // Example stripped article text:
    // "Fullback for Wests Tigers is number 1 Jahream Bula"
    // Generic source parser only. No player hard-fixes.
    const hiddenNrlRoleRows = parseNrlHiddenTeamListRowsFromHtml(page.html);
    const textNrlRoleRows = parseNrlRoleLineRowsFromPage(page.text);
    const hiddenNrlTeams = new Set(hiddenNrlRoleRows.map(row => row.teamCanon));

    // Structured official HTML is authoritative for each team where it exists.
    // Stripped text remains fallback-only for teams without hidden rows.
    const nrlRoleRows = [
      ...hiddenNrlRoleRows,
      ...textNrlRoleRows.filter(
        row => !hiddenNrlTeams.has(row.teamCanon)
      )
    ].filter(
      row => !structuredTeams.has(row.teamCanon)
    );

    const nrlRoleRowsByTeam = new Map();

    const officialSlotOwners = new Map();

    for(const row of nrlRoleRows){
      const parsedLineupRole = lineupRoleFromOfficialNrlRole(row.role, row.jersey);
      const playable =
        parsedLineupRole === 'starter' ||
        parsedLineupRole === 'interchange';

      if(playable){
        const slotKey = `${row.teamCanon}|${row.jersey}`;
        const existingOwner = officialSlotOwners.get(slotKey);

        if(existingOwner && normName(existingOwner) !== normName(row.name)){
          throw new Error(
            `Duplicate official team-list slot ${slotKey}: ${existingOwner} and ${row.name}`
          );
        }

        officialSlotOwners.set(slotKey, row.name);
      }

      const p = findPlayerForTeamName(row.name, row.teamCanon);
      if(!p) continue;
      if(playerTeam(p) !== row.teamCanon) continue;

      if(!nrlRoleRowsByTeam.has(row.teamCanon)) nrlRoleRowsByTeam.set(row.teamCanon, []);
      nrlRoleRowsByTeam.get(row.teamCanon).push({...row, player:p});
    }

    for(const [teamCanon, rows] of nrlRoleRowsByTeam.entries()){
      const orderedRows = [...rows].sort((a,b) => a.jersey - b.jersey);
      let matchedForTeam = 0;

      for(const row of orderedRows){
        matchedForTeam++;
        const p = row.player;
        const lineupRole = lineupRoleFromOfficialNrlRole(row.role, row.jersey);
        const status = statusForLineupRole(lineupRole);
        const label = labelForLineupRole(lineupRole, 'official NRL role-line team-list');

        addOrMerge(
          teamlistsOut,
          p,
          makeStatus(
            status,
            `${label} (${page.sourceName}, ${row.role}, jersey ${row.jersey}).`,
            [src],
            {
              selectionStatus: selectionStatusForLineupRole(lineupRole),
              lineupRole,
              lineupIndex: row.jersey,
              team:p.team,
              teamCanonical:teamCanon,
              jersey:row.jersey,
              sourcePriority:priority,
              sourceOrder:pageOrder
            }
          )
        );

        markSeen(teamCanon, p.name);
        markJersey(teamCanon, row.jersey);
        addTeamCount(teamCanon);
        totalFound++;
        nrlRoleLineFound++;
      }

      if(matchedForTeam >= 10 && pageStarterCoverageOk(teamCanon)){
        teamFound.set(teamCanon, Math.max(teamFound.get(teamCanon)||0, matchedForTeam));
      }
    }
    // Parser 2: generic known-player + jersey-number patterns from stripped team-list article text.
    // This is needed because some source pages render rows as "1 Player Player" or "Player Player 1" rather than "1. Player".
    // v22 guard: never whole-scan the official Tuesday NRL team-list article; that caused stale
    // Tuesday selections to stay green after late-mail changes. Updated/final pages still override
    // older pages using sourcePriority.
    if(allowWholeArticleJerseyScan(page)){
      const jerseyRows = fromKnownPlayerJerseyPatterns(players, page);
      const rowsByTeam = new Map();
      for(const row of jerseyRows){
        const teamCanon = playerTeam(row.player);
        if(!teamCanon) continue;
        if(structuredTeams.has(teamCanon)) continue;
        if(!rowsByTeam.has(teamCanon)) rowsByTeam.set(teamCanon, []);
        rowsByTeam.get(teamCanon).push(row);
      }

      for(const [teamCanon, teamRows] of rowsByTeam.entries()){
        const orderedRows = [...teamRows].sort((a,b) => {
          const ai = Number.isFinite(a.pageIndex) && a.pageIndex >= 0 ? a.pageIndex : Number.MAX_SAFE_INTEGER;
          const bi = Number.isFinite(b.pageIndex) && b.pageIndex >= 0 ? b.pageIndex : Number.MAX_SAFE_INTEGER;
          return ai - bi;
        });

        let lineupIndex = 0;
        for(const row of orderedRows){
          lineupIndex++;
          const p = row.player;
          addTeamCount(teamCanon);
          markSeen(teamCanon, p.name);
          markJersey(teamCanon, row.jersey);
          const lineupRole = lineupRoleForIndex(row.jersey);
          const status = statusForLineupRole(lineupRole);
          const label = labelForLineupRole(lineupRole, 'team-list article');
          addOrMerge(teamlistsOut, p, makeStatus(status, `${label} (${page.sourceName}, jersey ${row.jersey}).`, [src], {selectionStatus: selectionStatusForLineupRole(lineupRole), lineupRole, lineupIndex, team:p.team, teamCanonical:teamCanon, jersey:row.jersey, seenJerseys:row.seenJerseys, ambiguousJerseyEvidence:row.ambiguousJerseyEvidence, sourcePriority:priority, sourceOrder:pageOrder}));
          totalFound++;
          knownPatternFound++;
        }
      }
    }

    // CORE SOURCE-PRIORITY FIX:
    // If a newer updated/final/late-mail page contains a real club list (10+ players), that page is
    // the current truth for that club. Players from that club who are absent from this newer page
    // must be downgraded to NOT_NAMED at the same high priority. This lets final-team/late-mail
    // evidence override older Tuesday lists without hardcoding any player.
    const pageSourceName = String(page.sourceName || '').toLowerCase();
    const pageUrlText = String(page.url || '').toLowerCase();

    // Source-quality guard:
    // Absence is only strong evidence from trusted official/final/late-mail pages.
    // Third-party/partial scrapes such as Zero Tackle can name players, but cannot mark players NOT_NAMED
    // just because they are missing from that page.
    const canDowngradeAbsentPlayers =
      !pageSourceName.includes('zero tackle') &&
      (
        pageSourceName.includes('nrl') ||
        pageSourceName.includes('official') ||
        pageSourceName.includes('late') ||
        pageSourceName.includes('final') ||
        pageUrlText.includes('nrl.com')
      );

    for(const [teamCanon, n] of pageTeamCounts.entries()){
      if(n >= 10 && canDowngradeAbsentPlayers && pageStarterCoverageOk(teamCanon)){
        teamFound.set(teamCanon, Math.max(teamFound.get(teamCanon)||0, n));
        const seen = pageSeenByTeam.get(teamCanon) || new Set();
        for(const p of players){
          if(playerTeam(p) !== teamCanon) continue;
          if(seen.has(p.name)) continue;
          const existing = teamlistsOut[p.name];
          const existingRole = String(existing?.lineupRole || existing?.selectionRole || '').toLowerCase();
          const existingPlayable = existing?.displayStatus === STATUS.NAMED && (existingRole === 'starter' || existingRole === 'interchange');
          const existingPriority = Number(existing?.sourcePriority || 0);
          // CORE RULE: positive current team-list evidence wins over inferred absence.
          // If any trusted current source has the player NAMED in 1-17, do not let a later/higher-priority
          // page-level omission downgrade him to NOT_NAMED. Absence is inferred evidence; named jersey evidence wins.
          if(existingPlayable) continue;
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
  return {totalFound, loadedTeams:[...loadedTeams], parser:'section_parser_plus_nrl_role_lines_plus_local_window_jersey_patterns_with_source_priority_v35', sectionFound, nrlRoleLineFound, knownPatternFound, pageLevelMissingCount};
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

function fixtureTeamCanonFromValue(value){
  const canon = canonicalTeam(value);
  if(!canon) return '';
  // Normalise the duplicate Warriors alias to the player/team canonical used elsewhere.
  if(canon === 'WARRIORS') return 'NZWARRIORS';
  return canon;
}
function teamsFromFixtureText(text){
  const found = new Set();
  const raw = String(text || '');

  function addCanon(canon){
    if(!canon) return;
    found.add(canon === 'WARRIORS' ? 'NZWARRIORS' : canon);
  }

  function aliasMatches(hay, aliasNorm){
    if(!aliasNorm) return false;
    const escaped = aliasNorm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(?:^| )${escaped}(?: |$)`, 'i').test(hay);
  }

  // Generic multi-word team slug handling.
  // Updated team-list URLs often use slugs like sea-eagles-storm,
  // gold-coast-titans, north-queensland-cowboys, south-sydney-rabbitohs.
  // Do this before hyphen splitting so multi-word teams are not broken into junk
  // pieces like SEA + EAGLES instead of MANLY.
  const hay = norm(raw.replace(/[-_\/]+/g, ' '));
  const multiWordTokens = new Set();

  const aliasEntries = [];
  for(const [canon, aliases] of Object.entries(TEAM_ALIASES)){
    for(const alias of aliases || []){
      const aliasNorm = norm(alias);
      if(aliasNorm) aliasEntries.push({canon, aliasNorm});
    }
  }

  // Prefer longest / multi-word aliases first.
  aliasEntries.sort((a,b) => b.aliasNorm.length - a.aliasNorm.length);

  for(const item of aliasEntries){
    if(!item.aliasNorm.includes(' ')) continue;
    if(aliasMatches(hay, item.aliasNorm)){
      addCanon(item.canon);
      for(const token of item.aliasNorm.split(' ').filter(Boolean)) multiWordTokens.add(token);
    }
  }

  for(const item of aliasEntries){
    if(item.aliasNorm.includes(' ')) continue;
    if(multiWordTokens.has(item.aliasNorm)) continue;
    if(aliasMatches(hay, item.aliasNorm)) addCanon(item.canon);
  }

  if(found.size >= 2) return [...found];

  const parts = raw.split(/\b(?:v|vs|versus|at|@)\b|[-–—]/i).map(x => x.trim()).filter(Boolean);
  for(const part of parts){
    const canon = fixtureTeamCanonFromValue(part);
    if(canon) addCanon(canon);
  }

  // Fallback: scan all aliases in free text when no clean separator exists.
  if(!found.size){
    for(const item of aliasEntries){
      if(aliasMatches(hay, item.aliasNorm)) addCanon(item.canon);
    }
  }

  return [...found];
}
function expectedTeamsForRound(fixturesJson, round){
  const out = new Set();
  const fixtures = asArray(fixturesJson?.fixtures).filter(f => Number(f.round) === Number(round));
  for(const f of fixtures){
    const directFields = [
      f.homeTeam, f.awayTeam, f.home, f.away, f.homeName, f.awayName,
      f.homeTeamName, f.awayTeamName, f.homeAbbr, f.awayAbbr,
      f.teamA, f.teamB, f.team1, f.team2
    ];
    for(const v of directFields){
      const canon = fixtureTeamCanonFromValue(v);
      if(canon) out.add(canon);
    }
    const textFields = [f.match, f.game, f.title, f.name, f.description].filter(Boolean);
    for(const text of textFields){
      for(const canon of teamsFromFixtureText(text)) out.add(canon);
    }
  }
  return [...out].filter(Boolean).sort();
}
function fixtureTeamsFromMatchRecord(f){
  const out = new Set();
  const directFields = [
    f.homeTeam, f.awayTeam, f.home, f.away, f.homeName, f.awayName,
    f.homeTeamName, f.awayTeamName, f.homeAbbr, f.awayAbbr,
    f.teamA, f.teamB, f.team1, f.team2
  ];
  for(const v of directFields){
    const canon = fixtureTeamCanonFromValue(v);
    if(canon) out.add(canon);
  }
  const textFields = [f.match, f.game, f.title, f.name, f.description].filter(Boolean);
  for(const text of textFields){
    for(const canon of teamsFromFixtureText(text)) out.add(canon);
  }
  return [...out];
}
function allTeamsSeenInFixtures(fixturesJson){
  const out = new Set();
  for(const f of asArray(fixturesJson?.fixtures)){
    for(const canon of fixtureTeamsFromMatchRecord(f)) out.add(canon);
  }
  const byes = fixturesJson?.byes || fixturesJson?.byeRounds || fixturesJson?.byeTeams || {};
  for(const list of Object.values(byes || {})){
    for(const item of asArray(list)){
      const v = typeof item === 'string' ? item : (item?.team || item?.teamCode || item?.name || item?.club);
      const canon = fixtureTeamCanonFromValue(v);
      if(canon) out.add(canon);
    }
  }
  return out;
}
function byeTeamsForRound(fixturesJson, round){
  const out = new Set();
  const byes = fixturesJson?.byes || fixturesJson?.byeRounds || fixturesJson?.byeTeams || {};
  const raw = asArray(byes?.[String(round)] ?? byes?.[Number(round)] ?? []);
  for(const item of raw){
    const v = typeof item === 'string' ? item : (item?.team || item?.teamCode || item?.name || item?.club);
    const canon = fixtureTeamCanonFromValue(v);
    if(canon) out.add(canon);
  }
  return out;
}
function validateTeamlistCompleteness(players, fixturesJson, round, teamlists, teamsWithLoadedList){
  const loaded = new Set(asArray(teamsWithLoadedList).map(fixtureTeamCanonFromValue).filter(Boolean));
  const expected = expectedTeamsForRound(fixturesJson, round);
  const expectedSet = new Set(expected);
  const allFixtureTeams = allTeamsSeenInFixtures(fixturesJson);
  const byeTeams = byeTeamsForRound(fixturesJson, round);
  // Season-safe fallback: if the draw knows a club exists but it is not in the active-round fixture list,
  // it is not required to have a current team list for this round. This prevents bye teams from failing
  // the source_missing cluster guard while still failing clubs that are actually playing.
  for(const team of allFixtureTeams){
    if(!expectedSet.has(team)) byeTeams.add(team);
  }
  const sourceMissingByTeam = {};
  const byeSourceMissingByTeam = {};
  const ignoredNonFixtureSourceMissingByTeam = {};
  for(const p of players || []){
    const team = fixtureTeamCanonFromValue(playerTeam(p));
    if(!team) continue;
    const bye = byeTeams.has(team) || playerByeRounds(p).includes(Number(round));
    if(!teamlists?.[p.name]){
      if(bye) byeSourceMissingByTeam[team] = (byeSourceMissingByTeam[team] || 0) + 1;
      else if(expectedSet.has(team)) sourceMissingByTeam[team] = (sourceMissingByTeam[team] || 0) + 1;
      else ignoredNonFixtureSourceMissingByTeam[team] = (ignoredNonFixtureSourceMissingByTeam[team] || 0) + 1;
    }
  }
  const missingExpectedTeams = expected.filter(t => !loaded.has(t));
  const suspiciousMissingTeams = Object.entries(sourceMissingByTeam)
    .filter(([team,count]) => count >= 8 && !loaded.has(team))
    .map(([team,count]) => ({team, count}))
    .sort((a,b) => a.team.localeCompare(b.team));
  const incompleteTeams = [...new Set([
    ...missingExpectedTeams,
    ...suspiciousMissingTeams.map(x => x.team)
  ])].sort();
  const ok = incompleteTeams.length === 0;
  const ignoredByeSourceMissingTeams = Object.entries(byeSourceMissingByTeam)
    .map(([team,count]) => ({team, count}))
    .sort((a,b) => a.team.localeCompare(b.team));
  const ignoredNonFixtureSourceMissingTeams = Object.entries(ignoredNonFixtureSourceMissingByTeam)
    .map(([team,count]) => ({team, count}))
    .sort((a,b) => a.team.localeCompare(b.team));
  return {
    ok,
    expectedTeams:expected,
    loadedTeams:[...loaded].sort(),
    byeTeams:[...byeTeams].sort(),
    missingExpectedTeams,
    suspiciousMissingTeams,
    ignoredByeSourceMissingTeams,
    ignoredNonFixtureSourceMissingTeams,
    incompleteTeams
  };
}

function parsedJerseyCoverageFromTeamlists(teamlists){
  const byTeam = new Map();
  const source = teamlists?.players && typeof teamlists.players === 'object'
    ? teamlists.players
    : teamlists;

  function addRecord(rec){
    if(!rec || typeof rec !== 'object') return;

    const team = fixtureTeamCanonFromValue(rec?.teamCanonical || rec?.team || rec?.club || rec?.teamName);
    if(!team) return;

    const selectionStatus = String(rec?.selectionStatus || rec?.displayStatus || rec?.status || '').toLowerCase();
    if(selectionStatus && !['named', 'extended'].includes(selectionStatus)) return;

    const jerseyRaw =
      rec.jersey ??
      rec.number ??
      rec.num ??
      rec.positionNumber ??
      rec.posNumber ??
      rec.shirtNumber;

    const jersey = Number(String(jerseyRaw ?? '').replace(/[^\d]/g, ''));
    if(!Number.isInteger(jersey) || jersey < 1 || jersey > 25) return;

    if(!byTeam.has(team)){
      byTeam.set(team, {
        playerRows: 0,
        namedJerseys: new Set(),
        structuredPlayablePositions: new Set()
      });
    }

    const teamCoverage = byTeam.get(team);
    teamCoverage.playerRows += 1;
    teamCoverage.namedJerseys.add(jersey);

    const lineupIndex = Number(rec?.lineupIndex);

    if(
      rec?.structuredSnapshot === true &&
      Number.isInteger(lineupIndex) &&
      lineupIndex >= 1 &&
      lineupIndex <= 17
    ){
      teamCoverage.structuredPlayablePositions.add(lineupIndex);
    }
  }

  for(const [key, payload] of Object.entries(source || {})){
    const rows =
      Array.isArray(payload?.players) ? payload.players :
      Array.isArray(payload?.playerRows) ? payload.playerRows :
      Array.isArray(payload?.rows) ? payload.rows :
      null;

    if(rows){
      const teamFromKey = fixtureTeamCanonFromValue(key);
      for(const row of rows){
        addRecord({
          ...row,
          teamCanonical: row?.teamCanonical || row?.team || teamFromKey
        });
      }
    } else {
      addRecord(payload);
    }
  }

  const coverage = {};

  for(const [team, info] of byTeam.entries()){
    const jerseys = [...info.namedJerseys].sort((a, b) => a - b);

    const structuredPositions = [
      ...info.structuredPlayablePositions
    ].sort((a, b) => a - b);

    const structuredComplete =
      structuredPositions.length === 17 &&
      structuredPositions.every(
        (position, index) => position === index + 1
      );

    const legacyJerseyComplete =
      info.namedJerseys.has(1) &&
      info.namedJerseys.has(2) &&
      jerseys.length >= 16;

    coverage[team] = {
      playerRows: info.playerRows,
      jerseyCount: jerseys.length,
      jerseys,
      hasJersey1: info.namedJerseys.has(1),
      hasJersey2: info.namedJerseys.has(2),
      structuredComplete,
      legacyJerseyComplete,
      structuredPlayablePositions: structuredPositions,
      reliableLoadedTeam: structuredComplete || legacyJerseyComplete
    };
  }

  return coverage;
}

function playableTeamCoverageFromTeamlists(teamlists){
  const coverage = parsedJerseyCoverageFromTeamlists(teamlists);
  const playable = {};

  for(const [team, info] of Object.entries(coverage)){
    playable[team] = Boolean(info?.reliableLoadedTeam);
  }

  return playable;
}

function reliableLoadedTeamsFromTeamlists(teamlists){
  const coverage = parsedJerseyCoverageFromTeamlists(teamlists);
  const out = new Set();

  for(const [team, info] of Object.entries(coverage)){
    if(info?.reliableLoadedTeam) out.add(team);
  }

  return out;
}
function combineTruth(players, round, teamlists, injuries, suspensions, origin, existingStatus, trustedLoadedTeams=[]){
  const playersOut = {};
  const teamsWithLoadedList = new Set([
    ...reliableLoadedTeamsFromTeamlists(teamlists),
    ...asArray(trustedLoadedTeams)
      .map(fixtureTeamCanonFromValue)
      .filter(Boolean)
  ]);
  for(const p of players){
    const bye = playerByeRounds(p).includes(Number(round));
    const t = normaliseStructuredPlacementRecord(teamlists[p.name]);
    let i = injuries[p.name];

    // Source-quality guard:
    // Local injury context is weak evidence. It only means an injury word was found near the player's name.
    // It must never create hard INJURED / red / unavailable / projection 0.
    const weakInjuryContext =
      i && (
        String(i.injuryStatus || '').toLowerCase().includes('local_context') ||
        String(i.reason || '').toLowerCase().includes('context found near player')
      );

    if(weakInjuryContext){
      i = null;
    }
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
      const teamCanon = playerTeam(p);
      if(teamsWithLoadedList.has(teamCanon)){
        rec = makeStatus(STATUS.NOT_NAMED, 'Current club team list loaded for club and player was not in that list.', [sourceObj('teamlist','Parsed current team-list source','data/teamlists.json',NOW_ISO)], {selectionStatus:'not_named', team:p.team, teamCanonical:teamCanon, sourcePriority:1});
      } else if(oldStatus === STATUS.NOT_NAMED){
        rec = makeStatus(STATUS.NOT_NAMED, 'No current club team-list truth. Previous/source reference suggests not named.', [sourceObj('previous_week','Reference layer','player_status.json')], {selectionStatus:'previous_reference'});
      } else {
        // Missing/uncertain current team-list truth is not confirmed NOT_NAMED.
        // Treat it as EXPECTED/unknown so source gaps do not create false grey status.
        // Verified current team-list omissions still remain NOT_NAMED elsewhere.
        rec = makeStatus(STATUS.EXPECTED, 'No current club team-list truth. Source missing/uncertain; treated as expected, not confirmed NOT_NAMED.', [sourceObj('source_missing','Current club team-list not confirmed','data/status_truth.json')], {selectionStatus:'source_missing', dataUnknown:true});
      }
    }
    // Structured ordered placement remains authoritative after contextual
    // injury, suspension and Origin metadata has been composed.
    rec = normaliseStructuredPlacementRecord(rec);

    // System arbitration repair:
    // If current team-list parsing produced a playable jersey/role, the player cannot remain NOT_NAMED.
    // This fixes source-order contradictions without any player-specific overrides.
    {
      // Final invariant: current playable team-list evidence beats stale unavailable status.
      // Use t as fallback because an injury record can replace rec and hide jersey/role.
      const jersey = Number.isFinite(Number(rec?.jersey)) ? Number(rec?.jersey) : Number(t?.jersey);
      const role = String(rec?.lineupRole || rec?.selectionRole || t?.lineupRole || t?.selectionRole || '').toLowerCase();
      // Role is stronger than jersey number. Some sources list playable starters/interchange
      // outside classic 1-17 numbers, so trust explicit role first.
      const playableRole =
        role === 'starter' ||
        role === 'interchange' ||
        (!role && jersey >= 1 && jersey <= 17);

      const playableContradictionStatuses = new Set([
        STATUS.NOT_NAMED,
        STATUS.INJURED,
        'OUT',
        'UNAVAILABLE'
      ]);

      // Final core resolver:
      // If current club team-list evidence gives a playable role/jersey, the published card must be NAMED.
      // Injury, Origin, source-missing, and inferred NOT_NAMED become notes only.
      if(Number.isFinite(jersey) && playableRole && rec?.displayStatus !== STATUS.BYE && rec?.displayStatus !== STATUS.SUSPENDED && rec?.displayStatus !== STATUS.NAMED){
        const mergedSources = [
          ...(t?.sources || []),
          ...(rec?.sources || [])
        ];
        rec = {
          ...(t || {}),
          ...rec,
          jersey,
          lineupRole: role,
          displayStatus: STATUS.NAMED,
          status: STATUS.NAMED,
          available: true,
          colour: COLOUR[STATUS.NAMED],
          selectionStatus: 'named',
          sources: mergedSources,
          reason: `${t?.reason || rec?.reason || 'Team-list evidence'}; current playable team-list evidence wins over injury/origin/not-named/source-missing contradiction`
        };
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
  const weakInjuryHardConflicts = Object.entries(playersOut).filter(([,r]) => {
    const status = String(r?.displayStatus || '').toUpperCase();
    const injuryStatus = String(r?.injuryStatus || '').toLowerCase();
    const reason = String(r?.reason || '').toLowerCase();
    return status === STATUS.INJURED && (
      injuryStatus.includes('local_context') ||
      reason.includes('context found near player')
    );
  });

  if(weakInjuryHardConflicts.length){
    const sample = weakInjuryHardConflicts.slice(0,8).map(([n,r]) =>
      n+': '+r.displayStatus+' from weak injury context'
    ).join('; ');
    throw new Error('Weak injury context cannot publish hard INJURED status: '+sample);
  }

  const impossibleLineupConflicts = Object.entries(playersOut).filter(([,r]) => {
    const jersey = Number(r?.jersey);
    const lineupIndex = Number(r?.lineupIndex);
    const role = String(
      r?.lineupRole ||
      r?.selectionRole ||
      ''
    ).toLowerCase();
    const status = String(
      r?.displayStatus ||
      ''
    ).toUpperCase();

    const hasStructuredPlacement =
      r?.structuredSnapshot === true &&
      Number.isInteger(lineupIndex) &&
      lineupIndex >= 1;

    // A complete structured snapshot derives playing role from ordered
    // lineup placement. Jersey remains the shirt number and can differ
    // after late replacements or positional changes.
    if(hasStructuredPlacement){
      if(
        lineupIndex <= 13 &&
        role !== 'starter'
      ){
        return true;
      }

      if(
        lineupIndex >= 14 &&
        lineupIndex <= 17 &&
        role !== 'interchange'
      ){
        return true;
      }

      if(
        lineupIndex <= 17 &&
        status !== STATUS.NAMED
      ){
        return true;
      }

      if(
        lineupIndex >= 18 &&
        role !== 'extended'
      ){
        return true;
      }

      if(
        status === STATUS.NOT_NAMED &&
        ['starter','interchange'].includes(role)
      ){
        return true;
      }

      return false;
    }

    // Fallback sources without structured placement retain the existing
    // jersey-based safety validation.
    if(
      Number.isFinite(jersey) &&
      jersey >= 1 &&
      jersey <= 13 &&
      role !== 'starter'
    ){
      return true;
    }

    if(
      Number.isFinite(jersey) &&
      jersey >= 14 &&
      jersey <= 17 &&
      role !== 'interchange'
    ){
      return true;
    }

    if(
      Number.isFinite(jersey) &&
      jersey >= 1 &&
      jersey <= 17 &&
      status !== STATUS.NAMED
    ){
      return true;
    }

    if(
      Number.isFinite(jersey) &&
      jersey >= 18 &&
      role !== 'extended'
    ){
      return true;
    }

    if(
      status === STATUS.NOT_NAMED &&
      ['starter','interchange'].includes(role)
    ){
      return true;
    }

    return false;
  });

  if(impossibleLineupConflicts.length){
    const sample = impossibleLineupConflicts.slice(0,10).map(([n,r]) =>
      n+
      ': jersey '+r.jersey+
      ', status '+r.displayStatus+
      ', role '+(r.lineupRole || r.selectionRole || '')+
      ', lineupIndex '+(r.lineupIndex ?? '')+
      ', structuredSnapshot '+String(r.structuredSnapshot === true)+
      ', selectionStatus '+(r.selectionStatus || '')+
      ', reason '+(r.reason || '')
    ).join('; ');
    throw new Error('Team-list arbitration invariant failed: impossible jersey/status/role state: '+sample);
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
function buildTeamlistAudit({
  round,
  players,
  fixturesJson,
  teamSourceUrls,
  discoveredTeamPages,
  teamPages,
  filteredTeamPages,
  detectedRound,
  fixtureInference,
  currentRoundMeta,
  teamlists,
  fetchedTeamStats,
  teamlistCompleteness,
  teamlistsLoaded,
  teamsWithLoadedList
}){
  const expectedTeams = expectedTeamsForRound(fixturesJson, round);
  const expectedSet = new Set(expectedTeams);
  const loadedSet = new Set(asArray(teamsWithLoadedList).map(fixtureTeamCanonFromValue).filter(Boolean));
  const byTeam = {};
  const bySource = {};

  function ensureTeam(team){
    const canon = fixtureTeamCanonFromValue(team) || team || 'UNKNOWN';
    if(!byTeam[canon]){
      byTeam[canon] = {
        team: canon,
        expectedThisRound: expectedSet.has(canon),
        loaded: loadedSet.has(canon),
        totalRecords: 0,
        named: 0,
        expected: 0,
        notNamed: 0,
        injured: 0,
        suspended: 0,
        bye: 0,
        playableJerseyCount: 0,
        playableJerseys: [],
        sourceUrls: [],
        samplePlayers: [],
        status: 'no_records',
        reason: ''
      };
    }
    return byTeam[canon];
  }

  for(const team of expectedTeams) ensureTeam(team);

  for(const [playerName, rec] of Object.entries(teamlists || {})){
    const team = fixtureTeamCanonFromValue(rec?.teamCanonical || rec?.team) || 'UNKNOWN';
    const row = ensureTeam(team);
    const display = String(rec?.displayStatus || '').toUpperCase();
    const role = String(rec?.lineupRole || rec?.selectionRole || '').toLowerCase();
    const jersey = Number(rec?.jersey);
    const sourceUrls = asArray(rec?.sources).map(s => s?.url).filter(Boolean);

    row.totalRecords++;
    if(display === STATUS.NAMED) row.named++;
    else if(display === STATUS.EXPECTED) row.expected++;
    else if(display === STATUS.NOT_NAMED) row.notNamed++;
    else if(display === STATUS.INJURED) row.injured++;
    else if(display === STATUS.SUSPENDED) row.suspended++;
    else if(display === STATUS.BYE) row.bye++;

    const playable = display === STATUS.NAMED && (
      role === 'starter' ||
      role === 'interchange' ||
      (Number.isFinite(jersey) && jersey >= 1 && jersey <= 17)
    );

    if(playable && Number.isFinite(jersey)) row.playableJerseys.push(jersey);

    for(const url of sourceUrls){
      row.sourceUrls.push(url);
      if(!bySource[url]) bySource[url] = {url, records:0, teams:{}};
      bySource[url].records++;
      bySource[url].teams[team] = (bySource[url].teams[team] || 0) + 1;
    }

    if(row.samplePlayers.length < 8){
      row.samplePlayers.push({
        player: playerName,
        status: rec?.displayStatus || '',
        selectionStatus: rec?.selectionStatus || '',
        role: rec?.lineupRole || rec?.selectionRole || '',
        jersey: Number.isFinite(jersey) ? jersey : null,
        source: sourceUrls[0] || '',
        reason: rec?.reason || ''
      });
    }
  }

  for(const row of Object.values(byTeam)){
    row.playableJerseys = [...new Set(row.playableJerseys)].sort((a,b)=>a-b);
    row.playableJerseyCount = row.playableJerseys.length;
    row.sourceUrls = [...new Set(row.sourceUrls)].sort();

    if(row.loaded){
      row.status = 'loaded';
      row.reason = 'Trusted playable team-list coverage reached loader threshold.';
    }else if(row.expectedThisRound && row.playableJerseyCount > 0){
      row.status = 'partial_parse_below_threshold';
      row.reason = `Only ${row.playableJerseyCount} playable jerseys parsed; 16 required before NOT_NAMED inference is trusted.`;
    }else if(row.expectedThisRound && row.totalRecords > 0){
      row.status = 'records_without_playable_coverage';
      row.reason = 'Records were parsed, but not enough playable NAMED jersey evidence was produced.';
    }else if(row.expectedThisRound){
      row.status = 'missing_expected_team';
      row.reason = 'Expected fixture team has no parsed current team-list records.';
    }else if(row.totalRecords > 0){
      row.status = 'non_fixture_records';
      row.reason = 'Records parsed for a team not expected to play this active round.';
    }else{
      row.status = 'not_required_or_no_records';
      row.reason = 'Team not required for this active round, or no records found.';
    }
  }

  const perTeam = Object.values(byTeam).sort((a,b) => {
    if(a.expectedThisRound !== b.expectedThisRound) return a.expectedThisRound ? -1 : 1;
    return a.team.localeCompare(b.team);
  });

  const problemTeams = perTeam.filter(t => t.expectedThisRound && !t.loaded);
  const partialTeams = perTeam.filter(t => t.status === 'partial_parse_below_threshold' || t.status === 'records_without_playable_coverage');
  const missingTeams = perTeam.filter(t => t.status === 'missing_expected_team');
  const sourceDebug = asArray(teamPages).map(page => {
    const text = String(page?.text || '');
    const lower = text.toLowerCase();

    const expectedTeamHits = expectedTeams.map(team => ({
      team,
      found: lower.includes(String(team).toLowerCase()) ||
             lower.includes(String(team).toLowerCase().replace(/[^a-z0-9]+/g, ' '))
    }));

    const jerseyNumberHits = [...text.matchAll(/\b(?:[1-9]|1[0-9]|2[0-5])\b/g)].slice(0, 80).map(m => m[0]);

    return {
      url: page?.url || '',
      sourceName: page?.sourceName || '',
      textLength: text.length,
      startsWith: text.slice(0, 1200),
      containsTeamListWords: /team\s*lists?|team-list|final\s*team|late\s*mail|updated\s*team/i.test(text),
      containsJerseyNumbers: jerseyNumberHits.length > 0,
      jerseyNumberSample: jerseyNumberHits,
      expectedTeamHits,
      sampleAroundTeamList: (() => {
        const idx = lower.indexOf('team list');
        if (idx >= 0) return text.slice(Math.max(0, idx - 400), idx + 1600);
        const idx2 = lower.indexOf('final team');
        if (idx2 >= 0) return text.slice(Math.max(0, idx2 - 400), idx2 + 1600);
        const idx3 = lower.indexOf('late mail');
        if (idx3 >= 0) return text.slice(Math.max(0, idx3 - 400), idx3 + 1600);
        return text.slice(0, 2000);
      })()
    };
  });
  return {
    updated: NOW_ISO,
    round,
    source: 'teamlist audit generated by scripts/update-status.mjs; no player hard-fixes',
    contract: {
      rule: 'GREEN/NAMED requires current club team-list truth; fallback data cannot create green',
      playableThresholdForLoadedClub: 16,
      teamlistsLoaded,
      teamsWithLoadedList: [...loadedSet].sort()
    },
    sourceDiscovery: {
      configured: teamSourceUrls.length,
      fetched: discoveredTeamPages.length,
      used: teamPages.length,
      detectedRound,
      fixtureRound: fixtureInference?.round || 0,
      storedRound: currentRoundMeta?.round || 0,
      usedUrls: teamPages.map(p => p.url),
      rejected: filteredTeamPages?.rejected || []
    },
    sourceDebug,
    importerStats: fetchedTeamStats || {},
    generatedTruth: {
      teamlistsLoaded,
      teamsWithLoadedList: [...loadedSet].sort(),
      teamlistRecordCount: Object.keys(teamlists || {}).length
    },
    completeness: teamlistCompleteness || {},
    summary: {
      expectedTeams: expectedTeams.length,
      loadedTeams: loadedSet.size,
      problemTeams: problemTeams.map(t => t.team),
      partialTeams: partialTeams.map(t => ({
        team: t.team,
        playableJerseyCount: t.playableJerseyCount,
        totalRecords: t.totalRecords
      })),
      missingTeams: missingTeams.map(t => t.team)
    },
    bySource: Object.values(bySource).sort((a,b) => b.records - a.records),
    perTeam
  };
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
  const fixturesJson = await readJson('fixtures.json', {});
  const originFile = await readJson('origin_players.json', {});
  const existingOrigin = await readJson('data/origin.json', {});

  const fixtureInference = fixtureRoundFromDate(fixturesJson);

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
  const round = resolveActiveRound({
    teamlistRound: detectedRound,
    fixtureRound: fixtureInference?.round,
    storedRound: currentRoundMeta?.round,
    envRound: process.env.ACTIVE_ROUND
  });
  const filteredTeamPages = filterTeamPagesForRound(discoveredTeamPages, round, fixturesJson);
  const teamPages = filteredTeamPages.used;
  console.log(JSON.stringify({step:'teamlist_sources', configured:teamSourceUrls.length, fetched:discoveredTeamPages.length, used:teamPages.length, detectedRound, fixtureRound:fixtureInference?.round || 0, storedRound:currentRoundMeta?.round || 0, envRound:process.env.ACTIVE_ROUND || '', round, urls:teamPages.map(p=>p.url), rejected:filteredTeamPages.rejected}, null, 2));

  const backupStats = fromBackupStatus(players, oldPlayerStatus, teamlists, injuries, suspensions, round);

  const injuryPages = await discoverPages(config.casualtyWardUrls || [], 'injury');
  const fetchedTeamStats = fromFetchedTeamlists(players, teamPages, teamlists);
  const fetchedInjuryStats = fromFetchedInjuries(players, injuryPages, injuries);
  const fetchedOriginContext = fromFetchedOriginContext(players, teamPages);
  Object.assign(origin, fetchedOriginContext.players);

  const {playersOut, teamlistsLoaded, teamsWithLoadedList} = combineTruth(players, round, teamlists, injuries, suspensions, origin, oldPlayerStatus, fetchedTeamStats.loadedTeams);
  const teamlistCompleteness = validateTeamlistCompleteness(players, fixturesJson, round, teamlists, teamsWithLoadedList);
    const teamlistAudit = buildTeamlistAudit({round, players, fixturesJson, teamSourceUrls, discoveredTeamPages, teamPages, filteredTeamPages, detectedRound, fixtureInference, currentRoundMeta, teamlists, fetchedTeamStats, teamlistCompleteness, teamlistsLoaded, teamsWithLoadedList});
  console.log(JSON.stringify({step:'teamlist_audit', round, teamlistsLoaded, loadedTeams:teamlistAudit.summary.loadedTeams, problemTeams:teamlistAudit.summary.problemTeams, partialTeams:teamlistAudit.summary.partialTeams, missingTeams:teamlistAudit.summary.missingTeams}, null, 2));
  const summary = summarise(playersOut);
  const weather = await weatherContract(round);
  if(Number(weather?.round) !== Number(round)) throw new Error("Weather round mismatch after resolution");
  const currentRoundContract = {round, phase:teamlistsLoaded ? 'teamlists_loaded' : 'waiting_for_teamlists', updated:NOW_ISO, teamlistsLoaded, detectedRound:detectedRound || null, roundSource:'single_resolver', status:'fresh'};
  const weatherRoundMismatch = Number(weather?.round) !== Number(round);

  const truth = {
    updated: NOW_ISO,
    round,
    roundSource: 'single_resolver',
    source: 'core truth engine - source pages + existing updater files; no hardcoded player fixes',
    teamlistsLoaded,
    teamsWithLoadedList,
    summary,
    dataHealth: {
      ok: teamlistsLoaded,
      warnings: [
        ...(round ? [] : ['Round could not be inferred. Set ACTIVE_ROUND in workflow or data/current_round.json.']),
        ...(teamlistsLoaded ? [] : ['No current team-list data was loaded. No player can be GREEN/NAMED from fallback data.']),
        ...(teamlistCompleteness.incompleteTeams.length ? [`Incomplete current team-list truth. Missing/suspicious clubs: ${teamlistCompleteness.incompleteTeams.join(', ')}`] : []),
        ...(players.length ? [] : ['players.json empty']),
        ...(weatherRoundMismatch ? [`Weather round ${weather?.round ?? 'unknown'} does not match active round ${round || 'unknown'}`] : [])
      ],
      detectedRound,
      roundSource: 'single_resolver',
      fetchedTeamListPages: teamPages.map(p => p.url),
      usedTeamListPages: teamPages.map(p => p.url),
      rejectedTeamListPages: filteredTeamPages.rejected,
      fetchedInjuryPages: injuryPages.map(p => p.url),
      backupStats,
      fetchedTeamStats,
      fetchedInjuryStats,
      fetchedOriginContextStats: {count:fetchedOriginContext.count},
      teamlistCompleteness,
            teamlistAuditReport: 'data/teamlist_audit_report.json',
      teamlistAuditSummary: teamlistAudit.summary,
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
      'Yellow/EXPECTED is allowed for real extended squad, confirmed return-risk windows, explicit test/monitor status, or missing/unconfirmed current team-list truth; verified current team-list omissions remain NOT_NAMED',
      'Injury windows use red through minimum weeks out, then yellow during the return-risk window until maximum weeks/round',
      'Injury pages are scoped to text near the player name; a broad casualty page mention cannot create a player injury/return status',
      'Current team-list NOT_NAMED beats injury return-risk yellow unless the injury window is still red/ruled out',
      'A run with missing expected club team lists must fail before writing generated status truth',
      'A run with suspicious source_missing clusters by club must fail even when fixture team extraction is incomplete',
      'Bye-round clubs are excluded from source_missing cluster failure because no current team list is expected for a bye club',
      'Source-missing cluster failure is limited to clubs playing in the active round fixture list; non-fixture clubs are recorded but do not fail the run'
    ],
    players: playersOut
  };

  if(teamlistCompleteness.incompleteTeams.length){
    console.warn('[warn] Incomplete current team-list truth for round ' + round + '. Missing/suspicious clubs: ' + teamlistCompleteness.incompleteTeams.join(', ') + '. Continuing because NOT_NAMED inference is protected by reliable team-list coverage.');
  }
  const prevPlayers = previousTruth?.players || {};
  const changes = changedStatus(prevPlayers, playersOut);
  const existingChanges = await readJson('data/teamlist_changes.json', []);
  const prevChangeIds = new Set(asArray(existingChanges).map(c => `${c.player}|${c.from}|${c.to}|${c.round||round}`));
  const newChanges = changes.filter(c => !prevChangeIds.has(`${c.player}|${c.from}|${c.to}|${round}`)).map(c => ({...c, round}));
  const allChanges = [...asArray(existingChanges), ...newChanges].slice(-500);
  if(!Number(round)) throw new Error(`Invalid active round before contract writes: ${round}`);
   const roundSpecificContracts = [
    {file:'data/current_round.json', data:currentRoundContract},
    {file:'data/teamlists.json', data:{updated: NOW_ISO, round, loaded: teamlistsLoaded, teamsWithLoadedList, players: teamlists}},
    {file:'data/teamlist_audit_report.json', data:teamlistAudit},
    {file:'data/weather.json', data:weather},
    {file:'data/injuries.json', data:playersContract(round, injuries, 'core truth engine injuries')},
    {file:'data/suspensions.json', data:playersContract(round, suspensions, 'core truth engine suspensions')},
    {file:'data/origin.json', data:playersContract(round, origin, 'core truth engine origin context')},
    {file:'data/notifications.json', data:{updated: NOW_ISO, round, newChanges, allChangeCount: allChanges.length}}
  ].map(c => ({...c, data:strictRoundContract(c.file, c.data, round)}));
  const guardedContracts = Object.fromEntries(roundSpecificContracts.map(c => [c.file, c.data]));
  const baseline = await readJson('data/teamlist_baseline_tuesday.json', {});
  const nextBaseline = teamlistsLoaded && (!baseline?.round || Number(baseline.round) !== Number(round)) ? strictRoundContract('data/teamlist_baseline_tuesday.json', {round, capturedAt: NOW_ISO, players: playersOut}, round) : null;

  await writeJson('data/status_previous.json', previousTruth || {});
  await writeJson('data/status_truth.json', truth);
  await writeJson('data/current_round.json', guardedContracts['data/current_round.json']);
  await writeJson('data/teamlists.json', guardedContracts['data/teamlists.json']);
  await writeJson('data/teamlist_audit_report.json', guardedContracts['data/teamlist_audit_report.json']);
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

  await readBackRoundContract('data/current_round.json', round);
  await readBackRoundContract('data/teamlists.json', round);
  await readBackRoundContract('data/weather.json', round);
  await readBackRoundContract('data/injuries.json', round);
  await readBackRoundContract('data/suspensions.json', round);
  await readBackRoundContract('data/origin.json', round);
  await readBackRoundContract('data/notifications.json', round);
  const validatedCurrentRound = await readJson('data/current_round.json', {});
  const validatedWeather = await readJson('data/weather.json', {});
  console.log(JSON.stringify({
    step: 'contract_validation_passed',
    round,
    current_round: validatedCurrentRound.round,
    weather_round: validatedWeather.round,
    weather_status: validatedWeather.status
  }, null, 2));

  console.log(JSON.stringify({ok:true, round, players:players.length, teamlistsLoaded, summary, newChanges:newChanges.length, warnings:truth.dataHealth.warnings}, null, 2));
}

export {
  parseTeamSectionsFromPage,
  fromKnownPlayerJerseyPatterns,
  fromFetchedTeamlists,
  combineTruth,
  stripHtmlLite,
  normName,
  playerTeam,
  lineupRoleForIndex
};

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if(isDirectRun){
  main().catch(err => {
    console.error('[fatal] update-status.mjs failed');
    console.error(err.stack || err.message || err);
    process.exit(1);
  });
}
