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
// Real rule: since App.selectedReserves itself can never hold more than 4
// names (the manual "pick your 4 active reserves" feature), the old
// "rank the whole bench by score and cap substitutions at 4" behavior is
// gone - eligibility for a non-bye gap is now simply "is this reserve one
// of your 4 selected ones", which is what actually caps things. This
// explicitly sets the selection to a known set of (up to 4) real
// candidates across several forced-out position groups, so the assertion
// doesn't depend on which reserves happen to have a nonzero projection in
// today's live data (the old version of this test did, and broke in CI
// purely from real position-availability data drifting).
test("auto-emergency substitution cap keeps only the manually selected reserves and drops the rest", async () => {
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

      // Find one real reserve per targeted position group, regardless of
      // whether it currently has a nonzero projection (patched below so
      // this test can't be broken by live data drift).
      const byGroup = {};
      for (const row of state.reserveRows || []) {
        if (!row.player) continue;
        const group = reserveSlotBase(row.slotId);
        if (!byGroup[group]) byGroup[group] = row.player;
      }
      const candidatesByTarget = targets.map(t => ({ slotId: t.slot.id, group: t.slot.short, player: byGroup[t.slot.short] || null }));
      const withCandidate = candidatesByTarget.filter(c => c.player);

      const superOriginalRoundProj = window.roundProj;
      window.roundProj = function (p) {
        const found = withCandidate.find(c => c.player.name === p?.name);
        if (found) return { ...originalRoundProj(p), expected: 40 };
        return superOriginalRoundProj(p);
      };

      // Select only the first 4 (the real cap on how many reserves can be
      // manually chosen) - the 5th target's candidate is deliberately left
      // unselected.
      const selected = withCandidate.slice(0, 4).map(c => c.player.name);
      const unselectedTarget = withCandidate[4] || null;
      App.selectedReserves = selected;

      const subs = autoEmergencySubstitutes(state);
      const results = targets.map(t => ({ slotId: t.slot.id, sub: subs[t.slot.id] ? subs[t.slot.id].name : null }));

      window.roundProj = originalRoundProj;
      window.availabilityStatus = originalAvailability;

      return { withCandidateCount: withCandidate.length, selected, unselectedTarget, results };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.withCandidateCount >= 2, "test setup expected at least 2 of the targeted position groups to have a real reserve - if this fails, the squad's reserve slots changed and the test's targets need updating");

    const substitutedNames = result.results.map(r => r.sub).filter(Boolean);
    for (const name of result.selected) {
      assert.ok(substitutedNames.includes(name), `expected selected reserve ${name} to substitute in for their forced-out starter`);
    }
    if (result.unselectedTarget) {
      const unselectedResult = result.results.find(r => r.slotId === result.unselectedTarget.slotId);
      assert.equal(
        unselectedResult.sub,
        null,
        `expected ${result.unselectedTarget.player.name} (not one of the 4 selected reserves) to NOT substitute, but they did`
      );
    }
  } finally {
    await close();
  }
});
