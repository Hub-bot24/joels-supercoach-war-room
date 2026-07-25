import assert from "node:assert/strict";
import test from "node:test";

import { openApp, switchTab } from "./helpers.mjs";

// Trade Radar must never quietly disagree with the Trade Lab's own verdict.
// The near-miss this caught during development: suggesting a player who is
// NOT NAMED this round purely because their 5-game average is high, with
// no indication that trading them in scores 0 for the round right now -
// which then contradicted Trade Lab's "weak trade" verdict for the exact
// same pair with no explanation. Every suggested replacement must show its
// real this-round number (matching roundProj() exactly) and, if that
// number is depressed by unavailability, an explicit risk note.
test("Trade Radar suggestions stay consistent with roundProj() and flag unavailable replacements", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await switchTab(page, "trade");

    const result = await page.evaluate(() => {
      const weakLinks = tradeRadarWeakLinks();
      const checks = weakLinks.map(weak => {
        const replacement = tradeRadarReplacementFor(weak.player);
        if (!replacement) return null;
        const liveExpected = roundProj(replacement.player).expected;
        const status = availabilityStatus(replacement.player);
        return {
          outName: weak.player.name,
          inName: replacement.player.name,
          cardThisRound: replacement.pr.expected,
          liveExpected,
          available: status?.available,
          statusKey: status?.key
        };
      }).filter(Boolean);

      const cardHtmlHasRiskNote = document.querySelector(".trade-radar-risk") !== null;
      const anyUnavailableReplacement = checks.some(c => c.available === false);

      return { checks, cardHtmlHasRiskNote, anyUnavailableReplacement, weakLinkCount: weakLinks.length };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);

    for (const c of result.checks) {
      assert.equal(
        c.cardThisRound,
        c.liveExpected,
        `${c.inName}: Trade Radar's "this round" number (${c.cardThisRound}) must exactly match roundProj() (${c.liveExpected}) - any mismatch means the panel drifted from the single source of truth`
      );
    }

    // This assertion is data-dependent (round 21's real team-list state), not
    // a fixed expectation - if it ever fails because no weak links currently
    // have an unavailable replacement, that's fine; the important invariant
    // (checked above unconditionally) is that the panel's number always
    // matches roundProj(). Only assert the risk-note wiring when the
    // scenario that requires it actually occurred.
    if (result.anyUnavailableReplacement) {
      assert.ok(result.cardHtmlHasRiskNote, "expected an unavailable trade-in suggestion to render a visible risk note, not a silent 0");
    }
  } finally {
    await close();
  }
});
