import test from "node:test";
import assert from "node:assert/strict";

import { resolveSeason } from "../../scripts/lib/season.mjs";

test("season is the current Sydney calendar year, with no manual config", () => {
  assert.equal(resolveSeason({ now: new Date("2026-10-30T12:00:00Z"), env: {} }), 2026);
  assert.equal(resolveSeason({ now: new Date("2027-03-05T09:00:00Z"), env: {} }), 2027);
});

// New Year's Day arrives in Sydney 11 hours before UTC - a UTC-based year
// would keep the old season for the first part of the new Sydney day.
test("season rolls over at Sydney midnight, not UTC midnight", () => {
  assert.equal(resolveSeason({ now: new Date("2026-12-31T13:30:00Z"), env: {} }), 2027);
  assert.equal(resolveSeason({ now: new Date("2026-12-31T12:30:00Z"), env: {} }), 2026);
});

test("SEASON env overrides the calendar year for deliberate backfills", () => {
  assert.equal(resolveSeason({ now: new Date("2026-10-30T12:00:00Z"), env: { SEASON: "2024" } }), 2024);
});

test("an invalid SEASON override throws instead of silently using the calendar year", () => {
  assert.throws(() => resolveSeason({ env: { SEASON: "twenty" } }), /Invalid SEASON override/);
  assert.throws(() => resolveSeason({ env: { SEASON: "1999" } }), /Invalid SEASON override/);
});
