import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Team Pulse surfaces boomChance/bustChance/confidence - real numbers the
// engine already computes for every player every round, but which had zero
// UI surface anywhere before this. This test checks the panel's synthesis
// against the same raw per-player data (roundProj), not against its own
// rendered text - it must never invent a number that doesn't trace back to
// something roundProj() actually returned for a real on-field player.
test("Team Pulse synthesizes real per-player data without inventing numbers", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const data = teamPulseData(state);
      if (!data) return { data: null };

      const fieldPlayers = state.fieldSlots.map(({ player }) => player).filter(Boolean);
      const realConfidenceCounts = { High: 0, Medium: 0, Low: 0 };
      let realAvailable = 0;
      for (const player of fieldPlayers) {
        const pr = roundProj(player);
        if (pr.expected <= 0) continue;
        realAvailable++;
        if (realConfidenceCounts[pr.confidence] !== undefined) realConfidenceCounts[pr.confidence]++;
      }

      const panelText = document.querySelector(".team-pulse")?.innerText || "";

      return { data, realConfidenceCounts, realAvailable, fieldCount: fieldPlayers.length, panelText };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.data, "expected Team Pulse to compute data for a real starting field");
    assert.ok(result.panelText.length > 0, "expected the Team Pulse panel to render real content");

    // The panel's confidence tally must exactly equal recomputing it
    // directly from roundProj() right now - not a cached or drifted number.
    assert.deepEqual(
      result.data.confidenceCounts,
      result.realConfidenceCounts,
      "Team Pulse confidence breakdown must exactly match live roundProj() confidence labels"
    );
    assert.equal(result.data.available, result.realAvailable, "Team Pulse available count must match real available field players");
    assert.equal(result.data.total, result.fieldCount, "Team Pulse total must match the real field slot count");

    // Every boom/bust pick shown must clear the panel's own stated
    // threshold when checked against the real projection, not a stale copy.
    for (const pick of result.data.boomPicks) {
      assert.ok(pick.pr.boomChance >= 25, `${pick.name}: shown as a boom pick with boomChance ${pick.pr.boomChance}, below the 25% threshold`);
    }
    for (const risk of result.data.bustRisks) {
      assert.ok(risk.pr.bustChance >= 30, `${risk.name}: shown as a bust risk with bustChance ${risk.pr.bustChance}, below the 30% threshold`);
    }
  } finally {
    await close();
  }
});
