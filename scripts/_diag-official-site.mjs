const UA = "Mozilla/5.0 (compatible; SuperCoachWarRoomBot/1.0)";

async function check(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    const text = await res.text();
    console.log(`[diag] ${url} -> status ${res.status}, length ${text.length}`);
    return { url, status: res.status, text };
  } catch (e) {
    console.log(`[diag] ${url} -> FETCH FAILED: ${e.message}`);
    return { url, status: null, text: "" };
  }
}

const robots = await check("https://www.supercoach.com.au/robots.txt");
console.log("[diag] robots.txt content:");
console.log(robots.text.slice(0, 3000));

const home = await check("https://www.supercoach.com.au/");
console.log("[diag] homepage first 2000 chars:");
console.log(home.text.slice(0, 2000));
