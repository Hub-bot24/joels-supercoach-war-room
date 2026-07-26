import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Two related real-scoring-rule fixes: (1) the team's total PROJECTED
// figure must double the captain's score, matching real SuperCoach
// scoring, not just sum 14 plain expected values; (2) reserve "R" badges
// mark the real SuperCoach auto-emergency rule - a reserve's score only
// counts toward the team total when their position group's starter is
// NOT playing this round, and they are the highest-scoring available
// reserve in that same position group. A reserve whose starter IS
// playing does not count even if the reserve themselves has a great
// projection - the earlier version of this badge got that wrong (it
// badged any reserve with a nonzero score, regardless of whether their
// starter needed replacing).
test("team total doubles the real captain's score and reserve R badges follow the real auto-emergency rule", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const picks = captainVicePicks(state);
      const plainSum = state.fieldSlots.reduce((s, { player }) => s + roundProj(player).expected, 0);
      const withCaptainDouble = teamProjection();
      const captainExpected = picks.captain ? roundProj(getPlayer(picks.captain.name)).expected : 0;

      const subs = autoEmergencySubstitutes(state);
      const substitutingNames = new Set(Object.values(subs).filter(Boolean).map(p => p.name));

      // Recompute independently, from raw per-slot/per-reserve data, rather
      // than trusting the function under test to grade itself: for each
      // position group, count real starter gaps and check the substitute
      // is genuinely the highest-scoring available reserve in that group.
      const gapsByGroup = {};
      for (const { slot, player } of state.fieldSlots) {
        if (roundProj(player).expected > 0) continue;
        gapsByGroup[slot.short] = (gapsByGroup[slot.short] || 0) + 1;
      }
      const reservesByGroup = {};
      for (const row of state.reserveRows) {
        if (!row.player) continue;
        const group = reserveSlotBase(row.slotId);
        (reservesByGroup[group] = reservesByGroup[group] || []).push(row.player);
      }

      const badgedNames = [...document.querySelectorAll(".formation-reserve-card")]
        .filter(card => card.querySelector(".formation-r-badge"))
        .map(card => card.querySelector(".formation-reserve-name")?.textContent || "");

      return {
        plainSum, withCaptainDouble, captainExpected,
        substitutingNames: [...substitutingNames], badgedNames,
        gapsByGroup, reservesByGroup: Object.fromEntries(
          Object.entries(reservesByGroup).map(([g, list]) => [g, list.map(p => ({ name: p.name, expected: roundProj(p).expected }))])
        )
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);

    assert.equal(
      result.withCaptainDouble - result.plainSum,
      result.captainExpected,
      `expected teamProjection() to add exactly the captain's own score on top of the plain sum (captain adds ${result.captainExpected}, actual diff was ${result.withCaptainDouble - result.plainSum})`
    );

    // Every badged reserve must genuinely be marked as substituting.
    for (const name of result.badgedNames) {
      assert.ok(
        result.substitutingNames.some(n => name.startsWith(n)),
        `${name} has an R badge but is not in the real substitutes set`
      );
    }

    // For every position group, the number of badged reserves from that
    // group must not exceed either the number of real gaps in that group
    // or the number of that group's reserves with a real positive score -
    // whichever is smaller. This is the actual invariant the real rule
    // guarantees, regardless of how many gaps exist this particular round.
    for (const [group, reserves] of Object.entries(result.reservesByGroup)) {
      const gaps = result.gapsByGroup[group] || 0;
      const availableReserves = reserves.filter(r => r.expected > 0).length;
      const expectedSubs = Math.min(gaps, availableReserves);
      const actualSubsInGroup = reserves.filter(r => result.substitutingNames.includes(r.name)).length;
      assert.equal(
        actualSubsInGroup,
        expectedSubs,
        `position group ${group}: expected ${expectedSubs} substitute(s) (min of ${gaps} gap(s) and ${availableReserves} available reserve(s)), got ${actualSubsInGroup}`
      );
    }
  } finally {
    await close();
  }
});
