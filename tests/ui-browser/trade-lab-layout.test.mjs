import assert from "node:assert/strict";
import test from "node:test";

import { openApp, switchTab } from "./helpers.mjs";

// Real UX finding: Trade Lab's actual manual tool (Trade OUT/IN, Score
// Trade, Apply Trade, Trade Verdict) used to sit below Trade Radar (3
// cards) and Trending Trade Targets (5 rows) - a real user had to scroll
// past 8 recommendation cards before reaching the primary utility. This
// checks the manual tool now renders first in DOM order.

test("Trade Lab's manual trade tool renders before Trade Radar and Trending Trade Targets", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await switchTab(page, "trade");
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const html = document.getElementById("trade").innerHTML;
      const tradeOutTop = document.getElementById("tradeOut")?.getBoundingClientRect().top ?? null;
      const tradeRadarHeading = [...document.querySelectorAll(".trade-radar h3")].find(h => h.textContent === "Trade Radar");
      return {
        tradeLabIndex: html.indexOf('id="tradeOut"'),
        tradeRadarIndex: html.indexOf(">Trade Radar<"),
        trendingIndex: html.indexOf(">Trending Trade Targets<"),
        tradeOutTop,
        tradeRadarHeadingTop: tradeRadarHeading?.getBoundingClientRect().top ?? null
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.tradeLabIndex >= 0, "expected the manual Trade Lab form to exist");
    assert.ok(result.tradeRadarIndex > result.tradeLabIndex, "expected Trade Radar to come after the manual Trade Lab tool");
    if (result.trendingIndex >= 0) {
      assert.ok(result.trendingIndex > result.tradeLabIndex, "expected Trending Trade Targets to come after the manual Trade Lab tool");
    }
    // Relative position, not an absolute pixel threshold - hero text can
    // wrap differently across environments/font stacks, but the manual
    // tool must always render physically above Trade Radar's real card.
    assert.ok(result.tradeOutTop != null && result.tradeRadarHeadingTop != null, "expected both the Trade OUT input and the Trade Radar heading to be real, measurable elements");
    assert.ok(result.tradeOutTop < result.tradeRadarHeadingTop, "expected the Trade OUT input to render physically above the Trade Radar card, not buried below it");
  } finally {
    await close();
  }
});
