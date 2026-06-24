import fs from "node:fs/promises";

const TEAM_SLUGS = {
  BRI:"brisbane-broncos",
  CBR:"canberra-raiders",
  CBY:"canterbury-bankstown-bulldogs",
  CRO:"cronulla-sutherland-sharks",
  DOL:"dolphins",
  GLD:"gold-coast-titans",
  MAN:"manly-warringah-sea-eagles",
  MEL:"melbourne-storm",
  NEW:"newcastle-knights",
  NQL:"north-queensland-cowboys",
  PAR:"parramatta-eels",
  PEN:"penrith-panthers",
  SOU:"south-sydney-rabbitohs",
  STH:"south-sydney-rabbitohs",
  STI:"st-george-illawarra-dragons",
  SYD:"sydney-roosters",
  WST:"wests-tigers",
  WAR:"warriors"
};

function slugName(name){
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/['�]/g,"")
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

function imageLooksUseful(url){
  const u = cleanUrl(url);
  if(!/^https?:\/\//i.test(u)) return false;

  return (
    /remote\.axd/i.test(u) ||
    /rugbyimages\.statsperform\.com/i.test(u) ||
    /nrl\.com\/.*\.(png|jpg|jpeg|webp)/i.test(u) ||
    /players?|profile|headshot|bodyshot/i.test(u)
  );
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
    while((m = re.exec(html))){
      const u = cleanUrl(m[1]);
      if(imageLooksUseful(u)) all.add(u);
    }
  }

  const attrRe = /\b(?:src|href|content)=["']([^"']+)["']/gi;
  let m;
  while((m = attrRe.exec(html))){
    const u = cleanUrl(m[1]);
    if(imageLooksUseful(u)) all.add(u);
  }

  // NRL often stores image URLs inside escaped JSON, not normal img tags.
  const jsonUrlRe = /https?:\\?\/\\?\/[^"'<>\\\s]+/gi;
  while((m = jsonUrlRe.exec(html))){
    const u = cleanUrl(m[0]);
    if(imageLooksUseful(u)) all.add(u);
  }

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
    urls[0] ||
    "";
}
async function fetchText(url){
  const res = await fetch(url, {
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

  let done = 0;
  let found = 0;

  for(const p of players){
    const name = p.name || p.player || p.fullName || p.playerName;
    const team = String(p.team || p.club || "").toUpperCase();
    const teamSlug = TEAM_SLUGS[team];
    if(!name || !teamSlug) continue;

    const url = `https://www.nrl.com/players/nrl-premiership/${teamSlug}/${slugName(name)}/`;

    try{
      const html = await fetchText(url);

      if(name === "Brandon Smith"){
        console.log("DEBUG Brandon URL:", url);
        console.log("DEBUG Brandon HTML length:", html.length);
        console.log("DEBUG Brandon has remote.axd:", html.includes("remote.axd"));
        console.log("DEBUG Brandon has rugbyimages:", html.includes("rugbyimages"));
        console.log("DEBUG Brandon sample:", html.slice(0,800));
      }

      const image = html ? extractImage(html, name) : "";
      if(image){
        out.players[name] = {
          url: image,
          source: url,
          updatedAt: out.updatedAt
        };
        found++;
      }
    }catch(e){
      // keep going; one failed player must not stop the full file
    }

    done++;
    if(done % 25 === 0) console.log(`checked ${done}, found ${found}`);
    await new Promise(r => setTimeout(r, 120));
  }

  await fs.writeFile("player_photos.json", JSON.stringify(out,null,2) + "\n");
  console.log(`Done. Checked ${done}. Found photos for ${found}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
