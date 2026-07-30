const UA = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";
const names = ["Nathan Cleary", "Cameron Munster"];
for (const name of names) {
  const url = `https://www.nrlsupercoachstats.com/index.php?player=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  const html = await res.text();
  console.log(`[diag] ${name} -> status ${res.status}, length ${html.length}`);
  const drawIdx = html.indexOf("Draw");
  console.log(`[diag] ${name} snippet around "Draw":`, drawIdx !== -1 ? html.slice(drawIdx - 200, drawIdx + 3000) : "NOT FOUND");
  console.log("=====");
}
