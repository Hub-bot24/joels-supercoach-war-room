import test from "node:test";
import assert from "node:assert/strict";

import { computeAccuracy } from "../../scripts/build-projection-accuracy.mjs";

// Real gap this closes: the app has never had a way to check whether its
// own projections are any good. This compares captured ProjectionEngine
// output (data/history/projections) against real per-round scores
// (data/history/scores) - but only once a player's round has genuinely
// been played, never fabricating a comparison for a game that hasn't
// happened yet.

function projectionFile(round, projections) {
  return { round, projections };
}

test("computeAccuracy pairs a projection with the real score for the same round and player", () => {
  const files = [projectionFile(1, [{ name: "Player A", position: "HFB", expected: 60 }])];
  const scores = { 2026: { season: 2026, players: { "Player A": { 1: 72 } } } };

  const result = computeAccuracy(files, scores, 2026);

  assert.equal(result.totalComparisons, 1);
  assert.deepEqual(result.roundsCompared, [1]);
});

test("computeAccuracy never fabricates a comparison for a round the player hasn't played yet", () => {
  const files = [projectionFile(22, [{ name: "Player A", position: "HFB", expected: 60 }])];
  // Real fixtures.json shape: an unplayed round is simply absent, not 0.
  const scores = { 2026: { season: 2026, players: { "Player A": { 21: 90 } } } };

  const result = computeAccuracy(files, scores, 2026);

  assert.equal(result.totalComparisons, 0);
  assert.equal(result.overall, null);
});

test("computeAccuracy withholds an overall metric until MIN_SAMPLES_OVERALL real comparisons exist", () => {
  const projections = Array.from({ length: 19 }, (_, i) => ({ name: `Player ${i}`, position: "CTW", expected: 50 }));
  const scores = { players: {} };
  projections.forEach((p, i) => { scores.players[p.name] = { 1: 55 }; });

  const files = [projectionFile(1, projections)];
  const result = computeAccuracy(files, { 2026: { season: 2026, ...scores } }, 2026);

  assert.equal(result.totalComparisons, 19);
  assert.equal(result.overall, null, "19 samples must not be enough to publish an overall metric");
});

test("computeAccuracy publishes an overall metric once MIN_SAMPLES_OVERALL is reached, with correct bias direction", () => {
  const projections = Array.from({ length: 20 }, (_, i) => ({ name: `Player ${i}`, position: "CTW", expected: 50 }));
  const players = {};
  projections.forEach(p => { players[p.name] = { 1: 60 }; }); // real score always 10 above projection

  const files = [projectionFile(1, projections)];
  const result = computeAccuracy(files, { 2026: { season: 2026, players } }, 2026);

  assert.ok(result.overall, "20 samples should be enough to publish an overall metric");
  assert.equal(result.overall.samples, 20);
  assert.equal(result.overall.meanAbsoluteError, 10);
  assert.equal(result.overall.meanBias, 10, "positive bias means the engine underestimated - actual consistently exceeded expected");
});

test("computeAccuracy only publishes a position's metric once it individually has MIN_SAMPLES_POSITION real comparisons", () => {
  const hfbProjections = Array.from({ length: 4 }, (_, i) => ({ name: `HFB ${i}`, position: "HFB", expected: 50 }));
  const ctwProjections = Array.from({ length: 16 }, (_, i) => ({ name: `CTW ${i}`, position: "CTW", expected: 40 }));
  const players = {};
  hfbProjections.forEach(p => { players[p.name] = { 1: 55 }; });
  ctwProjections.forEach(p => { players[p.name] = { 1: 45 }; });

  const files = [projectionFile(1, [...hfbProjections, ...ctwProjections])];
  const result = computeAccuracy(files, { 2026: { season: 2026, players } }, 2026);

  assert.equal(result.totalComparisons, 20);
  assert.ok(result.overall, "20 total samples should publish an overall metric");
  assert.equal(result.byPosition.HFB, undefined, "HFB only has 4 samples - below MIN_SAMPLES_POSITION");
  assert.ok(result.byPosition.CTW, "CTW has 16 samples - above MIN_SAMPLES_POSITION");
  assert.equal(result.byPosition.CTW.samples, 16);
});

test("computeAccuracy ignores a projection with a non-finite expected value rather than crashing", () => {
  const files = [projectionFile(1, [{ name: "Player A", position: "HFB", expected: null }])];
  const scores = { 2026: { season: 2026, players: { "Player A": { 1: 60 } } } };

  const result = computeAccuracy(files, scores, 2026);

  assert.equal(result.totalComparisons, 0);
});

test("computeAccuracy returns an honest empty result when there is no captured history at all", () => {
  const result = computeAccuracy([], {}, 2026);
  assert.equal(result.totalComparisons, 0);
  assert.deepEqual(result.roundsCompared, []);
  assert.equal(result.overall, null);
  assert.deepEqual(result.byPosition, {});
});
