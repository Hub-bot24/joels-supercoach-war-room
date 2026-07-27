import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Real NRL SuperCoach rules make a player eligible in at most 2 positions,
// ever. A player showing 3+ positions (e.g. "CTW/FLB/HFB") is definitionally
// impossible - this guards the fix for a real reported bug where an
// upstream scrape/generation mismatch produced exactly that for two real
// players (Latrell Siegwalt, Hugo Savala).
test("positions() never resolves more than 2 positions for any player, real or synthetic", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const liveViolations = await page.evaluate(() => {
      return window.App.players
        .map(p => ({ name: p.name, resolved: positions(p) }))
        .filter(r => r.resolved.length > 2);
    });
    assert.deepEqual(
      liveViolations,
      [],
      `expected every currently-loaded player to resolve to <=2 positions, found violations: ${JSON.stringify(liveViolations)}`
    );

    const synthetic = await page.evaluate(() => {
      const fake = { name: "Synthetic Test Player", dualPositions: ["CTW", "FLB", "HFB"] };
      return positions(fake);
    });
    assert.ok(synthetic.length <= 2, `expected a synthetic 3-position player to be capped to <=2, got ${JSON.stringify(synthetic)}`);

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
  } finally {
    await close();
  }
});
