#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
  applyIdentityMigration,
  planIdentityMigration
} from "./lib/player-identity-migration.mjs";

const ROOT = process.cwd();

const PLAYERS_FILE = path.join(
  ROOT,
  "players.json"
);

const AUDIT_FILE = path.join(
  ROOT,
  "data/player_identity_migration_audit.json"
);

const QUARANTINE_FILE = path.join(
  ROOT,
  "data/player_identity_quarantine.json"
);

const BACKUP_DIRECTORY = path.join(
  ROOT,
  "data/backups"
);

const applyMode =
  process.argv.includes("--apply");

const rawDatabase =
  await fs.readFile(
    PLAYERS_FILE,
    "utf8"
  );

const database =
  JSON.parse(rawDatabase);

const plan =
  planIdentityMigration(database);

const report = {
  generatedAt:
    new Date().toISOString(),

  ...plan,

  mode: applyMode
    ? "APPLY_REQUESTED"
    : "DRY_RUN"
};

console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);

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
    "Identity migration blocked by ambiguity or invalid record reuse."
  );
}

if (!applyMode) {
  console.log(
    "\nDRY RUN ONLY: no files were changed."
  );

  process.exit(0);
}

const timestamp =
  new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

await fs.mkdir(
  BACKUP_DIRECTORY,
  { recursive: true }
);

await fs.mkdir(
  path.dirname(AUDIT_FILE),
  { recursive: true }
);

const backupFile = path.join(
  BACKUP_DIRECTORY,
  `players.before-identity-migration.${timestamp}.json`
);

await fs.writeFile(
  backupFile,
  rawDatabase,
  "utf8"
);

const migratedDatabase =
  applyIdentityMigration(
    database,
    plan
  );

const quarantineReport = {
  generatedAt:
    new Date().toISOString(),

  status:
    "RETAINED_AND_EXCLUDED",

  reason:
    "Enrichment-only records without explicit canonical alias ownership",

  count:
    plan.quarantines.length,

  records:
    plan.quarantines.map(
      item => ({
        sourceIndex:
          item.sourceIndex,
        sourceName:
          item.sourceName,
        reason:
          item.reason,
        retainedInCanonicalPlayers:
          false,
        retainedInIdentityQuarantine:
          true,
        record:
          item.record
      })
    )
};

const completedAudit = {
  ...report,
  mode: "APPLIED",
  backupFile:
    path.relative(
      ROOT,
      backupFile
    ),
  canonicalPlayerCount:
    migratedDatabase
      .players.length,
  quarantinedPlayerCount:
    migratedDatabase
      .identityQuarantine
      .records.length,
  totalPreservedCount:
    migratedDatabase
      .players.length +
    migratedDatabase
      .identityQuarantine
      .records.length
};

const temporaryPlayersFile =
  `${PLAYERS_FILE}.identity-migration.tmp`;

const temporaryAuditFile =
  `${AUDIT_FILE}.tmp`;

const temporaryQuarantineFile =
  `${QUARANTINE_FILE}.tmp`;

await fs.writeFile(
  temporaryPlayersFile,
  JSON.stringify(
    migratedDatabase,
    null,
    2
  ) + "\n",
  "utf8"
);

await fs.writeFile(
  temporaryAuditFile,
  JSON.stringify(
    completedAudit,
    null,
    2
  ) + "\n",
  "utf8"
);

await fs.writeFile(
  temporaryQuarantineFile,
  JSON.stringify(
    quarantineReport,
    null,
    2
  ) + "\n",
  "utf8"
);

await fs.rename(
  temporaryPlayersFile,
  PLAYERS_FILE
);

await fs.rename(
  temporaryAuditFile,
  AUDIT_FILE
);

await fs.rename(
  temporaryQuarantineFile,
  QUARANTINE_FILE
);

console.log(
  "\nMigration applied successfully."
);

console.log(
  `Backup: ${
    path.relative(
      ROOT,
      backupFile
    )
  }`
);

console.log(
  `Original players: ${
    plan.originalCount
  }`
);

console.log(
  `Canonical players: ${
    migratedDatabase.players.length
  }`
);

console.log(
  `Quarantined records: ${
    migratedDatabase
      .identityQuarantine
      .records.length
  }`
);

console.log(
  `Total preserved records: ${
    migratedDatabase.players.length +
    migratedDatabase
      .identityQuarantine
      .records.length
  }`
);

console.log(
  `Merged records: ${
    plan.safeMergeCount
  }`
);

console.log(
  `Retained quarantined records: ${
    plan.quarantineCount
  }`
);