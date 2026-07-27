import test from "node:test";
import assert from "node:assert/strict";

import {
  fromBackupStatus,
  backupRecordAgeDays
} from "../../scripts/update-status.mjs";

// Real bug found via a user report: player_status.json's own update workflow is
// workflow_dispatch-only (no schedule), so the file had gone six weeks stale while the core truth
// engine kept running every 15 minutes and re-asserting whatever was in it - including a player
// last updated 2026-06-14 - as if it were current round-22 truth. combineTruth/fromBackupStatus had
// no concept of the backup file's own age at all. This is a generic time-based gate (no player/
// club names), matching the existing "previous week is reference only, never NAMED/GREEN"
// principle already documented elsewhere, extended to INJURED/SUSPENDED.

function daysAgoIso(days){
  return new Date(Date.now() - days * 86400000).toISOString();
}

test("backupRecordAgeDays falls back to the file's own timestamp when a record has none", () => {
  const fileUpdatedAt = daysAgoIso(5);
  assert.ok(backupRecordAgeDays({}, fileUpdatedAt) >= 4.9);
  assert.equal(backupRecordAgeDays({}, ''), Infinity);
});

test("fromBackupStatus ignores an injury record from a stale (6-week-old) backup file", () => {
  const staleTimestamp = daysAgoIso(43);
  const playerStatus = {
    updated: staleTimestamp,
    players: {
      "Test Player": {
        status: "out",
        reason: "Hamstring",
        source: "nrl-casualty-ward",
        lastUpdated: staleTimestamp
      }
    }
  };
  const teamlistsOut = {}, injuriesOut = {}, suspensionsOut = {};
  const stats = fromBackupStatus([{ name: "Test Player", team: "NEW" }], playerStatus, teamlistsOut, injuriesOut, suspensionsOut, 22);

  assert.equal(injuriesOut["Test Player"], undefined, "a 43-day-old backup record must not be asserted as current INJURED truth");
  assert.equal(stats.staleSkippedCount, 1);
  assert.equal(stats.injuryCount, 0);
});

test("fromBackupStatus still trusts a genuinely fresh backup record (no regression)", () => {
  const freshTimestamp = daysAgoIso(2);
  const playerStatus = {
    updated: freshTimestamp,
    players: {
      "Test Player": {
        status: "out",
        reason: "Hamstring",
        source: "nrl-casualty-ward",
        lastUpdated: freshTimestamp
      }
    }
  };
  const teamlistsOut = {}, injuriesOut = {}, suspensionsOut = {};
  const stats = fromBackupStatus([{ name: "Test Player", team: "NEW" }], playerStatus, teamlistsOut, injuriesOut, suspensionsOut, 22);

  assert.ok(injuriesOut["Test Player"], "a fresh backup record should still be trusted");
  assert.equal(injuriesOut["Test Player"].displayStatus, "INJURED");
  assert.equal(stats.staleSkippedCount, 0);
  assert.equal(stats.injuryCount, 1);
});
