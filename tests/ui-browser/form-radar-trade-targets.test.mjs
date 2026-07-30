import assert from "node:assert/strict";
import test from "node:test";

import { openApp, switchTab } from "./helpers.mjs";

// Exercises Trending Trade Targets on Trade Lab (formRadarTradeTargetsHtml,
// index.html) - the real Form Radar risers (last3Avg vs seasonAvg, same
// data and +/-5pt threshold as the Level 3 Form Radar card) who aren't
// already on the user's team, offered as "Load into Trade Lab" shortcuts.
// Who to trade OUT is always the user's own call - this only prefills IN.

test("Trending Trade Targets only ever lists real risers not already on the team", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await switchTab(page, "trade");
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const targets = formRadarTradeTargets();
      const owned = new Set(App.myTeam || []);
      return {
        allUnowned: targets.every(o => !owned.has(o.p.name)),
        allAboveThreshold: targets.every(o => o.delta >= 5),
        count: targets.length
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.allUnowned, "no target should already be on the user's own team");
    assert.ok(result.allAboveThreshold, "every target must clear the real +5pt riser threshold");
  } finally {
    await close();
  }
});

test("Trending Trade Targets renders seeded risers, excludes owned players, and 'Load into Trade Lab' prefills tradeIn only", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      App.myTeam = ["Owned Riser"];
      App.players = [
        { name: "Owned Riser", team: "TEAM", pos: "HFB", avg: 60, last3Avg: 85 },
        { name: "Unowned Riser", team: "TEAM", pos: "CTW", avg: 50, last3Avg: 70 },
        { name: "Steady Player", team: "TEAM", pos: "FRF", avg: 55, last3Avg: 56 }
      ];
      App.projectionCache?.clear?.();
      if (typeof invalidateRoundProjCache === "function") invalidateRoundProjCache();
      renderTrade();
      const targetsHtml = document.querySelector(".form-trend-trade-grid")?.innerHTML || "";
      return { html: document.getElementById("trade").innerHTML, targetsHtml };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.html.includes("Trending Trade Targets"), "expected the Trending Trade Targets section to render");
    assert.ok(result.targetsHtml.includes("Unowned Riser"), "expected the real unowned riser to appear as a target");
    assert.ok(!result.targetsHtml.includes("Owned Riser"), "a player already on the user's team must never appear as a trade target");

    await switchTab(page, "trade");
    const inValueBefore = await page.locator("#tradeIn").inputValue();
    assert.equal(inValueBefore, "", "tradeIn should start empty");

    await page.locator(".form-trend-trade-card button", { hasText: "Load into Trade Lab" }).first().click();
    await page.waitForTimeout(200);

    const inValue = await page.locator("#tradeIn").inputValue();
    const outValue = await page.locator("#tradeOut").inputValue();
    assert.equal(inValue, "Unowned Riser", "expected 'Load into Trade Lab' to prefill tradeIn with the real riser's name");
    assert.equal(outValue, "", "tradeOut must stay empty - trading out is always the user's own choice");
  } finally {
    await close();
  }
});
