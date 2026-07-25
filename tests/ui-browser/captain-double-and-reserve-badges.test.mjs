import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Two related real-scoring-rule fixes: (1) the team's total PROJECTED
// figure must double the captain's score, matching real SuperCoach
// scoring, not just sum 14 plain expected values; (2) reserve cards get
// a green "R" badge only when that reserve is genuinely projected to
// play and score this round (roundProj().expected > 0 - the same
// zeroed-for-BYE/OUT/NOT-NAMED signal every other real badge in this app
// already uses) - not a fixed count, since the real number of live-
// scoring reserves changes round to round with actual team-list news.
test("team total doubles the real captain's score and reserve R badges match real availability", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const picks = captainVicePicks(state);
      const plainSum = state.fieldSlots.reduce((s, { player }) => s + roundProj(player).expected, 0);
      const withCaptainDouble = teamProjection();
      const captainExpected = picks.captain ? roundProj(getPlayer(picks.captain.name)).expected : 0;

      const reserveChecks = state.reserveRows
        .filter(r => r.player)
        .map(r => ({
          name: r.player.name,
          realExpected: roundProj(r.player).expected
        }));

      const badgedNames = [...document.querySelectorAll(".formation-reserve-card")]
        .filter(card => card.querySelector(".formation-r-badge"))
        .map(card => card.querySelector(".formation-reserve-name")?.textContent || "");

      return { plainSum, withCaptainDouble, captainExpected, reserveChecks, badgedNames };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);

    assert.equal(
      result.withCaptainDouble - result.plainSum,
      result.captainExpected,
      `expected teamProjection() to add exactly the captain's own score on top of the plain sum (captain adds ${result.captainExpected}, actual diff was ${result.withCaptainDouble - result.plainSum})`
    );

    for (const r of result.reserveChecks) {
      const shouldHaveBadge = r.realExpected > 0;
      const hasBadge = result.badgedNames.some(n => n.startsWith(r.name));
      assert.equal(
        hasBadge,
        shouldHaveBadge,
        `${r.name}: real expected score is ${r.realExpected}, so R badge presence should be ${shouldHaveBadge} but was ${hasBadge}`
      );
    }
  } finally {
    await close();
  }
});
