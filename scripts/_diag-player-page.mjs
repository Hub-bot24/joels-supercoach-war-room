const SEASON = 2026;
const USER_AGENT = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";
const names = ["Cameron Munster"];
for (const name of names) {
  const url = `https://www.nrlsupercoachstats.com/updatedatatable${SEASON}.php?q=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  const html = await res.text();
  console.log(`[diag] ${name} status:`, res.status, "length:", html.length);
  console.log(`[diag] ${name} FULL HTML:`);
  console.log(html);
}
