import {
  explicitIdentityAliases,
  normaliseIdentityName,
  QUARANTINED_IDENTITY_STATUS
} from "./player-identity.mjs";

const ENRICHMENT_SOURCE =
  "nrlsupercoachstats-public";

const TRANSFERABLE_FIELDS = Object.freeze([
  "price",
  "breakeven",
  "breakevenStatus",
  "lastDataUpdate"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value || "").trim();
}

function isMeaningful(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

export function hasCanonicalTeam(player) {
  return Boolean(
    clean(player?.team) ||
    clean(player?.sourceTeam)
  );
}

export function isEnrichmentOrphan(player) {
  return (
    clean(player?.dataSource) ===
      ENRICHMENT_SOURCE &&
    !hasCanonicalTeam(player)
  );
}

function buildCanonicalAliasOwners(players) {
  const owners = new Map();

  players.forEach((player, index) => {
    if (!hasCanonicalTeam(player)) {
      return;
    }

    for (
      const alias of explicitIdentityAliases(player)
    ) {
      const key = normaliseIdentityName(alias);

      if (!key) continue;

      if (!owners.has(key)) {
        owners.set(key, []);
      }

      owners.get(key).push({
        index,
        alias,
        canonicalName: player.name
      });
    }
  });

  return owners;
}

export function planIdentityMigration(database) {
  const canonicalPlayers = Array.isArray(database?.players)
    ? database.players
    : [];

  const quarantinedPlayers = Array.isArray(
    database?.identityQuarantine?.records
  )
    ? database.identityQuarantine.records
    : [];

  const players = [
    ...canonicalPlayers,
    ...quarantinedPlayers
  ];

  const aliasOwners =
    buildCanonicalAliasOwners(players);

  const merges = [];
  const quarantines = [];
  const ambiguities = [];

  players.forEach((source, sourceIndex) => {
    if (!isEnrichmentOrphan(source)) {
      return;
    }

    const key = normaliseIdentityName(
      source.name
    );

    const rawOwners = key
      ? aliasOwners.get(key) || []
      : [];

    const uniqueOwners = [
      ...new Map(
        rawOwners.map(owner => [
          owner.index,
          owner
        ])
      ).values()
    ];

    if (uniqueOwners.length > 1) {
      ambiguities.push({
        sourceIndex,
        sourceName: source.name,
        sourceDataSource:
          source.dataSource,
        owners: uniqueOwners.map(
          owner => ({
            canonicalIndex:
              owner.index,
            canonicalName:
              owner.canonicalName,
            explicitAlias:
              owner.alias
          })
        )
      });

      return;
    }

    if (uniqueOwners.length === 0) {
      if (
        clean(source.identityStatus) ===
          QUARANTINED_IDENTITY_STATUS
      ) {
        return;
      }

      quarantines.push({
        sourceIndex,
        sourceName: source.name,
        reason:
          "Enrichment-created record has no explicit canonical alias owner",
        record: clone(source)
      });

      return;
    }

    const owner = uniqueOwners[0];
    const canonical =
      players[owner.index];

    merges.push({
      sourceIndex,
      canonicalIndex:
        owner.index,
      sourceName:
        source.name,
      canonicalName:
        canonical.name,
      evidence: {
        type:
          "explicit-canonical-alias",
        explicitAlias:
          owner.alias,
        sourceDataSource:
          source.dataSource,
        canonicalTeam:
          canonical.team ||
          canonical.sourceTeam
      },
      transferableFields:
        Object.fromEntries(
          TRANSFERABLE_FIELDS.map(
            field => [
              field,
              isMeaningful(source[field])
                ? clone(source[field])
                : null
            ]
          )
        )
    });
  });

  const usedSourceIndexes = new Set();
  const repeatedSources = [];

  for (const merge of merges) {
    if (
      usedSourceIndexes.has(
        merge.sourceIndex
      )
    ) {
      repeatedSources.push(
        merge.sourceIndex
      );
    }

    usedSourceIndexes.add(
      merge.sourceIndex
    );
  }

  const quarantineIndexes = new Set(
    quarantines.map(
      item => item.sourceIndex
    )
  );

  const overlap = merges
    .filter(item =>
      quarantineIndexes.has(
        item.sourceIndex
      )
    )
    .map(item =>
      item.sourceIndex
    );

  return {
    mode: "PLAN",
    originalCount:
      players.length,
    safeMergeCount:
      merges.length,
    quarantineCount:
      quarantines.length,
    ambiguousCount:
      ambiguities.length,

    expectedFinalCount:
      players.length -
      merges.length,

    invalidReuse: {
      repeatedSourceIndexes:
        [...new Set(repeatedSources)],
      mergeAndQuarantineOverlap:
        [...new Set(overlap)]
    },

    merges,
    quarantines,
    ambiguities
  };
}

function addSourceAlias(
  canonical,
  sourceName
) {
  const cleanSourceName =
    clean(sourceName);

  if (!cleanSourceName) {
    return;
  }

  const existingAliases =
    Array.isArray(
      canonical.sourceAliases
    )
      ? canonical.sourceAliases
          .map(clean)
          .filter(Boolean)
      : [];

  const existingEvidence =
    new Set([
      clean(canonical.sourceName),
      clean(
        canonical.statsSourceName
      ),
      ...(
        Array.isArray(
          canonical.aliases
        )
          ? canonical.aliases
              .map(clean)
          : []
      ),
      ...existingAliases
    ].filter(Boolean));

  if (
    !existingEvidence.has(
      cleanSourceName
    )
  ) {
    existingAliases.push(
      cleanSourceName
    );
  }

  if (existingAliases.length > 0) {
    canonical.sourceAliases =
      [...new Set(existingAliases)];
  }
}

function quarantineRecord(
  record,
  quarantine
) {
  const quarantinedAt =
    new Date().toISOString();

  record.identityStatus =
    QUARANTINED_IDENTITY_STATUS;

  record.identityQuarantine = {
    version:
      "v1-enrichment-orphan",
    quarantinedAt,
    reason:
      quarantine.reason,
    sourceName:
      quarantine.sourceName,
    retainedInPlayerDatabase:
      true
  };
}

export function applyIdentityMigration(
  database,
  plan
) {
  if (
    plan.ambiguousCount > 0 ||
    plan.invalidReuse
      .repeatedSourceIndexes
      .length > 0 ||
    plan.invalidReuse
      .mergeAndQuarantineOverlap
      .length > 0
  ) {
    throw new Error(
      "Identity migration plan is unsafe and cannot be applied."
    );
  }

  const result = clone(database);

  const canonicalPlayers =
    Array.isArray(result.players)
      ? result.players
      : [];

  const existingQuarantine =
    Array.isArray(
      result.identityQuarantine?.records
    )
      ? result.identityQuarantine.records
      : [];

  const players = [
    ...canonicalPlayers,
    ...existingQuarantine
  ];

  for (const merge of plan.merges) {
    const source =
      players[merge.sourceIndex];

    const canonical =
      players[merge.canonicalIndex];

    if (!source || !canonical) {
      throw new Error(
        "Migration indexes no longer match the player database."
      );
    }

    for (
      const field of
        TRANSFERABLE_FIELDS
    ) {
      if (
        isMeaningful(source[field])
      ) {
        canonical[field] =
          clone(source[field]);
      }
    }

    canonical.enrichmentSources = {
      ...(canonical.enrichmentSources || {}),
      priceAndBreakeven: {
        source:
          source.dataSource ||
          ENRICHMENT_SOURCE,
        updatedAt:
          source.lastDataUpdate ||
          new Date().toISOString()
      }
    };

    addSourceAlias(
      canonical,
      source.name
    );
  }

  for (
    const quarantine of
      plan.quarantines
  ) {
    const record =
      players[
        quarantine.sourceIndex
      ];

    if (!record) {
      throw new Error(
        "Quarantine index no longer matches the player database."
      );
    }

    quarantineRecord(
      record,
      quarantine
    );
  }

  const mergedSourceIndexes =
    new Set(
      plan.merges.map(
        item => item.sourceIndex
      )
    );

  const retainedRecords =
    players.filter(
      (_, index) =>
        !mergedSourceIndexes.has(index)
    );

  const quarantinedRecords =
    retainedRecords.filter(
      player =>
        player.identityStatus ===
          QUARANTINED_IDENTITY_STATUS
    );

  result.players =
    retainedRecords.filter(
      player =>
        player.identityStatus !==
          QUARANTINED_IDENTITY_STATUS
    );

  result.identityQuarantine = {
    version:
      "v2-separated-retained-quarantine",
    records:
      quarantinedRecords
  };

  const migratedAt =
    new Date().toISOString();

  result.updated = migratedAt;

  result.identityMigration = {
    version:
      "v2-explicit-alias-retained-quarantine",
    migratedAt,
    originalCount:
      plan.originalCount,
    canonicalPlayerCount:
      result.players.length,
    quarantinedPlayerCount:
      result.identityQuarantine.records.length,
    totalPreservedCount:
      result.players.length +
      result.identityQuarantine.records.length,
    mergedCount:
      plan.safeMergeCount,
    retainedQuarantineCount:
      plan.quarantineCount,
    ambiguousCount:
      plan.ambiguousCount
  };

  const totalPreservedCount =
    result.players.length +
    result.identityQuarantine.records.length;

  if (
    totalPreservedCount !==
    plan.expectedFinalCount
  ) {
    throw new Error(
      "Total preserved player count does not match the approved migration plan."
    );
  }

  return result;
}