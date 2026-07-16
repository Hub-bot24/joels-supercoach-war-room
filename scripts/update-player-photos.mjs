import fs from "node:fs/promises";

import {
  canonicalPlayersFromDatabase,
  identityNames,
  normaliseIdentityName
} from "./lib/player-identity.mjs";

import {
  photoMatchesPlayer,
  photoSourceUrls,
  reconcilePhotoRecords,
  usablePhotoRecord
} from "./lib/player-photo-pipeline.mjs";

const PLAYERS_FILE = "players.json";
const PHOTOS_FILE = "player_photos.json";

const APPLY = process.argv.includes("--apply");
const REPORT = process.argv.includes("--report");

function cleanUrl(url, base = "https://www.zerotackle.com/") {
  if (!url) return "";

  let output = String(url)
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;|&#038;/g, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\"/g, '"')
    .trim();

  if (output.startsWith("//")) {
    output = `https:${output}`;
  }

  if (output.startsWith("/") && base) {
    output = new URL(output, base).toString();
  }

  return output;
}

function badImage(url) {
  return /favicon|badge|icon|sponsor|partner|placeholder|default|crest|team|previewmain|preview-main|mainpreview|(^|[\/_.-])logo([\/_.-]|$)/i.test(
    String(url || "")
  );
}

function usableExtractedPhotoUrl(url) {
  const value = cleanUrl(url);

  if (!value) return false;
  if (!/^https?:\/\//i.test(value)) return false;
  if (/index\.php\?player=/i.test(value)) return false;
  if (/remote\.axd$/i.test(value)) return false;
  if (badImage(value)) return false;

  return (
    /rugbyimages\.statsperform\.com/i.test(value) ||
    /Player(%20|\+)Bodyshots/i.test(value) ||
    /remote\.axd\?/i.test(value) ||
    /\.(png|jpg|jpeg|webp)(\?|$)/i.test(value)
  );
}

function addImage(collection, rawUrl, base) {
  const url = cleanUrl(rawUrl, base);

  if (usableExtractedPhotoUrl(url)) {
    collection.add(url);
  }
}

function extractImage(html, base) {
  const images = new Set();

  const attributePattern =
    /\b(?:src|href|content|data-src|data-original|data-lazy-src)=["']([^"']+)["']/gi;

  let match;

  while ((match = attributePattern.exec(html))) {
    addImage(images, match[1], base);
  }

  const srcsetPattern =
    /\bsrcset=["']([^"']+)["']/gi;

  while ((match = srcsetPattern.exec(html))) {
    for (const entry of match[1].split(",")) {
      const candidate =
        entry.trim().split(/\s+/)[0];

      if (candidate) {
        addImage(images, candidate, base);
      }
    }
  }

  const escapedUrlPattern =
    /https?:\\?\/\\?\/[^"'<>\\\s]+/gi;

  while ((match = escapedUrlPattern.exec(html))) {
    addImage(images, match[0], base);
  }

  const candidates = [...images];

  return (
    candidates.find(url =>
      /rugbyimages\.statsperform\.com/i.test(url) &&
      /Player(%20|\+)Bodyshots/i.test(url)
    ) ||
    candidates.find(url =>
      /remote\.axd\?/i.test(url)
    ) ||
    candidates.find(url =>
      /\.(png|jpg|jpeg|webp)(\?|$)/i.test(url)
    ) ||
    ""
  );
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 SuperCoachWarRoomPhotoUpdater",
      accept:
        "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    return "";
  }

  return response.text();
}

function canonicalCoverage(players, existingRecords) {
  const existingKeys = new Set(
    Object.entries(existingRecords)
      .filter(([, record]) =>
        usablePhotoRecord(record)
      )
      .map(([name]) =>
        normaliseIdentityName(name)
      )
  );

  return new Set(
    players
      .filter(player =>
        identityNames(player).some(name =>
          existingKeys.has(
            normaliseIdentityName(name)
          )
        )
      )
      .map(player => player.name)
  );
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(
      await fs.readFile(file, "utf8")
    );
  } catch {
    return fallback;
  }
}

async function main() {
  const database =
    await readJson(PLAYERS_FILE, {
      players: []
    });

  const existingDatabase =
    await readJson(PHOTOS_FILE, {
      players: {}
    });

  const players =
    canonicalPlayersFromDatabase(database);

  const existingRecords =
    existingDatabase?.players &&
    typeof existingDatabase.players === "object"
      ? existingDatabase.players
      : {};

  const covered =
    canonicalCoverage(
      players,
      existingRecords
    );

  const discoveredRecords = {};

  let checkedPlayers = 0;
  let checkedPages = 0;
  let discovered = 0;

  for (const player of players) {
    if (covered.has(player.name)) {
      continue;
    }

    checkedPlayers++;

    for (const sourceUrl of photoSourceUrls(player)) {
      checkedPages++;

      try {
        const html =
          await fetchText(sourceUrl);

        const imageUrl = html
          ? extractImage(html, sourceUrl)
          : "";

        if (
          !usableExtractedPhotoUrl(imageUrl) ||
          !photoMatchesPlayer(player, imageUrl)
        ) {
          continue;
        }

        discoveredRecords[player.name] = {
          url: imageUrl,
          source: sourceUrl
        };

        discovered++;
        break;
      } catch {
        // Continue to the next identity-derived source.
      }
    }
  }

  const updatedAt =
    new Date().toISOString();

  const result =
    reconcilePhotoRecords({
      players,
      existingRecords,
      discoveredRecords,
      updatedAt
    });

  const output = {
    ...existingDatabase,
    updatedAt,
    players: result.records
  };

  const summary = {
    mode: APPLY ? "apply" : "dry-run",
    canonicalPlayers: players.length,
    existingPhotoRecords:
      Object.keys(existingRecords).length,
    alreadyCovered: covered.size,
    checkedPlayers,
    checkedPages,
    discovered,
    outputPhotoRecords:
      result.audit.outputCount,
    added: result.audit.added.length,
    preserved:
      result.audit.preserved.length,
    unmatched:
      result.audit.unmatched.length,
    ambiguous:
      result.audit.ambiguous.length,
    invalid:
      result.audit.invalid.length
  };

  console.log(
    JSON.stringify(summary, null, 2)
  );

  if (REPORT) {
    const proposedAdditions =
      result.audit.added.map(canonicalName => ({
        canonicalName,
        ...result.records[canonicalName]
      }));

    console.log(
      JSON.stringify(
        {
          proposedAdditions
        },
        null,
        2
      )
    );
  }

  if (!APPLY) {
    console.log(
      "Dry run only. Use --apply to write player_photos.json."
    );

    return;
  }

  await fs.writeFile(
    PHOTOS_FILE,
    `${JSON.stringify(output, null, 2)}\n`
  );

  console.log(
    "Applied photo update safely."
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
