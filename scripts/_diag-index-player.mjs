const UA = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";
const url = `https://www.nrlsupercoachstats.com/index.php?player=${encodeURIComponent("Nathan Cleary")}`;
const res = await fetch(url, { headers: { "user-agent": UA } });
const html = await res.text();
console.log("[diag] status:", res.status, "length:", html.length);
const idx = html.indexOf('id="dropdown1"');
console.log("[diag] dropdown1 select + options:");
console.log(html.slice(idx - 50, idx + 2000));
