const UA = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";
const url = `https://www.nrlsupercoachstats.com/index.php?player=${encodeURIComponent("Nathan Cleary")}`;
const res = await fetch(url, { headers: { "user-agent": UA } });
const html = await res.text();
console.log("[diag] status:", res.status, "length:", html.length);
// Find all <script> blocks and print any that mention "chart4" or ajax/data-loading patterns
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
console.log("[diag] total <script> blocks:", scripts.length);
scripts.forEach((s, i) => {
  if (/chart4|chart\(|ajax|XMLHttpRequest|fetch\(|txtHint|onchange|\.php\?/.test(s)) {
    console.log(`--- script block ${i} (length ${s.length}) ---`);
    console.log(s.slice(0, 4000));
  }
});
