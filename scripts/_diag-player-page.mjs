const SEASON = 2026;
const url = `https://www.nrlsupercoachstats.com/updatedatatable${SEASON}.php?q=${encodeURIComponent("Nathan Cleary")}`;
const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
const html = await res.text();
console.log("[diag] status:", res.status, "length:", html.length);
console.log("[diag] full html:");
console.log(html);
