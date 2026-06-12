#!/usr/bin/env node
/*
  SuperCoach War Room live status updater
  Rule #1: no hardcoded player fixes. All player statuses come from source pages + generic parser rules.
  Outputs:
    data/teamlists.json
    data/injuries.json
    data/status_truth.json
*/
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const YEAR = Number(process.env.SEASON || new Date().getFullYear());
const ACTIVE_ROUND = Number(process.env.ACTIVE_ROUND || 0);

const TEAM_ALIASES = {
  broncos: [/\bbroncos\b/i, /\bbrisbane\b/i],
  raiders: [/\braiders\b/i, /\bcanberra\b/i],
  bulldogs: [/\bbulldogs\b/i, /\bcanterbury\b/i],
  sharks: [/\bsharks\b/i, /\bcronulla\b/i],
  titans: [/\btitans\b/i, /\bgold coast\b/i],
  'sea eagles': [/\bsea eagles\b/i, /\bmanly\b/i],
  storm: [/\bstorm\b/i, /\bmelbourne\b/i],
  knights: [/\bknights\b/i, /\bnewcastle\b/i],
  warriors: [/\bwarriors\b/i, /\bnew zealand\b/i],
  cowboys: [/\bcowboys\b/i, /\bnorth queensland\b/i],
  eels: [/\beels\b/i, /\bparramatta\b/i],
  panthers: [/\bpanthers\b/i, /\bpenrith\b/i],
  rabbitohs: [/\brabbitohs\b/i, /\bsouth sydney\b/i, /\bsouths\b/i],
  dragons: [/\bdragons\b/i, /\bst george\b/i, /\billawarra\b/i],
  roosters: [/\broosters\b/i, /\bsydney roosters\b/i],
  tigers: [/\btigers\b/i, /\bwests\b/i],
  dolphins: [/\bdolphins\b/i]
};
const TEAMS = Object.keys(TEAM_ALIASES);

function normName(v=''){
  return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function keyName(v=''){
  return normName(v).toLowerCase().replace(/[^a-z0-9]/g,'');
}
function teamKey(v=''){
  const s=String(v||'').toLowerCase();
  for(const [key,res] of Object.entries(TEAM_ALIASES)) if(res.some(re=>re.test(s))) return key;
  return s.replace(/[^a-z0-9 ]/g,'').trim();
}
async function readJson(rel, fallback){
  try{return JSON.parse(await fs.readFile(path.join(ROOT,rel),'utf8'))}catch{return fallback}
}
async function writeJson(rel, obj){
  await fs.mkdir(path.dirname(path.join(ROOT,rel)),{recursive:true});
  await fs.writeFile(path.join(ROOT,rel), JSON.stringify(obj,null,2)+'\n');
}
async function fetchText(url){
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 SuperCoachWarRoomBot/1.0'}});
  if(!r.ok) throw new Error(`${url} ${r.status}`);
  return await r.text();
}
function htmlToText(html){
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|tr|section)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&#8217;|&rsquo;/g,'’')
    .replace(/&#x27;|&#39;/g,"'")
    .replace(/\r/g,'')
    .replace(/[ \t]+/g,' ')
    .replace(/\n{2,}/g,'\n')
    .trim();
}
function linksFromHtml(html, base){
  const out=[];
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(html))){
    try{
      const url=new URL(m[1],base).href;
      const text=htmlToText(m[2]);
      out.push({url,text});
    }catch{}
  }
  return out;
}
function inferRoundFromFixtures(fixtures){
  const now=Date.now();
  const flat=[];
  function walk(x){
    if(Array.isArray(x)) return x.forEach(walk);
    if(!x||typeof x!=='object')return;
    const round=Number(x.round||x.roundNumber||x.round_number||x.scRound||x.nrlRound);
    const date=x.kickoffLocal||x.kickoff||x.date||x.matchDate||x.startTime||x.start;
    const t=date?new Date(date).getTime():NaN;
    if(Number.isFinite(round)&&Number.isFinite(t)) flat.push({round,t});
    Object.values(x).forEach(v=>{if(v&&typeof v==='object')walk(v)});
  }
  walk(fixtures);
  flat.sort((a,b)=>a.t-b.t);
  if(!flat.length)return ACTIVE_ROUND||1;
  const buffer=10*60*60*1000;
  const upcoming=flat.find(m=>m.t+buffer>=now);
  return upcoming?.round || flat.at(-1).round;
}
function extractPlayerNumbers(segment){
  const clean=segment.replace(/\s+/g,' ');
  const players=[];
  const re=/(?:^|\s)([1-9]|1[0-9]|2[0-9])\.\s+([A-Z][A-Za-zÀ-ÿ'’.-]+(?:\s+(?:[A-Z][A-Za-zÀ-ÿ'’.-]+|[a-z]{2,})){0,4})(?=\s+(?:[1-9]|1[0-9]|2[0-9])\.|\s+(?:Coach|Analysis|Late Mail|Reserves|Interchange|Team|Ins:|Outs:)|$)/g;
  let m;
  while((m=re.exec(clean))){
    const jersey=Number(m[1]);
    let name=normName(m[2]).replace(/\b(?:captain|coach|analysis|late|mail|reserves|interchange)$/i,'').trim();
    if(name.split(' ').length>=1 && name.length>2) players.push({jersey,name});
  }
  const seen=new Set();
  return players.filter(p=>{const k=p.jersey+'-'+keyName(p.name);if(seen.has(k))return false;seen.add(k);return true});
}
function extractTeamSections(text){
  const sections={};
  for(const team of TEAMS){
    const aliases=[team,...TEAM_ALIASES[team].map(re=>re.source.replace(/\\b/g,'').replace(/\|/g,' '))].map(x=>String(x).replace(/[\\^$.*+?()[\]{}|]/g,'\\$&'));
    const teamPart=`(?:${aliases.join('|')})`;
    const re=new RegExp(`${teamPart}\\s+(?:team|line[- ]?up|squad)\\s*:?([\\s\\S]{0,4500}?)(?=\\n\\s*(?:${TEAMS.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})\\s+(?:team|line[- ]?up|squad)\\s*:|\\n\\s*(?:THURSDAY|FRIDAY|SATURDAY|SUNDAY|MONDAY)\\b|$)`,'i');
    const m=text.match(re);
    if(m) sections[team]=m[1];
  }
  return sections;
}
function parseTeamListsFromText(text, round, sourceUrl){
  const sections=extractTeamSections(text);
  const teams={};
  for(const [team,segment] of Object.entries(sections)){
    const numbered=extractPlayerNumbers(segment);
    if(numbered.length<10) continue;
    const final17=numbered.filter(p=>p.jersey>=1&&p.jersey<=17).map(p=>p.name);
    const extended=numbered.filter(p=>p.jersey>17).map(p=>p.name);
    teams[team]={
      source: sourceUrl,
      final17,
      extended,
      players: numbered.map(p=>({name:p.name, jersey:p.jersey, role:p.jersey<=17?'final17':'extended'}))
    };
  }
  return {round,teams};
}
async function discoverTeamListUrl(round, config){
  if(process.env.TEAMLIST_URL) return process.env.TEAMLIST_URL;
  for(const url of config.teamlistIndexUrls||[]){
    try{
      const html=await fetchText(url);
      const links=linksFromHtml(html,url);
      const hit=links.find(l=>new RegExp(`round\\s*${round}.*team\\s*lists|team\\s*lists.*round\\s*${round}`,'i').test(l.text+' '+l.url));
      if(hit)return hit.url;
    }catch(e){console.warn('teamlist index failed',url,e.message)}
  }
  return null;
}
function parseInjuries(text, sourceUrl){
  const injuries={};
  const lines=text.split('\n').map(normName).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const joined=lines.slice(i,i+5).join(' ');
    const m=joined.match(/Name\s+(.+?)\s+Is a member of the\s+(.+?)\s+Injury:\s+(.+?)(?:\s+Expected return:\s+(.+?)(?:\s|$)|$)/i)
      || joined.match(/^([A-Z][A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'’.-]+){1,3}).*?Injury:\s+(.+?)(?:\s+Expected return:\s+(.+?)(?:\s|$)|$)/i);
    if(m){
      const name=normName(m[1]);
      injuries[name]={name, injury:normName(m[3]||m[2]), expectedReturn:normName(m[4]||m[3]||''), source:sourceUrl};
    }
  }
  return injuries;
}
function returnAfterCurrent(expectedReturn, round){
  const txt=String(expectedReturn||'').toLowerCase();
  const m=txt.match(/round\s*(\d+)/i);
  if(m)return Number(m[1])>Number(round);
  return /indefinite|season|tbc|unknown|finals|month|week/.test(txt);
}
function buildTruth(players, teamlists, injuries, round){
  const byName={};
  const teamByPlayer=new Map();
  for(const [team,node] of Object.entries(teamlists.teams||{})){
    for(const p of node.players||[]){
      teamByPlayer.set(keyName(p.name), {team, role:p.role, jersey:p.jersey, source:node.source});
    }
  }
  const injuryByName=new Map(Object.values(injuries||{}).map(x=>[keyName(x.name),x]));
  for(const p of players){
    const name=typeof p==='string'?p:(p.name||p.player||'');
    if(!name)continue;
    const k=keyName(name);
    const team=teamKey(p.team||p.club||'');
    const injury=injuryByName.get(k);
    const listed=teamByPlayer.get(k);
    if(injury && returnAfterCurrent(injury.expectedReturn,round)){
      byName[name]={key:'injured',available:false,label:'INJURED',reason:`Official casualty ward: ${injury.injury}${injury.expectedReturn?` · expected ${injury.expectedReturn}`:''}`,source:injury.source,updated:new Date().toISOString()};
    }else if(listed?.role==='final17'){
      byName[name]={key:'good',available:true,label:'NAMED',reason:`Named in R${round} team list`,source:listed.source,updated:new Date().toISOString()};
    }else if(listed?.role==='extended'){
      byName[name]={key:'expected',available:true,label:'EXPECTED',reason:`Named in extended squad only`,source:listed.source,updated:new Date().toISOString()};
    }else if(team && teamlists.teams?.[team]){
      byName[name]={key:'notnamed',available:false,label:'NOT NAMED',reason:`Club R${round} team list loaded; player not named`,source:teamlists.teams[team].source,updated:new Date().toISOString()};
    }else {
      byName[name]={key:'expected',available:true,label:'EXPECTED',reason:`No matching club team list loaded for this player/team`,source:'status updater',updated:new Date().toISOString()};
    }
  }
  return byName;
}

const config=await readJson('data/source_config.json', {
  teamlistIndexUrls:[
    'https://www.zerotackle.com/category/nrl/nrl-team-lists/',
    'https://www.zerotackle.com/nrl-team-lists/'
  ],
  casualtyWardUrls:['https://www.nrl.com/casualty-ward/']
});
const fixtures=await readJson('fixtures.json', await readJson('data/fixtures.json', []));
const playersRaw=await readJson('players.json', await readJson('data/players.json', []));
const players=Array.isArray(playersRaw)?playersRaw:(playersRaw.players||[]);
const round=ACTIVE_ROUND || inferRoundFromFixtures(fixtures);
const updated=new Date().toISOString();

let teamlistUrl=await discoverTeamListUrl(round, config);
let teamlists={updated, round, source:teamlistUrl||'none', teams:{}};
if(teamlistUrl){
  const html=await fetchText(teamlistUrl);
  teamlists=parseTeamListsFromText(htmlToText(html), round, teamlistUrl);
  teamlists.updated=updated;
  teamlists.source=teamlistUrl;
}

let injuries={};
for(const url of config.casualtyWardUrls||[]){
  try{Object.assign(injuries, parseInjuries(htmlToText(await fetchText(url)), url));}
  catch(e){console.warn('casualty source failed',url,e.message)}
}
const statusPlayers=buildTruth(players,teamlists,injuries,round);
const statusTruth={
  updated,
  round,
  source:'generated status_truth.json',
  sources:[
    {type:'teamlists',url:teamlistUrl,teamsParsed:Object.keys(teamlists.teams||{}).length},
    ...(config.casualtyWardUrls||[]).map(url=>({type:'injuries',url}))
  ],
  rules:[
    'No hardcoded player fixes',
    'Official/current team list decides NAMED/NOT NAMED',
    'Casualty ward decides INJURED when return is after active round',
    'Missing source data becomes EXPECTED, never NAMED'
  ],
  players:statusPlayers
};
await writeJson('data/teamlists.json', {updated,round,rounds:{[round]:teamlists},teams:teamlists.teams,source:teamlistUrl});
await writeJson('data/injuries.json', {updated,round,players:injuries,sources:config.casualtyWardUrls||[]});
await writeJson('data/status_truth.json', statusTruth);
console.log(`Updated status_truth.json for R${round}. Teams parsed: ${Object.keys(teamlists.teams||{}).length}. Players: ${Object.keys(statusPlayers).length}.`);
if(!teamlistUrl || Object.keys(teamlists.teams||{}).length<8){
  console.error('Team-list parser did not load enough teams. Check data/source_config.json and source page format.');
  process.exitCode=2;
}
