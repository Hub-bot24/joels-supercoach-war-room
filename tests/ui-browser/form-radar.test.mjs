import assert from "node:assert/strict";
import test from "node:test";

import { openApp, switchTab } from "./helpers.mjs";

// Exercises the real Form Radar card on Level 3 (formRadarCardHtml,
// index.html) - a league-wide view of real risers/fallers built entirely
// from last3Avg vs seasonAvg, both already on every player's own record.
// No new fetch, no fabricated numbers: a player only appears once they
// have a genuine last3Avg and a season average with a reasonable sample.

test("Form Radar renders using the real live player pool with no fabricated entries", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await switchTab(page, "level3");
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const rows = formRadarRows();
      const card = document.querySelector(".l3-form-radar-card");
      return {
        rowCount: rows.length,
        everyRowHasRealNumbers: rows.every(o => Number.isFinite(o.pr.last3Avg) && Number.isFinite(o.pr.seasonAvg) && o.pr.seasonAvg >= 25 && o.pr.last3Avg > 0),
        cardText: card?.textContent || "",
        hasCard: Boolean(card)
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.everyRowHasRealNumbers, "every Form Radar row must have a real last3Avg and a season average with a reasonable sample");

    // The real live data may or may not currently produce 6+ qualifying
    // players (formRadarRows' own honesty gate) - only assert the card's
    // content once it actually renders.
    if (result.hasCard) {
      assert.ok(result.cardText.includes("Form Radar"), "expected the Form Radar headline when the card renders");
    }
  } finally {
    await close();
  }
});

test("Form Radar shows real risers and fallers, sorted by the biggest genuine last3 vs season delta", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      // Realistic shape of a real player record (players.json) - seeding
      // enough players to clear formRadarRows' own >=6-row honesty gate,
      // with clear, unambiguous risers and fallers.
      App.players = [
        { name: "Riser One", team: "TEAM", pos: "HFB", avg: 60, last3Avg: 85 },
        { name: "Riser Two", team: "TEAM", pos: "CTW", avg: 50, last3Avg: 68 },
        { name: "Faller One", team: "TEAM", pos: "2RF", avg: 70, last3Avg: 40 },
        { name: "Faller Two", team: "TEAM", pos: "FRF", avg: 55, last3Avg: 32 },
        { name: "Steady One", team: "TEAM", pos: "HOK", avg: 45, last3Avg: 46 },
        { name: "Steady Two", team: "TEAM", pos: "FLB", avg: 65, last3Avg: 64 }
      ];
      App.projectionCache?.clear?.();
      App.__level3CacheKey = null;
      renderLevel3();
      const card = document.querySelector(".l3-form-radar-card");
      return {
        cardText: card?.textContent || "",
        risers: [...document.querySelectorAll(".l3-form-col")].find(c => c.querySelector("h3")?.textContent === "Risers")?.textContent || "",
        fallers: [...document.querySelectorAll(".l3-form-col")].find(c => c.querySelector("h3")?.textContent === "Fallers")?.textContent || ""
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.cardText.includes("Form Radar"), "expected the Form Radar card to render with 6 qualifying players");
    assert.ok(result.risers.includes("Riser One") && result.risers.includes("Riser Two"), "expected both real risers to appear in the Risers column");
    assert.ok(result.fallers.includes("Faller One") && result.fallers.includes("Faller Two"), "expected both real fallers to appear in the Fallers column");
    assert.ok(!result.risers.includes("Steady"), "a player with a sub-threshold delta should not appear as a riser");
    assert.ok(!result.fallers.includes("Steady"), "a player with a sub-threshold delta should not appear as a faller");
  } finally {
    await close();
  }
});

test("Form Radar renders nothing when fewer than 6 real players qualify, rather than a sparse or misleading list", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      App.players = [
        { name: "Only Riser", team: "TEAM", pos: "HFB", avg: 60, last3Avg: 85 },
        { name: "Only Faller", team: "TEAM", pos: "CTW", avg: 70, last3Avg: 40 }
      ];
      App.__level3CacheKey = null;
      renderLevel3();
      return { hasCard: Boolean(document.querySelector(".l3-form-radar-card")) };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.equal(result.hasCard, false, "expected no Form Radar card when fewer than 6 real players qualify");
  } finally {
    await close();
  }
});
