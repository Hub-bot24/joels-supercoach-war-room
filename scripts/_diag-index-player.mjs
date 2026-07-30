const UA = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";
const url = `https://www.nrlsupercoachstats.com/index.php?player=${encodeURIComponent("Nathan Cleary")}`;
const res = await fetch(url, { headers: { "user-agent": UA } });
const html = await res.text();
console.log("[diag] status:", res.status, "length:", html.length);
// Find the body content, skip the nav menu
const bodyIdx = html.indexOf("</nav>");
const altBodyIdx = bodyIdx !== -1 ? bodyIdx : html.indexOf("<body");
console.log("[diag] content from offset", altBodyIdx, "to +6000:");
console.log(html.slice(altBodyIdx, altBodyIdx + 6000));
