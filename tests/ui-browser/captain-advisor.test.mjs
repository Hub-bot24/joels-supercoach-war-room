import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Captain/vice picks moved from a full panel to a compact star/VC badge
// directly on the field card, so the My Team page stays about showing the
// team. Captain is still the real top-projected player (matches roundProj()
// exactly - same single source of truth as everywhere else). Vice-captain
// is NOT simply "2nd highest score" - it follows the real SuperCoach
// captaincy loophole: the VC must kick off strictly before the captain, so
// a bad captain score can still be covered by switching captaincy to an
// already-locked-in VC score. If no field player plays earlier than the
// captain, that must be surfaced honestly (hasLoophole:false) rather than
// silently naming a same-time-or-later VC and implying cover that isn't
// real.
test("Captain/vice badges mark the real top player and a genuine loophole-eligible vice pick", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const fieldProjections = state.fieldSlots.map(({ name, player }) => ({
        name,
        expected: roundProj(player).expected
      })).sort((a, b) => b.expected - a.expected);

      const picks = captainVicePicks(state);
      const captainKickoff = picks.captain ? playerKickoffTime(getPlayer(picks.captain.name)) : null;
      const viceKickoff = picks.vice ? playerKickoffTime(getPlayer(picks.vice.name)) : null;

      const captainBadgeName = document.querySelector(".formation-card:has(.formation-cv-captain) .formation-name")?.textContent || "";
      const viceBadgeName = document.querySelector(".formation-card:has(.formation-cv-vice) .formation-name")?.textContent || "";
      const captainCount = document.querySelectorAll(".formation-cv-captain").length;
      const viceCount = document.querySelectorAll(".formation-cv-vice").length;
      const noLoopholeBadgeCount = document.querySelectorAll(".formation-cv-nolh").length;
      const panelGone = document.querySelector(".captain-advisor") === null;

      return {
        fieldProjections, picks, captainKickoff, viceKickoff,
        captainBadgeName, viceBadgeName, captainCount, viceCount, noLoopholeBadgeCount, panelGone
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.fieldProjections.length > 0, "expected a real starting field to be set");
    assert.ok(result.panelGone, "expected the old full-width Captain Advisor panel to be gone - captain/vice picks now live as compact field badges");
    assert.equal(result.captainCount, 1, "expected exactly one captain (star) badge on the field");
    assert.equal(result.viceCount, 1, "expected exactly one vice-captain badge on the field");

    const top = result.fieldProjections[0];
    assert.ok(
      result.captainBadgeName.startsWith(top.name),
      `expected the captain badge (${result.captainBadgeName}) to mark the real highest-projected field player (${top.name}, ${top.expected} pts)`
    );

    // The core invariant: if hasLoophole is claimed true, the vice pick's
    // real kickoff must be strictly earlier than the captain's - not a
    // plausible-looking label with no real timing behind it.
    if (result.picks.vice?.hasLoophole) {
      assert.ok(
        result.viceKickoff !== null && result.captainKickoff !== null && result.viceKickoff < result.captainKickoff,
        `claimed loophole cover but vice kickoff (${result.viceKickoff}) is not strictly before captain kickoff (${result.captainKickoff})`
      );
      assert.equal(result.noLoopholeBadgeCount, 0, "expected no dashed no-loophole styling when a real loophole was found");
    } else if (result.picks.vice) {
      // Explicitly flagged as no real cover - dashed badge must be present, not silently styled the same as real cover.
      assert.ok(result.noLoopholeBadgeCount >= 1, "expected the no-loophole VC to render with the dashed/no-cover badge styling");
    }
  } finally {
    await close();
  }
});
