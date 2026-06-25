import fs from "node:fs/promises";

function slugName(name){
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/['�]/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

function photoSearchName(name){
  const key = slugName(name);
  const aliases = {
    "sua-faalogo": "Sualauvi Faalogo"
  };
  return aliases[key] || name;
}
function cleanUrl(url, base="https://www.zerotackle.com/"){
  if(!url) return "";
  let out = String(url)
    .replace(/\\u002F/g,"/")
    .replace(/\\\//g,"/")
    .replace(/&amp;/g,"&")
    .replace(/\\u0026/g,"&")
    .replace(/\\"/g,'"')
    .trim();

  if(out.startsWith("//")) out = "https:" + out;
  if(out.startsWith("/") && base) out = new URL(out, base).toString();
  return out;
}

function badImage(url){
  const u = String(url || "").toLowerCase();
  return /favicon|logo|badge|icon|sponsor|partner|placeholder|default|crest|team|previewmain|preview-main|mainpreview/.test(u);
}

function isRealPlayerImage(url){
  const u = cleanUrl(url);
  if(!/^https?:\/\//i.test(u)) return false;
  if(badImage(u)) return false;

  return (
    /rugbyimages\.statsperform\.com\/Player%20Bodyshots/i.test(u) ||
    /rugbyimages\.statsperform\.com\/Player\+Bodyshots/i.test(u) ||
    /Player%20Bodyshots/i.test(u) ||
    /Player\+Bodyshots/i.test(u) ||
    (/remote\\.axd\\?/i.test(u) || /rugbyimages\\.statsperform\\.com/i.test(u))
  );
}

function addImage(set, raw, base){
  const u = cleanUrl(raw, base);
  if(isRealPlayerImage(u)) set.add(u);
}

function extractImage(html, base){
  const all = new Set();
  let m;

  const attrRe = /\b(?:src|href|content|data-src|data-original|data-lazy-src)=["']([^"']+)["']/gi;
  while((m = attrRe.exec(html))) addImage(all, m[1], base);

  const srcsetRe = /\bsrcset=["']([^"']+)["']/gi;
  while((m = srcsetRe.exec(html))){
    for(const part of m[1].split(",")){
      const u = part.trim().split(/\s+/)[0];
      if(u) addImage(all, u, base);
    }
  }

  const jsonUrlRe = /https?:\\?\/\\?\/[^"'<>\\\s]+/gi;
  while((m = jsonUrlRe.exec(html))) addImage(all, m[0], base);

  const urls = [...all];

return urls.find(u => /rugbyimages\.statsperform\.com/i.test(u) && /Player(%20|\+)Bodyshots/i.test(u)) ||
  urls.find(u => /remote\.axd\?/i.test(u)) ||
  urls.find(u => /\.(png|jpg|jpeg|webp)(\?|$)/i.test(u) && !/previewMain|logo|badge|crest|favicon/i.test(u)) ||
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

function usableExtractedPhotoUrl(url){
  const u = String(url || "");
  if(!u) return false;
  if(/index\.php\?player=/i.test(u)) return false;
  if(/previewMain|preview-main|placeholder|logo|badge|crest|favicon|default/i.test(u)) return false;
  if(/remote\.axd$/i.test(u)) return false;
  return /rugbyimages\.statsperform\.com|Player%20Bodyshots|Player\+Bodyshots|remote\.axd\?/i.test(u) || /\.(png|jpg|jpeg|webp)(\?|$)/i.test(u);
}
async function main(){
  const raw = JSON.parse(await fs.readFile("players.json","utf8"));
  const players = Array.isArray(raw) ? raw : (raw.players || []);
  const out = { updatedAt: new Date().toISOString(), players: {} };

  let checked = 0;
  let found = 0;

  for(const p of players){
    const name = p.name || p.player || p.fullName || p.playerName;
    if(!name) continue;

    const url = `https://www.zerotackle.com/players/${slugName(photoSearchName(name))}/`;

    try{
      const html = await fetchText(url);
      const image = html ? extractImage(html, url) : "";

      if(usableExtractedPhotoUrl(image)){
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
    await new Promise(r => setTimeout(r, 120));
  }

  await fs.writeFile("player_photos.json", JSON.stringify(out,null,2) + "\n");
  console.log(`Done. Checked ${checked}. Found photos for ${found}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
