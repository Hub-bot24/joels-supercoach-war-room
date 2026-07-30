const UA = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";
const name = "Nathan Cleary";

// Hypothesis 1: the old endpoint needs X-Requested-With to not be empty
const url1 = `https://www.nrlsupercoachstats.com/updatedatatable2026.php?q=${encodeURIComponent(name)}`;
const res1 = await fetch(url1, { headers: { "user-agent": UA, "X-Requested-With": "XMLHttpRequest" } });
const html1 = await res1.text();
console.log("[diag] updatedatatable WITH XMLHttpRequest header -> status", res1.status, "length", html1.length);
console.log(html1.slice(0, 2000));

console.log("=====");

// Hypothesis 2: the real per-round score JSON endpoint
const url2 = `https://www.nrlsupercoachstats.com/highcharts/data-scoresbyrd.php?dropdown1=${encodeURIComponent(name)}&YEAR=2026`;
const res2 = await fetch(url2, { headers: { "user-agent": UA } });
const text2 = await res2.text();
console.log("[diag] data-scoresbyrd.php -> status", res2.status, "length", text2.length);
console.log(text2.slice(0, 3000));
