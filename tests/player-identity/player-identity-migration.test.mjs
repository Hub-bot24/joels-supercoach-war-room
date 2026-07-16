import test from "node:test";
import assert from "node:assert/strict";

import {
  applyIdentityMigration,
  planIdentityMigration
} from "../../scripts/lib/player-identity-migration.mjs";

import {
  buildIdentityIndex,
  resolveIdentity
} from "../../scripts/lib/player-identity.mjs";

test("explicit alias orphan is safely merged", () => {
  const database = {
    players: [
      {
        name: "Pat Example",
        sourceName:
          "Patrick Example",
        team: "AAA",
        positions: ["HFB"],
        avg: 80
      },
      {
        name:
          "Patrick Example",
        team: "",
        price: 700000,
        breakeven: 75,
        breakevenStatus:
          "updated",
        dataSource:
          "nrlsupercoachstats-public",
        lastDataUpdate:
          "2030-01-01T00:00:00.000Z"
      }
    ]
  };

  const plan =
    planIdentityMigration(
      database
    );

  assert.equal(
    plan.safeMergeCount,
    1
  );

  assert.equal(
    plan.quarantineCount,
    0
  );

  assert.equal(
    plan.ambiguousCount,
    0
  );

  assert.equal(
    plan.expectedFinalCount,
    1
  );

  const result =
    applyIdentityMigration(
      database,
      plan
    );

  assert.equal(
    result.players.length,
    1
  );

  const player =
    result.players[0];

  assert.equal(
    player.name,
    "Pat Example"
  );

  assert.equal(
    player.team,
    "AAA"
  );

  assert.deepEqual(
    player.positions,
    ["HFB"]
  );

  assert.equal(
    player.avg,
    80
  );

  assert.equal(
    player.price,
    700000
  );

  assert.equal(
    player.breakeven,
    75
  );
});

test("unmatched enrichment record is retained and quarantined", () => {
  const database = {
    players: [
      {
        name:
          "Pat Example",
        team: "AAA"
      },
      {
        name:
          "Unknown Fragment",
        team: "",
        price: 200000,
        dataSource:
          "nrlsupercoachstats-public"
      }
    ]
  };

  const plan =
    planIdentityMigration(
      database
    );

  assert.equal(
    plan.safeMergeCount,
    0
  );

  assert.equal(
    plan.quarantineCount,
    1
  );

  assert.equal(
    plan.ambiguousCount,
    0
  );

  assert.equal(
    plan.expectedFinalCount,
    2
  );

  const result =
    applyIdentityMigration(
      database,
      plan
    );

  assert.equal(
    result.players.length,
    1
  );

  assert.equal(
    result.identityQuarantine.records.length,
    1
  );

  const orphan =
    result.identityQuarantine.records[0];

  assert.equal(
    orphan.name,
    "Unknown Fragment"
  );

  assert.equal(
    orphan.identityStatus,
    "quarantined-enrichment-orphan"
  );

  assert.equal(
    orphan.identityQuarantine
      .retainedInPlayerDatabase,
    true
  );

  assert.equal(
    result.players.length +
      result.identityQuarantine.records.length,
    2
  );
});

test("quarantined orphan cannot resolve as canonical identity", () => {
  const database = {
    players: [
      {
        name:
          "Pat Example",
        team: "AAA"
      },
      {
        name:
          "Unknown Fragment",
        team: "",
        dataSource:
          "nrlsupercoachstats-public"
      }
    ]
  };

  const plan =
    planIdentityMigration(
      database
    );

  const migrated =
    applyIdentityMigration(
      database,
      plan
    );

  const resolution =
    resolveIdentity(
      buildIdentityIndex(
        migrated.players
      ),
      "Unknown Fragment"
    );

  assert.equal(
    resolution.status,
    "unmatched"
  );
});

test("non-enrichment records are never quarantined", () => {
  const database = {
    players: [
      {
        name:
          "Pat Example",
        team: "AAA"
      },
      {
        name:
          "Academy Prospect",
        team: "",
        dataSource:
          "official-development-source"
      }
    ]
  };

  const plan =
    planIdentityMigration(
      database
    );

  assert.equal(
    plan.safeMergeCount,
    0
  );

  assert.equal(
    plan.quarantineCount,
    0
  );

  assert.equal(
    plan.expectedFinalCount,
    2
  );
});

test("ambiguous alias ownership blocks application", () => {
  const database = {
    players: [
      {
        name:
          "Jordan Alpha",
        sourceName:
          "Jordan Example",
        team: "AAA"
      },
      {
        name:
          "Jordan Beta",
        statsSourceName:
          "Jordan Example",
        team: "BBB"
      },
      {
        name:
          "Jordan Example",
        team: "",
        dataSource:
          "nrlsupercoachstats-public"
      }
    ]
  };

  const plan =
    planIdentityMigration(
      database
    );

  assert.equal(
    plan.safeMergeCount,
    0
  );

  assert.equal(
    plan.ambiguousCount,
    1
  );

  assert.throws(
    () =>
      applyIdentityMigration(
        database,
        plan
      ),
    /unsafe/
  );
});

test("canonical identity fields cannot be overwritten", () => {
  const database = {
    players: [
      {
        name:
          "Pat Example",
        sourceName:
          "Patrick Example",
        shortName:
          "P. Example",
        team: "AAA",
        sourceTeam: "AAA",
        positions: ["HFB"],
        avg: 88
      },
      {
        name:
          "Patrick Example",
        shortName:
          "Wrong Name",
        team: "",
        sourceTeam: "",
        positions:
          ["UNKNOWN"],
        avg: 1,
        price: 650000,
        breakeven: 60,
        dataSource:
          "nrlsupercoachstats-public"
      }
    ]
  };

  const plan =
    planIdentityMigration(
      database
    );

  const result =
    applyIdentityMigration(
      database,
      plan
    );

  const player =
    result.players[0];

  assert.equal(
    player.name,
    "Pat Example"
  );

  assert.equal(
    player.shortName,
    "P. Example"
  );

  assert.equal(
    player.team,
    "AAA"
  );

  assert.equal(
    player.sourceTeam,
    "AAA"
  );

  assert.deepEqual(
    player.positions,
    ["HFB"]
  );

  assert.equal(
    player.avg,
    88
  );

  assert.equal(
    player.price,
    650000
  );

  assert.equal(
    player.breakeven,
    60
  );
});

test("migration is idempotent after application", () => {
  const database = {
    players: [
      {
        name:
          "Pat Example",
        sourceName:
          "Patrick Example",
        team: "AAA"
      },
      {
        name:
          "Patrick Example",
        team: "",
        price: 600000,
        dataSource:
          "nrlsupercoachstats-public"
      },
      {
        name:
          "Unknown Fragment",
        team: "",
        dataSource:
          "nrlsupercoachstats-public"
      }
    ]
  };

  const firstPlan =
    planIdentityMigration(
      database
    );

  const migrated =
    applyIdentityMigration(
      database,
      firstPlan
    );

  const secondPlan =
    planIdentityMigration(
      migrated
    );

  assert.equal(
    secondPlan.safeMergeCount,
    0
  );

  assert.equal(
    secondPlan.quarantineCount,
    0
  );

  assert.equal(
    secondPlan.ambiguousCount,
    0
  );
});
test("quarantined orphan is rehabilitated when explicit alias evidence later exists", () => {
  const database = {
    players: [
      {
        name: "Pat Example",
        sourceName: "Patrick Example",
        team: "AAA",
        positions: ["HFB"]
      },
      {
        name: "Patrick Example",
        team: "",
        price: 710000,
        breakeven: 72,
        dataSource:
          "nrlsupercoachstats-public",
        identityStatus:
          "quarantined-enrichment-orphan",
        identityQuarantine: {
          version:
            "v1-enrichment-orphan",
          retainedInPlayerDatabase:
            true
        }
      }
    ]
  };

  const plan =
    planIdentityMigration(database);

  assert.equal(
    plan.safeMergeCount,
    1
  );

  assert.equal(
    plan.quarantineCount,
    0
  );

  assert.equal(
    plan.ambiguousCount,
    0
  );

  assert.equal(
    plan.expectedFinalCount,
    1
  );

  const result =
    applyIdentityMigration(
      database,
      plan
    );

  assert.equal(
    result.players.length,
    1
  );

  assert.equal(
    result.players[0].name,
    "Pat Example"
  );

  assert.equal(
    result.players[0].price,
    710000
  );

  assert.equal(
    result.players[0].breakeven,
    72
  );
});
test("quarantined records are preserved outside canonical players", () => {
  const database = {
    players: [
      {
        name: "Pat Example",
        team: "AAA"
      },
      {
        name: "Unknown Fragment",
        team: "",
        dataSource:
          "nrlsupercoachstats-public"
      }
    ]
  };

  const plan =
    planIdentityMigration(database);

  const result =
    applyIdentityMigration(
      database,
      plan
    );

  assert.equal(
    result.players.length,
    1
  );

  assert.equal(
    result.players[0].name,
    "Pat Example"
  );

  assert.equal(
    result.identityQuarantine.records.length,
    1
  );

  assert.equal(
    result.identityQuarantine.records[0].name,
    "Unknown Fragment"
  );

  assert.equal(
    result.players.length +
      result.identityQuarantine.records.length,
    2
  );
});
test("enrichment merge preserves canonical provenance", () => {
  const database = {
    players: [
      {
        name: "Pat Example",
        sourceName: "Patrick Example",
        team: "AAA",
        dataSource: "canonical-roster-source"
      },
      {
        name: "Patrick Example",
        team: "",
        price: 710000,
        breakeven: 72,
        dataSource: "nrlsupercoachstats-public",
        lastDataUpdate: "2026-01-01T00:00:00.000Z"
      }
    ]
  };

  const plan = planIdentityMigration(database);
  const result = applyIdentityMigration(database, plan);

  assert.equal(result.players.length, 1);

  const canonical = result.players[0];

  assert.equal(
    canonical.dataSource,
    "canonical-roster-source"
  );

  assert.equal(canonical.price, 710000);
  assert.equal(canonical.breakeven, 72);

  assert.equal(
    canonical.enrichmentSources
      .priceAndBreakeven
      .source,
    "nrlsupercoachstats-public"
  );
});
