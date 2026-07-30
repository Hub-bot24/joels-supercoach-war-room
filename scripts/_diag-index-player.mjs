const UA = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";
const name = "Cleary, Nathan";

const url1 = `https://www.nrlsupercoachstats.com/updatedatatable2026.php?q=${encodeURIComponent(name)}`;
const res1 = await fetch(url1, { headers: { "user-agent": UA } });
const html1 = await res1.text();
console.log("[diag] updatedatatable with 'Cleary, Nathan' -> status", res1.status, "length", html1.length);
console.log(html1.slice(0, 1500));

console.log("=====");

const url2 = `https://www.nrlsupercoachstats.com/highcharts/data-scoresbyrd.php?dropdown1=${encodeURIComponent(name)}&YEAR=2026`;
const res2 = await fetch(url2, { headers: { "user-agent": UA } });
const text2 = await res2.text();
console.log("[diag] data-scoresbyrd.php with 'Cleary, Nathan' -> status", res2.status, "length", text2.length);
console.log(text2);
