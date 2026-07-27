import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  computeNextPriceUpdateTarget,
  shouldFetchPricesNow
} from "../../scripts/update-players.mjs";

// Real user-confirmed domain knowledge: the actual SuperCoach site posts
// new prices once per round, Monday ~noon Sydney time - unless the round's
// last game is itself on a Monday night, in which case it isn't ready until
// Thursday instead. fixtures.json already carries real kickoff times, so
// this is computed from that rather than a hardcoded weekly cron.

test("a round with no Monday game targets the following Monday, noon Sydney time", () => {
  const fixtures = [
    { round: 22, kickoffLocal: "2026-07-30T19:50:00" },
    { round: 22, kickoffLocal: "2026-08-02T16:05:00" } // last game: Sunday
  ];
  const target = computeNextPriceUpdateTarget(fixtures, 22);
  assert.equal(target.targetWeekdayLabel, "Monday");
  assert.equal(target.hasMondayGame, false);
  // 2026-08-03 is standard time in Sydney (UTC+10) - noon local = 02:00 UTC
  assert.equal(target.targetUtc.toISOString(), "2026-08-03T02:00:00.000Z");
});

test("a round with a Monday game shifts the target to the following Thursday", () => {
  const fixtures = [
    { round: 5, kickoffLocal: "2026-05-01T19:50:00" },
    { round: 5, kickoffLocal: "2026-05-04T19:30:00" } // Monday night game
  ];
  const target = computeNextPriceUpdateTarget(fixtures, 5);
  assert.equal(target.targetWeekdayLabel, "Thursday");
  assert.equal(target.hasMondayGame, true);
  assert.equal(target.targetUtc.toISOString(), "2026-05-07T02:00:00.000Z");
});

test("daylight saving is handled automatically, not hardcoded - a March round targets UTC+11, not UTC+10", () => {
  const fixtures = [{ round: 1, kickoffLocal: "2026-03-08T19:50:00" }];
  const target = computeNextPriceUpdateTarget(fixtures, 1);
  // Noon Sydney in March (still daylight saving, UTC+11) = 01:00 UTC, not 02:00
  assert.equal(target.targetUtc.toISOString(), "2026-03-09T01:00:00.000Z");
});

test("returns null when the round has no fixtures to gate against", () => {
  assert.equal(computeNextPriceUpdateTarget([], 22), null);
  assert.equal(computeNextPriceUpdateTarget([{ round: 21, kickoffLocal: "2026-07-20T19:00:00" }], 22), null);
});

async function withTempFiles(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "price-update-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("shouldFetchPricesNow refuses before the target window and proceeds after it", async () => {
  await withTempFiles(async dir => {
    const currentRoundFile = path.join(dir, "current_round.json");
    const fixturesFile = path.join(dir, "fixtures.json");
    const stateFile = path.join(dir, "price_update_state.json");

    await fs.writeFile(currentRoundFile, JSON.stringify({ round: 22, detectedRound: 22 }));
    await fs.writeFile(
      fixturesFile,
      JSON.stringify([{ round: 22, kickoffLocal: "2026-08-02T16:05:00" }])
    );
    // No state file yet - readJson's fallback handles that.

    const before = await shouldFetchPricesNow(new Date("2026-08-03T01:00:00Z"), {
      currentRoundFile,
      fixturesFile,
      stateFile
    });
    assert.equal(before.proceed, false);

    const after = await shouldFetchPricesNow(new Date("2026-08-03T03:00:00Z"), {
      currentRoundFile,
      fixturesFile,
      stateFile
    });
    assert.equal(after.proceed, true);
    assert.equal(after.round, 22);
  });
});

test("shouldFetchPricesNow refuses a redundant re-fetch once a round has already been priced", async () => {
  await withTempFiles(async dir => {
    const currentRoundFile = path.join(dir, "current_round.json");
    const fixturesFile = path.join(dir, "fixtures.json");
    const stateFile = path.join(dir, "price_update_state.json");

    await fs.writeFile(currentRoundFile, JSON.stringify({ round: 22, detectedRound: 22 }));
    await fs.writeFile(
      fixturesFile,
      JSON.stringify([{ round: 22, kickoffLocal: "2026-08-02T16:05:00" }])
    );
    await fs.writeFile(stateFile, JSON.stringify({ lastPricedRound: 22 }));

    const result = await shouldFetchPricesNow(new Date("2026-08-05T00:00:00Z"), {
      currentRoundFile,
      fixturesFile,
      stateFile
    });
    assert.equal(result.proceed, false);
  });
});

test("shouldFetchPricesNow proceeds when there's no detected round yet, rather than gating forever", async () => {
  await withTempFiles(async dir => {
    const currentRoundFile = path.join(dir, "current_round.json");
    await fs.writeFile(currentRoundFile, JSON.stringify({}));
    const result = await shouldFetchPricesNow(new Date(), {
      currentRoundFile,
      fixturesFile: path.join(dir, "does-not-exist.json"),
      stateFile: path.join(dir, "does-not-exist-2.json")
    });
    assert.equal(result.proceed, true);
  });
});
