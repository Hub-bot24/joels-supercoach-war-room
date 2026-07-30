import assert from "node:assert/strict";
import test from "node:test";

import { openApp, switchTab } from "./helpers.mjs";

// Exercises the real Crystal Ball accuracy card in the live app - both its
// honest "gathering data" state (the real state right now, since no round
// has finished yet) and the real-metric state once enough comparisons
// exist, driven by real App.projectionAccuracy data, not string-matched
// source text.
test("Crystal Ball shows an honest gathering-data state when data/projection_accuracy.json has no overall metric yet", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await switchTab(page, "level3");
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const card = document.querySelector(".l3-accuracy-card");
      const gauge = document.getElementById("accuracyGatherGauge");
      return {
        cardText: card?.textContent || "",
        hasGatherGauge: Boolean(gauge),
        projectionAccuracy: App.projectionAccuracy
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.cardText.includes("Crystal Ball"), "expected the Crystal Ball card to render on Level 3");

    // Real state right now: no round has completed with both a captured
    // projection and a real score, so this must be the honest "gathering"
    // state, never a fabricated accuracy number.
    if (!result.projectionAccuracy?.overall) {
      assert.ok(result.hasGatherGauge, "expected the gathering-state progress gauge when there's no trustworthy overall metric yet");
      assert.ok(result.cardText.includes("Gathering real results"), "expected the honest gathering-data message");
    }
  } finally {
    await close();
  }
});

test("Crystal Ball renders the real metric, bias direction and position breakdown once enough comparisons exist", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      // Real shape produced by scripts/build-projection-accuracy.mjs -
      // simulating the state once enough real rounds have accumulated,
      // without needing to fabricate an actual multi-round history here.
      App.projectionAccuracy = {
        generatedAt: new Date().toISOString(),
        season: 2026,
        minSamplesOverall: 20,
        minSamplesPosition: 5,
        totalComparisons: 42,
        roundsCompared: [20, 21],
        overall: { samples: 42, meanAbsoluteError: 12.4, meanBias: 6.1 },
        byPosition: {
          HFB: { samples: 8, meanAbsoluteError: 9.2, meanBias: 3.5 },
          CTW: { samples: 15, meanAbsoluteError: 14.1, meanBias: -8.2 }
        }
      };
      App.__level3CacheKey = null;
      renderLevel3();
      const card = document.querySelector(".l3-accuracy-card");
      return {
        cardText: card?.textContent || "",
        hasGatherGauge: Boolean(document.getElementById("accuracyGatherGauge")),
        posPillCount: document.querySelectorAll(".l3-accuracy-pos-pill").length
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.equal(result.hasGatherGauge, false, "the real-metric state must not show the gathering-data gauge");
    assert.ok(result.cardText.includes("±12.4"), "expected the real mean absolute error to render");
    assert.ok(result.cardText.includes("Real Projection Accuracy"), "expected the real-metric headline");
    assert.ok(result.cardText.includes("42 real results"), "expected the real sample count in the footnote");
    assert.equal(result.posPillCount, 2, "expected one pill per position in byPosition");
  } finally {
    await close();
  }
});
