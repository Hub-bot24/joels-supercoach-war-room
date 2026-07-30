const SEASON = 2026;
const names = ["Cameron Munster", "Nathan Cleary"];
for (const name of names) {
  const url = `https://www.nrlsupercoachstats.com/updatedatatable${SEASON}.php?q=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  const html = await res.text();
  console.log(`[diag] ${name} status:`, res.status, "length:", html.length);
  // Extract just the "2026 Draw" table rows to see if real per-round data is present
  const drawStart = html.indexOf("2026 Draw");
  const drawSection = drawStart !== -1 ? html.slice(drawStart, drawStart + 6000) : "NOT FOUND";
  console.log(`[diag] ${name} draw section:`);
  console.log(drawSection);
  console.log("=====");
}
