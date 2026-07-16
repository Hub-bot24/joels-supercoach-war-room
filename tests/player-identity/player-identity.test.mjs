import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIdentityIndex,
  explicitIdentityAliases,
  normaliseIdentityName,
  resolveIdentity
} from "../../scripts/lib/player-identity.mjs";

test("normalisation handles Unicode apostrophes and spacing", () => {
  assert.equal(
    normaliseIdentityName("Avery O\u2019Sample"),
    "averyosample"
  );

  assert.equal(
    normaliseIdentityName("Avery OSample"),
    "averyosample"
  );

  assert.equal(
    normaliseIdentityName("Taylor De Example"),
    "taylordeexample"
  );

  assert.equal(
    normaliseIdentityName("Taylor deExample"),
    "taylordeexample"
  );
});

test("canonical display name resolves exactly", () => {
  const canonical = {
    name: "Pat Example",
    team: "AAA"
  };

  const result = resolveIdentity(
    buildIdentityIndex([canonical]),
    "Pat Example"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.player, canonical);
});

test("explicit source alias resolves to canonical player", () => {
  const canonical = {
    name: "Pat Example",
    sourceName: "Patrick Example",
    statsSourceName: "Patrick Example",
    team: "AAA"
  };

  const result = resolveIdentity(
    buildIdentityIndex([canonical]),
    "Patrick Example"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.player, canonical);
});

test("unmatched enrichment identity remains unmatched", () => {
  const index = buildIdentityIndex([
    {
      name: "Pat Example",
      sourceName: "Patrick Example",
      team: "AAA"
    }
  ]);

  const result = resolveIdentity(
    index,
    "Unknown Source Fragment"
  );

  assert.equal(result.status, "unmatched");
  assert.equal(result.player, undefined);
});

test("alias collisions return ambiguous instead of guessing", () => {
  const first = {
    name: "Jordan Alpha",
    sourceName: "Jordan Example",
    team: "AAA"
  };

  const second = {
    name: "Jordan Beta",
    statsSourceName: "Jordan Example",
    team: "BBB"
  };

  const result = resolveIdentity(
    buildIdentityIndex([first, second]),
    "Jordan Example"
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("raw alias evidence is preserved", () => {
  const aliases = explicitIdentityAliases({
    name: "Avery O'Sample",
    sourceName: "Avery OSample",
    statsSourceName: "Avery O\u2019Sample",
    sourceAliases: [
      "Avery O Sample",
      "Avery OSample"
    ]
  });

  assert.deepEqual(
    aliases,
    [
      "Avery OSample",
      "Avery O\u2019Sample",
      "Avery O Sample"
    ]
  );
});
test("quarantined identities are excluded from resolution", () => {
  const quarantined = {
    name: "Unknown Fragment",
    identityStatus:
      "quarantined-enrichment-orphan",
    dataSource:
      "nrlsupercoachstats-public"
  };

  const result = resolveIdentity(
    buildIdentityIndex([
      quarantined
    ]),
    "Unknown Fragment"
  );

  assert.equal(
    result.status,
    "unmatched"
  );
});
