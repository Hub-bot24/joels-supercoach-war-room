export const QUARANTINED_IDENTITY_STATUS =
  "quarantined-enrichment-orphan";

export function normaliseIdentityName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc'`]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function cleanName(value) {
  return String(value || "").trim();
}

export function isQuarantinedIdentity(player) {
  return (
    cleanName(player?.identityStatus) ===
    QUARANTINED_IDENTITY_STATUS
  );
}

export function explicitIdentityAliases(player) {
  const values = [
    player?.sourceName,
    player?.statsSourceName,
    ...(Array.isArray(player?.aliases)
      ? player.aliases
      : []),
    ...(Array.isArray(player?.sourceAliases)
      ? player.sourceAliases
      : [])
  ];

  const seenRaw = new Set();
  const aliases = [];

  for (const value of values) {
    const clean = cleanName(value);

    if (!clean || seenRaw.has(clean)) {
      continue;
    }

    seenRaw.add(clean);
    aliases.push(clean);
  }

  return aliases;
}

export function identityNames(player) {
  const values = [
    cleanName(player?.name),
    ...explicitIdentityAliases(player)
  ];

  const seenRaw = new Set();
  const names = [];

  for (const value of values) {
    if (!value || seenRaw.has(value)) {
      continue;
    }

    seenRaw.add(value);
    names.push(value);
  }

  return names;
}

export function buildIdentityIndex(players) {
  const index = new Map();

  for (const player of players || []) {
    if (isQuarantinedIdentity(player)) {
      continue;
    }

    for (const identityName of identityNames(player)) {
      const key = normaliseIdentityName(
        identityName
      );

      if (!key) continue;

      if (!index.has(key)) {
        index.set(key, new Set());
      }

      index.get(key).add(player);
    }
  }

  return index;
}

export function resolveIdentity(index, sourceName) {
  const key = normaliseIdentityName(sourceName);

  const candidates = key
    ? [...(index.get(key) || [])]
    : [];

  if (candidates.length === 0) {
    return {
      status: "unmatched",
      sourceName,
      candidates: []
    };
  }

  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      sourceName,
      candidates
    };
  }

  return {
    status: "matched",
    sourceName,
    player: candidates[0],
    candidates
  };
}
export function canonicalPlayersFromDatabase(database) {
  return Array.isArray(database?.players)
    ? database.players.filter(
        player => !isQuarantinedIdentity(player)
      )
    : [];
}

export function quarantinedPlayersFromDatabase(database) {
  const embedded = Array.isArray(
    database?.identityQuarantine?.records
  )
    ? database.identityQuarantine.records
    : [];

  const legacy = Array.isArray(database?.players)
    ? database.players.filter(isQuarantinedIdentity)
    : [];

  return [...embedded, ...legacy];
}
