import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Exercises the real fix for a genuine onboarding dead end found during a
// UX walkthrough: an empty FIELD slot had drag/drop handlers only - no
// click handler at all - so a brand new user (or anyone with an empty
// roster) had nowhere to click to add their first player, since there was
// nothing on the bench yet to drag from. Empty RESERVE slots already had a
// working click-to-add flow (emptyReserveTrade); this mirrors that exact
// pattern for field slots (emptyFieldTrade) instead of inventing something
// new.

async function clearTeam(page) {
  await page.evaluate(() => {
    App.myTeam = [];
    App.lineup = {};
    App.reserveOrder = {};
    App.selectedReserves = [];
    App.selectedTeamSlot = "";
    App.teamActionMode = "";
    renderActive();
  });
  await page.waitForTimeout(300);
}

test("clicking an empty field slot on a genuinely empty team opens a real add-player panel", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await clearTeam(page);

    const card = page.locator(".formation-card.formation-empty").first();
    await card.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(400);

    const result = await page.evaluate(() => ({
      hasPanel: Boolean(document.getElementById("teamActionPanel")),
      panelText: document.getElementById("teamActionPanel")?.textContent || "",
      optionCount: document.querySelectorAll("[data-trade-option]").length,
      teamActionMode: App.teamActionMode
    }));

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.equal(result.teamActionMode, "emptyFieldTrade");
    assert.ok(result.hasPanel, "expected the team action panel to open");
    assert.ok(result.panelText.includes("Add a player to"), "expected the real 'Add a player to <slot>' header");
    assert.ok(result.optionCount > 0, "expected real eligible players to be listed");
  } finally {
    await close();
  }
});

test("adding a player from an empty field slot genuinely adds them to myTeam and the lineup", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await clearTeam(page);

    const card = page.locator(".formation-card.formation-empty").first();
    const slotId = await card.getAttribute("data-slot");
    await card.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(400);

    const firstOption = page.locator("[data-trade-option]").first();
    await firstOption.click({ timeout: 5000 });
    await page.waitForTimeout(400);

    const result = await page.evaluate((slotId) => ({
      lineupName: App.lineup[slotId],
      myTeamCount: App.myTeam.length,
      myTeamHasLineupPlayer: App.myTeam.includes(App.lineup[slotId]),
      panelClosed: !document.getElementById("teamActionPanel"),
      teamActionMode: App.teamActionMode
    }), slotId);

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.lineupName, "expected a real player name filled into the lineup slot");
    assert.equal(result.myTeamCount, 1, "expected exactly the one added player in myTeam");
    assert.ok(result.myTeamHasLineupPlayer, "expected the lineup player to also be in myTeam");
    assert.equal(result.teamActionMode, "", "expected the action mode to clear after a successful add");
    assert.ok(result.panelClosed, "expected the panel to close after adding");
  } finally {
    await close();
  }
});

test("only real position-eligible players are offered for an empty field slot", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await clearTeam(page);

    const result = await page.evaluate(() => {
      const slotId = "HFB1"; // Halfback - a real, narrow position
      const slot = slotById[slotId];
      const opts = App.players.filter(r => !App.myTeam.includes(r.name) && eligible(r, slot));
      emptyFieldTrade(slotId);
      const panelNames = [...document.querySelectorAll("[data-trade-option] b")].map(el => el.textContent);
      return { realEligibleCount: opts.length, panelOptionCount: panelNames.length };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.equal(result.panelOptionCount, result.realEligibleCount, "expected the panel to list exactly the real eligible player set, no more and no fewer");
  } finally {
    await close();
  }
});

test("an existing off-field squad player can be moved into an empty field slot instead of adding a new one", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      // Real scenario: user already has a squad member who happens to be
      // eligible for HFB but currently sits unassigned (not on any field
      // slot or reserve slot) - move should offer them without adding a
      // second copy of anyone.
      const slotId = "HFB1";
      const slot = slotById[slotId];
      const candidate = App.players.find(p => p && p.name && eligible(p, slot));
      App.myTeam = [candidate.name];
      App.lineup = {};
      App.reserveOrder = {};
      emptyFieldTrade(slotId);
      const html = document.getElementById("teamActionPanel")?.textContent || "";
      const hasMoveOption = html.includes(candidate.name) && html.includes("Move current team player (1)");
      moveEmptyFieldTeamPlayer(slotId, candidate.name);
      return { hasMoveOption, lineupName: App.lineup[slotId], myTeamCount: App.myTeam.length, candidateName: candidate.name };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.hasMoveOption, "expected the existing squad member to appear as a real 'move' option");
    assert.equal(result.lineupName, result.candidateName, "expected the existing squad member to be moved into the slot");
    assert.equal(result.myTeamCount, 1, "moving should not create a duplicate - myTeam count must stay the same");
  } finally {
    await close();
  }
});

test("applyEmptyFieldTrade rejects an invalid attempt instead of corrupting state", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const slotId = "HFB1"; // real halfback slot
      App.myTeam = [];
      App.lineup = {};
      const wrongPositionPlayer = App.players.find(p => p && p.name && !eligible(p, slotById[slotId]));
      applyEmptyFieldTrade(slotId, wrongPositionPlayer.name);
      return { lineupName: App.lineup[slotId], myTeamCount: App.myTeam.length };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.equal(result.lineupName, undefined, "an ineligible player must never be placed in the slot");
    assert.equal(result.myTeamCount, 0, "an invalid add must never mutate myTeam");
  } finally {
    await close();
  }
});
