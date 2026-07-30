import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Exercises the real Form Sparkline on the player card (playerFormSparklineHtml,
// index.html) - built from App.formHistory (data/history/scores/<year>.json,
// captured by scripts/capture-player-scores.mjs from real, verified per-round
// SuperCoach scores - see #277). No round history has been captured into the
// live data yet, so the honest "render nothing" path is the real state right
// now; the populated path is exercised with a realistic mocked payload.

test("playerFormSparklineHtml renders nothing when there is no real per-round history for a player", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const realPlayer = App.players.find(p => p.team && p.name);
      App.formHistory = null;
      const emptyHtml = playerFormSparklineHtml(realPlayer);

      App.formHistory = { players: { [realPlayer.name]: { 12: 68 } } };
      const onePointHtml = playerFormSparklineHtml(realPlayer);

      return { emptyHtml, onePointHtml, hasRealPlayer: Boolean(realPlayer) };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.hasRealPlayer, "expected at least one real player to test against");
    assert.equal(result.emptyHtml, "", "expected no sparkline markup when App.formHistory is absent");
    assert.equal(result.onePointHtml, "", "expected no sparkline markup with fewer than 2 real data points");
  } finally {
    await close();
  }
});

test("playerFormSparklineHtml renders a real trend line and trend arrow once at least 2 real rounds exist", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const realPlayer = App.players.find(p => p.team && p.name);
      // Real shape produced by scripts/capture-player-scores.mjs: round -> score.
      App.formHistory = {
        players: {
          [realPlayer.name]: { 9: 52, 10: 61, 11: 47, 12: 74 }
        }
      };
      const html = playerFormSparklineHtml(realPlayer);
      return { html };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.html.includes("Last 4 Rounds"), "expected the real round count in the header");
    assert.ok(result.html.includes("<svg"), "expected an svg sparkline to render");
    assert.ok(result.html.includes("↑"), "expected an upward trend arrow since round 12's score (74) exceeds round 9's (52)");
    assert.ok(result.html.includes("52") && result.html.includes("74"), "expected the real first and last scores to render");
  } finally {
    await close();
  }
});

test("the real player card includes the form sparkline once App.formHistory has real data for that player", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const nameLink = page.locator(".player-name-link, [onclick*='openPlayerCard']").first();
    const openedName = await nameLink.evaluate(el => {
      const match = /openPlayerCard\('([^']*)'\)/.exec(el.getAttribute("onclick") || "");
      return match ? match[1] : "";
    });
    assert.ok(openedName, "expected the clicked element's onclick to name a real player");

    await nameLink.click({ force: true, timeout: 15000 });

    const overlay = page.locator("#wrPlayerCardOverlay");
    await assert.doesNotReject(overlay.waitFor({ state: "visible", timeout: 15000 }));

    // Seed formHistory for the exact player whose card opened, then re-open
    // the same card so the sparkline picks up the seeded real data.
    await page.evaluate(name => {
      App.formHistory = { players: { [name]: { 9: 52, 10: 61, 11: 47, 12: 74 } } };
      window.closePlayerCard();
      window.openPlayerCard(name);
    }, openedName);
    await page.waitForTimeout(300);

    const hasSparkline = await page.locator(".wr-form-spark").count();
    assert.ok(hasSparkline > 0, "expected the form sparkline to render once real per-round history exists for the opened player");

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
  } finally {
    await close();
  }
});
