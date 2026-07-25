import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Captain Advisor must never disagree with the numbers shown on the field
// itself - it reads roundProj(), the same single source of truth as
// everything else, rather than a bespoke captain-scoring formula.
test("Captain Advisor recommends the real top-projected on-field player", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const fieldProjections = state.fieldSlots.map(({ name, player }) => ({
        name,
        expected: roundProj(player).expected
      }));

      const panelText = document.querySelector(".captain-advisor")?.innerText || "";
      const cardCount = document.querySelectorAll(".captain-advisor-card").length;
      const firstCardName = document.querySelector(".captain-advisor-card .captain-advisor-name")?.textContent || "";

      return { fieldProjections, panelText, cardCount, firstCardName };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.fieldProjections.length > 0, "expected a real starting field to be set");
    assert.ok(result.panelText.length > 0, "expected the Captain Advisor panel to render real content");
    assert.ok(result.cardCount >= 1, "expected at least one recommendation card");

    const maxExpected = Math.max(...result.fieldProjections.map(f => f.expected));
    const topByField = result.fieldProjections.find(f => f.expected === maxExpected);

    assert.ok(
      result.firstCardName.startsWith(topByField.name),
      `expected the top recommendation (${result.firstCardName}) to match the real highest-projected field player (${topByField.name}, ${maxExpected} pts) - any mismatch means the advisor drifted from the single source of truth`
    );
  } finally {
    await close();
  }
});
