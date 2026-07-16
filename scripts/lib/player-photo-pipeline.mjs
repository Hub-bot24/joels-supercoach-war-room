import {
  buildIdentityIndex,
  identityNames,
  resolveIdentity
} from "./player-identity.mjs";

export function photoSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function photoSourceUrls(player) {
  const urls = new Set();

  for (const identityName of identityNames(player)) {
    const slug = photoSlug(identityName);

    if (!slug) continue;

    urls.add(
      `https://www.zerotackle.com/players/${slug}/`
    );
  }

  return [...urls];
}

export function usablePhotoRecord(record) {
  const url =
    typeof record === "string"
      ? record
      : record?.url;

  if (!url) return false;

  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:"
    );
  } catch {
    return false;
  }
}

export function reconcilePhotoRecords({
  players,
  existingRecords,
  discoveredRecords,
  updatedAt
}) {
  const canonicalPlayers =
    Array.isArray(players) ? players : [];

  const existing =
    existingRecords &&
    typeof existingRecords === "object"
      ? existingRecords
      : {};

  const discovered =
    discoveredRecords &&
    typeof discoveredRecords === "object"
      ? discoveredRecords
      : {};

  const identityIndex =
    buildIdentityIndex(canonicalPlayers);

  const output = {
    ...existing
  };

  const added = [];
  const preserved = [];
  const unmatched = [];
  const ambiguous = [];
  const invalid = [];

  for (
    const [sourceName, record]
    of Object.entries(discovered)
  ) {
    if (!usablePhotoRecord(record)) {
      invalid.push({
        sourceName,
        reason: "Invalid photo record"
      });

      continue;
    }

    const resolution =
      resolveIdentity(identityIndex, sourceName);

    if (resolution.status === "unmatched") {
      unmatched.push({
        sourceName,
        reason: "No canonical identity"
      });

      continue;
    }

    if (resolution.status === "ambiguous") {
      ambiguous.push({
        sourceName,
        candidates:
          resolution.candidates.map(
            player => player.name
          )
      });

      continue;
    }

    const canonicalName =
      resolution.player.name;

    if (usablePhotoRecord(output[canonicalName])) {
      preserved.push(canonicalName);
      continue;
    }

    output[canonicalName] = {
      ...(typeof record === "string"
        ? { url: record }
        : record),
      updatedAt:
        record?.updatedAt || updatedAt
    };

    added.push(canonicalName);
  }

  return {
    records: output,
    audit: {
      existingCount:
        Object.keys(existing).length,
      outputCount:
        Object.keys(output).length,
      added,
      preserved,
      unmatched,
      ambiguous,
      invalid
    }
  };
}
export function photoMatchesPlayer(player, imageUrl) {
  if (!usablePhotoRecord({ url: imageUrl })) {
    return false;
  }

  let parsed;

  try {
    parsed = new URL(imageUrl);
  } catch {
    return false;
  }

  const pathname = decodeURIComponent(
    parsed.pathname
  ).toLowerCase();

  const basename =
    pathname.split("/").filter(Boolean).at(-1) || "";

  if (
    basename === "body-shot.png" ||
    basename === "bodyshot.png" ||
    /\/fallback\/body-?shot\.(png|jpg|jpeg|webp)$/i.test(
      pathname
    )
  ) {
    return false;
  }


  if (
    /player(%20|\+)bodyshots/i.test(
      imageUrl
    )
  ) {
    return true;
  }

  const tokens = identityNames(player)
    .flatMap(name =>
      String(name || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
    )
    .filter(token => token.length >= 4);

  return tokens.some(token =>
    basename.includes(token)
  );
}
