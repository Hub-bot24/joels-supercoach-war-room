import test from "node:test";
import assert from "node:assert/strict";

import {
  combineTruth
} from "../../scripts/update-status.mjs";

function player(name){
  return {
    name,
    team: "TEST CLUB",
    byeRounds: []
  };
}

function structuredRecord({
  lineupIndex,
  jersey,
  lineupRole,
  displayStatus
}){
  return {
    structuredSnapshot: true,
    lineupIndex,
    jersey,
    lineupRole,
    selectionRole: lineupRole,
    selectionStatus:
      displayStatus === "NAMED"
        ? "named"
        : "extended",
    displayStatus,
    status: displayStatus,
    available: displayStatus === "NAMED",
    colour:
      displayStatus === "NAMED"
        ? "green"
        : "yellow",
    reason: "Synthetic conflicting source evidence",
    sources: [
      {
        type: "teamlist",
        name: "Synthetic structured fixture"
      }
    ],
    sourcePriority: 100,
    sourceOrder: 1,
    team: "TEST CLUB",
    teamCanonical: "TEST CLUB"
  };
}

function arbitrate(name, record){
  const result = combineTruth(
    [player(name)],
    1,
    {
      [name]: record
    },
    {},
    {},
    {},
    {},
    []
  );

  return result.playersOut[name];
}

test(
  "structured starter placement overrides conflicting interchange role",
  () => {
    const output = arbitrate(
      "Structured Starter",
      structuredRecord({
        lineupIndex: 2,
        jersey: 17,
        lineupRole: "interchange",
        displayStatus: "NAMED"
      })
    );

    assert.equal(output.lineupIndex, 2);
    assert.equal(output.jersey, 17);
    assert.equal(output.lineupRole, "starter");
    assert.equal(output.selectionRole, "starter");
    assert.equal(output.selectionStatus, "named");
    assert.equal(output.displayStatus, "NAMED");
    assert.equal(output.status, "NAMED");
    assert.equal(output.available, true);
  }
);

test(
  "structured interchange placement overrides conflicting starter role",
  () => {
    const output = arbitrate(
      "Structured Interchange",
      structuredRecord({
        lineupIndex: 15,
        jersey: 1,
        lineupRole: "starter",
        displayStatus: "NAMED"
      })
    );

    assert.equal(output.lineupIndex, 15);
    assert.equal(output.jersey, 1);
    assert.equal(output.lineupRole, "interchange");
    assert.equal(output.selectionRole, "interchange");
    assert.equal(output.selectionStatus, "named");
    assert.equal(output.displayStatus, "NAMED");
    assert.equal(output.status, "NAMED");
    assert.equal(output.available, true);
  }
);

test(
  "structured extended placement cannot remain a named starter",
  () => {
    const output = arbitrate(
      "Structured Extended",
      structuredRecord({
        lineupIndex: 18,
        jersey: 13,
        lineupRole: "starter",
        displayStatus: "NAMED"
      })
    );

    assert.equal(output.lineupIndex, 18);
    assert.equal(output.jersey, 13);
    assert.equal(output.lineupRole, "extended");
    assert.equal(output.selectionRole, "extended");
    assert.equal(output.selectionStatus, "extended");
    assert.equal(output.displayStatus, "EXPECTED");
    assert.equal(output.status, "EXPECTED");
    assert.equal(output.available, true);
  }
);
