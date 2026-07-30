import test from "node:test";
import assert from "node:assert/strict";

import { parseScoresByRound } from "../../scripts/capture-player-scores.mjs";
import { appNameToSourceName } from "../../scripts/update-players.mjs";

// Real gap found while investigating why player averages appeared stale:
// the site's per-round score data (highcharts/data-scoresbyrd.php) is real
// and public, but only works when queried with the site's own "Surname,
// Given" dropdown format - confirmed against the live site via a diagnostic
// Actions run for Nathan Cleary, whose 2026 data showed real fluctuating
// scores (65, 109, 69, ...) once queried as "Cleary, Nathan" rather than
// "Nathan Cleary". A wrong parameter format was previously confirmed to
// come back as an all-zero response for every round and every year, which
// is what these tests guard against being silently recorded as real data.

test("appNameToSourceName converts to the site's real dropdown format", () => {
  assert.equal(appNameToSourceName("Nathan Cleary"), "Cleary, Nathan");
});

test("parseScoresByRound extracts real non-zero rounds per season, keyed by round number", () => {
  const json = [
    { name: "Round", data: [1, 2, 3, 4, 5] },
    { name: 2025, visible: false, data: [68, 80, 0, 0, 94] },
    { name: 2026, data: [65, 109, 0, 117, 0] }
  ];
  const result = parseScoresByRound(json);
  assert.deepEqual(result, {
    2025: { 1: 68, 2: 80, 5: 94 },
    2026: { 1: 65, 2: 109, 4: 117 }
  });
});

// This is exactly the failure signature seen from a wrong dropdown value
// (plain "Nathan Cleary" instead of "Cleary, Nathan") - a real 200 response
// with the correct array shape, but every round is 0. Recording those as
// real scores would fabricate data for every player this ever happened to.
test("parseScoresByRound reports no data for a season whose every round is 0 (a wrong-parameter response), not zeros", () => {
  const json = [
    { name: "Round", data: [1, 2, 3] },
    { name: 2026, data: [0, 0, 0] }
  ];
  const result = parseScoresByRound(json);
  assert.equal(result, null);
});

test("parseScoresByRound returns null for an empty or malformed response", () => {
  assert.equal(parseScoresByRound([]), null);
  assert.equal(parseScoresByRound(null), null);
  assert.equal(parseScoresByRound([{ name: 2026, data: [1, 2, 3] }]), null, "no Round entry to map indices to round numbers");
});

test("parseScoresByRound ignores non-year entries and mismatched array lengths gracefully", () => {
  const json = [
    { name: "Round", data: [1, 2, 3] },
    { name: "not-a-year", data: [10, 20, 30] },
    { name: 2026, data: [55] }
  ];
  const result = parseScoresByRound(json);
  assert.deepEqual(result, { 2026: { 1: 55 } });
});
