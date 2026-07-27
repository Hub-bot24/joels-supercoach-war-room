import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Real bug found via a user report: availability_overrides.json's own documented contract is
// "Manual trump file. Entries here override scraped player_status.json." - it is meant to be the
// fast, always-available correction path for whatever the automated scraping pipeline gets wrong.
// But availabilityStatus() checked the generated data/status_truth.json master truth FIRST and
// returned immediately whenever a record existed there - which is true for virtually every player,
// since status_truth.json is built to cover the whole roster. That made the override dead code: it
// could never actually change what the card showed. This test proves a fresh, explicit override now
// wins over the master truth, while a weak/low-confidence override still correctly defers to it.

test("a fresh, explicit override beats the automated status_truth master truth", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const player = { name: "ZZZ Test Override Player", team: "NEW", pos: "2RF", bye: [] };

      App.statusTruth = {
        ...App.statusTruth,
        players: {
          ...(App.statusTruth?.players || {}),
          "ZZZ Test Override Player": {
            displayStatus: "EXPECTED",
            available: true,
            colour: "yellow",
            reason: "Automated: no current club team-list truth.",
            round: App.round
          }
        }
      };

      App.availabilityOverrides = {
        ...App.availabilityOverrides,
        players: {
          ...(App.availabilityOverrides?.players || {}),
          "ZZZ Test Override Player": {
            status: "out",
            reason: "Manager confirmed out for the season",
            updatedAt: new Date().toISOString()
          }
        }
      };

      return availabilityStatus(player);
    });

    assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join(", ")}`);
    assert.equal(result.key, "out");
    assert.equal(result.available, false);
    assert.match(result.reason, /Manager confirmed out/);
  } finally {
    await close();
  }
});

test("a weak/low-confidence override does not suppress the automated master truth", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const player = { name: "ZZZ Test Weak Override Player", team: "NEW", pos: "2RF", bye: [] };

      App.statusTruth = {
        ...App.statusTruth,
        players: {
          ...(App.statusTruth?.players || {}),
          "ZZZ Test Weak Override Player": {
            displayStatus: "EXPECTED",
            available: true,
            colour: "yellow",
            reason: "Automated: no current club team-list truth.",
            round: App.round
          }
        }
      };

      App.availabilityOverrides = {
        ...App.availabilityOverrides,
        players: {
          ...(App.availabilityOverrides?.players || {}),
          "ZZZ Test Weak Override Player": {
            status: "out",
            reason: "Joel screenshot question mark indicator",
            updatedAt: new Date().toISOString()
          }
        }
      };

      return availabilityStatus(player);
    });

    assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join(", ")}`);
    assert.equal(result.key, "expected");
    assert.equal(result.available, true);
  } finally {
    await close();
  }
});
