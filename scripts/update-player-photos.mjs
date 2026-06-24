import fs from "node:fs/promises";

function scStatsQueryName(name){
  const s = String(name || "").trim();
  if(!s) return "";
  const parts = s.split(/\s+/).filter(Boolean);
  if(parts.length < 2) return s;
  const last = parts.pop();
  return `${last}, ${parts.join(" ")}`;
}

function cleanUrl(url, base="https://www.nrlsupercoachstats.com/"){
  if(!url) return "";
  let out = String(url)
    .replace(/\\u002F/g,"/")
    .replace(/\\\//g,"/")
    .replace(/&amp;/g,"&")
    .replace(/\\u0026/g,"&")
    .replace(/\\"/g,'"')
    .trim();

  if(out.startsWith("//")) out = "https:" + out;
  if(out.startsWith("/")) out = new URL(out, base).toString();
  return out;
}

function badImage(url){
  const u = String(url || "").toLowerCase();
  return /favicon|logo|badge|icon|sponsor|partner|placeholder|default|crest|team/.test(u);
}

function imageLooksUseful(url){
  const u = cleanUrl(url);
  if(!/^https?:\/\//i.test(u)) return false;
  if(badImage(u)) return false;
  return /\.(png|jpg|jpeg|webp)(\?|$)/i.test(u) || /image|player|profile|photo|headshot|portrait/i.test(u);
}

function addUrl(set, raw, base){
  const u = cleanUrl(raw, base);
  if(imageLooksUseful(u)) set.add(u);
}

function extractImage(html, playerName="", base="https://www.nrlsupercoachstats.com/"){
  const all = new Set();

  const imgRe = /<img\b[^>]*>/gi;
  let m;
  while((m = imgRe.exec(html))){
    const tag = m[0];
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || "";
    const dataSrc = tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] || "";
    const alt = tag.match(/\balt=["']([^"']+)["']/i)?.[1] || "";

    if(alt && /player|profile|image/i.test(alt)){
      addUrl(all, src || dataSrc, base);
    }else{
      addUrl(all, src || dataSrc, base);
    }
  }

  const attrRe = /\b(?:src|href|content|data-src)=["']([^"']+)["']/gi;
  while((m = attrRe.exec(html))) addUrl(all, m[1], base);

  const urls = [...all];

  return urls.find(u => /nrlsupercoachstats/i.test(u) && !badImage(u)) ||
         urls.find(u => !badImage(u)) ||
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
  return await res.text();
}

async function main(){
  const raw = JSON.parse(await fs.readFile("players.json","utf8"));
  const players = Array.isArray(raw) ? raw : (raw.players || []);
  const out = { updatedAt: new Date().toISOString(), players: {} };

  let checked = 0;
  let found = 0;

  for(const p of players){
    const name = p.name || p.player || p.fullName || p.playerName;
    const statsName = p.statsSourceName || name;
    if(!name) continue;

    const url = `https://www.nrlsupercoachstats.com/index.php?player=${encodeURIComponent(scStatsQueryName(statsName))}`;

    try{
      const html = await fetchText(url);
      const image = html ? extractImage(html, name, url) : "";

      if(image){
        out.players[name] = {
          url: image,
          source: url,
          updatedAt: out.updatedAt
        };
        found++;
      }
    }catch(e){}

    checked++;
    if(checked % 25 === 0) console.log(`checked ${checked}, found ${found}`);
    await new Promise(r => setTimeout(r, 80));
  }

  await fs.writeFile("player_photos.json", JSON.stringify(out,null,2) + "\n");
  console.log(`Done. Checked ${checked}. Found photos for ${found}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
