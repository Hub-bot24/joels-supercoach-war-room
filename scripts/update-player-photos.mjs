import fs from "node:fs/promises";

const TEAM_INFO = {
  BRI:{host:"www.broncos.com.au",slug:"brisbane-broncos"},
  CBR:{host:"www.raiders.com.au",slug:"canberra-raiders"},
  CBY:{host:"www.bulldogs.com.au",slug:"canterbury-bankstown-bulldogs"},
  CRO:{host:"www.sharks.com.au",slug:"cronulla-sutherland-sharks"},
  DOL:{host:"www.dolphinsnrl.com.au",slug:"dolphins"},
  GLD:{host:"www.titans.com.au",slug:"gold-coast-titans"},
  MAN:{host:"www.seaeagles.com.au",slug:"manly-warringah-sea-eagles"},
  MEL:{host:"www.melbournestorm.com.au",slug:"melbourne-storm"},
  NEW:{host:"www.newcastleknights.com.au",slug:"newcastle-knights"},
  NQL:{host:"www.cowboys.com.au",slug:"north-queensland-cowboys"},
  PAR:{host:"www.parraeels.com.au",slug:"parramatta-eels"},
  PEN:{host:"www.penrithpanthers.com.au",slug:"penrith-panthers"},
  SOU:{host:"www.rabbitohs.com.au",slug:"south-sydney-rabbitohs"},
  STH:{host:"www.rabbitohs.com.au",slug:"south-sydney-rabbitohs"},
  STI:{host:"www.dragons.com.au",slug:"st-george-illawarra-dragons"},
  SYD:{host:"www.roosters.com.au",slug:"sydney-roosters"},
  WST:{host:"www.weststigers.com.au",slug:"wests-tigers"},
  WAR:{host:"www.warriors.kiwi",slug:"one-new-zealand-warriors"}
};

function slugName(name){
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/['’]/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

function cleanUrl(url){
  if(!url) return "";
  let out = String(url)
    .replace(/\\u002F/g,"/")
    .replace(/\\\//g,"/")
    .replace(/&amp;/g,"&")
    .replace(/\\u0026/g,"&")
    .replace(/\\"/g,'"')
    .trim();

  if(out.startsWith("//")) out = "https:" + out;
  if(out.startsWith("/")) out = "https://www.nrl.com" + out;
  return out;
}

function badImage(url){
  const u = String(url || "").toLowerCase();
  return /favicon|logo|badge|icon|sponsor|partner|placeholder|default|avatar-default|crest|jersey/.test(u);
}

function imageLooksUseful(url){
  const u = cleanUrl(url);
  if(!/^https?:\/\//i.test(u)) return false;
  if(badImage(u)) return false;

  return (
    /remote\.axd/i.test(u) ||
    /rugbyimages\.statsperform\.com/i.test(u) ||
    /player|profile|headshot|bodyshot|body-shot|portrait/i.test(u) ||
    /\.(png|jpg|jpeg|webp)(\?|$)/i.test(u)
  );
}

function addUrl(set, raw){
  const u = cleanUrl(raw);
  if(imageLooksUseful(u)) set.add(u);
}

function extractImage(html, playerName=""){
  const all = new Set();

  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/ig,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/ig
  ];

  for(const re of metaPatterns){
    let m;
    while((m = re.exec(html))) addUrl(all, m[1]);
  }

  const attrRe = /\b(?:src|href|content)=["']([^"']+)["']/gi;
  let m;
  while((m = attrRe.exec(html))) addUrl(all, m[1]);

  const srcsetRe = /\bsrcset=["']([^"']+)["']/gi;
  while((m = srcsetRe.exec(html))){
    for(const part of m[1].split(",")){
      addUrl(all, part.trim().split(/\s+/)[0]);
    }
  }

  const jsonUrlRe = /https?:\\?\/\\?\/[^"'<>\\\s]+/gi;
  while((m = jsonUrlRe.exec(html))) addUrl(all, m[0]);

  const urls = [...all];

  const nameBits = String(playerName || "")
    .toLowerCase()
    .replace(/['’]/g,"")
    .split(/\s+/)
    .filter(Boolean);

  const nameMatch = urls.find(u => {
    const low = decodeURIComponent(cleanUrl(u)).toLowerCase().replace(/['’]/g,"");
    return nameBits.length && nameBits.every(part => low.includes(part));
  });

  return nameMatch ||
    urls.find(u => /remote\.axd/i.test(u)) ||
    urls.find(u => /rugbyimages\.statsperform\.com/i.test(u)) ||
    urls.find(u => /player|profile|headshot|bodyshot|portrait/i.test(u)) ||
    "";
}

async function fetchText(url){
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 player-photo-builder",
      "accept": "text/html,application/xhtml+xml"
    }
  });
  if(!res.ok) return "";
  const html = await res.text();

  // Central NRL sometimes returns a login form. Ignore that page.
  if(/Submit This Form|signin-nrl|login_required/i.test(html)) return "";

  return html;
}

async function main(){
  const raw = JSON.parse(await fs.readFile("players.json","utf8"));
  const players = Array.isArray(raw) ? raw : (raw.players || []);
  const out = { updatedAt: new Date().toISOString(), players: {} };

  let checked = 0;
  let found = 0;

  for(const p of players){
    const name = p.name || p.player || p.fullName || p.playerName;
    const team = String(p.team || p.club || "").toUpperCase();
    const info = TEAM_INFO[team];
    if(!name || !info) continue;

    const playerSlug = slugName(name);

    const urls = [
      `https://${info.host}/teams/nrl-premiership/${info.slug}/${playerSlug}/`,
      `https://www.nrl.com/players/nrl-premiership/${info.slug}/${playerSlug}/`
    ];

    let image = "";
    let source = "";

    for(const url of urls){
      try{
        const html = await fetchText(url);
        image = html ? extractImage(html, name) : "";
        if(image){
          source = url;
          break;
        }
      }catch(e){}
    }

    if(image){
      out.players[name] = {
        url: image,
        source,
        updatedAt: out.updatedAt
      };
      found++;
    }

    checked++;
    if(checked % 25 === 0) console.log(`checked ${checked}, found ${found}`);
    await new Promise(r => setTimeout(r, 120));
  }

  await fs.writeFile("player_photos.json", JSON.stringify(out,null,2) + "\n");
  console.log(`Done. Checked ${checked}. Found photos for ${found}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
