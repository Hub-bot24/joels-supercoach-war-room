import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { chromium } from "playwright";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// Boots the real app in a headless browser against a static file server
// serving this repo's own files - the same static-hosting model the app
// runs under on GitHub Pages, just local and ephemeral. Shared by the
// browser test suite (tests/ui-browser/helpers.mjs) and any production
// script that needs to read a value the live app computes client-side
// (e.g. ProjectionEngine.project) rather than re-implementing that logic
// in Node and risking it drifting from what users actually see.
export async function openApp() {
  const { server, baseUrl } = await startStaticServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  async function close() {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return { page, pageErrors, consoleErrors, close };
}
