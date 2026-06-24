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
    .replace(/['’]/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

function extractImage(html){
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];
  for(const re of patterns){
    const m = html.match(re);
    if(m?.[1] && /^https?:\/\//i.test(m[1])) return m[1];
  }
  return "";
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
      const image = html ? extractImage(html) : "";
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
