const UA = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";
const res = await fetch("https://www.nrlsupercoachstats.com/robots.txt", { headers: { "user-agent": UA } });
const text = await res.text();
console.log("[diag] nrlsupercoachstats.com/robots.txt status:", res.status, "length:", text.length);
console.log(text);
