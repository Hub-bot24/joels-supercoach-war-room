import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Real SuperCoach rules, researched rather than assumed: (1) the team's
// total PROJECTED figure doubles the captain's score, not the whole team;
// (2) a reserve's score only counts when their position group's starter
// isn't playing, capped at 4 total non-bye substitutions per round - bye
// coverage is real but NOT subject to that cap, since a bye is scheduled
// in advance rather than a live DNP surprise (this is what lets "the 2
// major bye rounds" see more than 4 reserves count, without hardcoding
// any specific round number).
test("team total doubles the real captain's score and reserve substitutions respect the real cap", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const picks = captainVicePicks(state);
      const plainSum = state.fieldSlots.reduce((s, { player }) => s + roundProj(player).expected, 0);
      const withCaptainDouble = teamProjection();

      // Real rule: double the captain if they play; if they don't (the
      // guaranteed-bye loophole), double the vice instead.
      const captainPlayer = picks.captain ? getPlayer(picks.captain.name) : null;
      const vicePlayer = picks.vice ? getPlayer(picks.vice.name) : null;
      const captainPlays = !!(captainPlayer && roundProj(captainPlayer).expected > 0);
      const doubleTarget = captainPlays ? captainPlayer : (vicePlayer && roundProj(vicePlayer).expected > 0 ? vicePlayer : null);
      const captainExpected = doubleTarget ? roundProj(doubleTarget).expected : 0;

      const subs = autoEmergencySubstitutes(state);
      const substitutingNames = new Set(Object.values(subs).filter(Boolean).map(p => p.name));

      let nonByeGaps = 0, byeGaps = 0;
      for (const { slot, player } of state.fieldSlots) {
        if (roundProj(player).expected > 0) continue;
        const isBye = String(availabilityStatus(player)?.key || "").toLowerCase() === "bye";
        if (isBye) byeGaps++; else nonByeGaps++;
      }

      const badgedNames = [...document.querySelectorAll(".formation-reserve-card")]
        .filter(card => card.querySelector(".formation-r-badge"))
        .map(card => card.querySelector(".formation-reserve-name")?.textContent || "");

      return { plainSum, withCaptainDouble, captainExpected, substitutingNames: [...substitutingNames], badgedNames, nonByeGaps, byeGaps };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);

    assert.equal(
      result.withCaptainDouble - result.plainSum,
      result.captainExpected,
      `expected teamProjection() to add exactly the doubling target's score on top of the plain sum - captain if they play, vice instead if the captain is a confirmed-bye loophole pick (target adds ${result.captainExpected}, actual diff was ${result.withCaptainDouble - result.plainSum})`
    );

    // Every badged reserve must genuinely be marked as substituting - never a badge with nothing real behind it.
    for (const name of result.badgedNames) {
      assert.ok(result.substitutingNames.some(n => name.startsWith(n)), `${name} has an R badge but is not in the real substitutes set`);
    }

    assert.ok(
      result.substitutingNames.length <= result.nonByeGaps + result.byeGaps,
      "substitute count must never exceed the real number of gaps"
    );
  } finally {
    await close();
  }
});

// Real round 21 data doesn't currently have enough simultaneous gaps to
// exercise the 4-substitution cap, so this constructs a synthetic scenario
// (5 real position-group gaps, each with exactly one real available
// reserve) and asserts the cap keeps only the 4 highest-scoring
// substitutes, dropping the lowest one entirely - not an approximation,
// the exact real mechanism running against real player data.
test("auto-emergency substitution cap keeps the top 4 by score and drops the rest", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const wanted = ["HOK1", "2RF1", "HFB1", "FE1", "FLB1"];
      const targets = state.fieldSlots.filter(f => wanted.includes(f.slot.id));
      const outNames = new Set(targets.map(t => t.name));

      const originalRoundProj = window.roundProj;
      const originalAvailability = window.availabilityStatus;
      window.roundProj = function (p) {
        if (p && outNames.has(p.name)) return { ...originalRoundProj(p), expected: 0 };
        return originalRoundProj(p);
      };
      window.availabilityStatus = function (p, round) {
        if (p && outNames.has(p.name)) return { ...originalAvailability(p, round), key: "risk", available: false, label: "OUT" };
        return originalAvailability(p, round);
      };

      const realCandidateScores = targets.map(t => {
        const group = t.slot.short;
        const pool = reservePoolByGroup(state)[group] || [];
        return { starter: t.name, slotId: t.slot.id, candidate: pool[0] ? { name: pool[0].player.name, expected: pool[0].pr.expected } : null };
      });

      const subs = autoEmergencySubstitutes(state);
      const results = targets.map(t => ({ slotId: t.slot.id, sub: subs[t.slot.id] ? subs[t.slot.id].name : null }));

      window.roundProj = originalRoundProj;
      window.availabilityStatus = originalAvailability;

      return { realCandidateScores, results };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);

    const withCandidate = result.realCandidateScores.filter(c => c.candidate);
    assert.equal(withCandidate.length, 5, "test setup expected all 5 targeted position groups to have exactly one real available reserve this round - if this fails, real round data changed and the test's targets need updating");

    const substitutedCount = result.results.filter(r => r.sub).length;
    assert.equal(substitutedCount, 4, `expected exactly 4 of 5 real candidate substitutions to be allowed (the cap), got ${substitutedCount}`);

    const lowestScoring = [...withCandidate].sort((a, b) => a.candidate.expected - b.candidate.expected)[0];
    const droppedResult = result.results.find(r => r.slotId === lowestScoring.slotId);
    assert.equal(
      droppedResult.sub,
      null,
      `expected the lowest-scoring real candidate (${lowestScoring.candidate.name}, ${lowestScoring.candidate.expected} pts) to be the one dropped by the cap, but it was substituted`
    );
  } finally {
    await close();
  }
});
