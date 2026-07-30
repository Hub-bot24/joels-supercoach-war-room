import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Exercises the War Room Briefing card at the top of My Team
// (warRoomBriefingHtml, index.html) - a synthesis of signals the rest of
// the app already computes for real (Form Radar, Trade Radar, Crystal
// Ball, bye data), not a new computation of its own. Every row is
// conditional on its underlying real data actually existing.

test("War Room Briefing renders on the real live team with no fabricated rows", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const rows = warRoomBriefingRows();
      return {
        hasCard: Boolean(document.querySelector(".wr-briefing-card")),
        rowTexts: rows.map(r => r.text)
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.hasCard, "expected the War Room Briefing card to always render on My Team");
    // Not asserting on specific row content - the real live team's state
    // (form, trade signals, byes) varies. Just confirm it renders without
    // throwing and produces real, non-empty strings when rows exist.
    assert.ok(result.rowTexts.every(t => typeof t === "string" && t.length > 0));
  } finally {
    await close();
  }
});

test("War Room Briefing surfaces a real form riser and faller from the user's own team", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      App.myTeam = ["Team Riser", "Team Faller", "Team Steady"];
      App.players = [
        { name: "Team Riser", team: "TEAM", pos: "HFB", avg: 60, last3Avg: 85 },
        { name: "Team Faller", team: "TEAM", pos: "CTW", avg: 70, last3Avg: 40 },
        { name: "Team Steady", team: "TEAM", pos: "FRF", avg: 55, last3Avg: 56 }
      ];
      App.projectionCache?.clear?.();
      if (typeof invalidateRoundProjCache === "function") invalidateRoundProjCache();
      const rows = warRoomBriefingRows();
      return { rows };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.rows.some(r => r.text.includes("Team Riser") && r.tone === "good"), "expected the real team riser to appear as a 'good' tone row");
    assert.ok(result.rows.some(r => r.text.includes("Team Faller") && r.tone === "bad"), "expected the real team faller to appear as a 'bad' tone row");
    assert.ok(!result.rows.some(r => r.text.includes("Team Steady")), "a player with a sub-threshold delta should not appear in the briefing");
  } finally {
    await close();
  }
});

test("War Room Briefing surfaces a real upcoming bye alert for the user's own team", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const nextRound = Number(App.round || 1) + 1;
      App.myTeam = ["Bye Player One", "Bye Player Two"];
      App.players = [
        { name: "Bye Player One", team: "TEAM", pos: "HFB", avg: 60, bye: [nextRound] },
        { name: "Bye Player Two", team: "TEAM", pos: "CTW", avg: 50, bye: [nextRound] }
      ];
      // teamPlayers()/getPlayer() read from App.playerMap, a separate
      // lookup built once at boot - real production code (see boot()'s
      // own App.playerMap=new Map(...) line) rebuilds it whenever
      // App.players changes, so tests that reassign App.players must too.
      App.playerMap = new Map(App.players.map(p => [p.name, p]));
      const rows = warRoomBriefingRows();
      return { rows, nextRound };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    const byeRow = result.rows.find(r => r.tone === "warn");
    assert.ok(byeRow, "expected a bye-alert row when 2 of the user's players are on bye next round");
    assert.ok(byeRow.text.includes("2 of your players") && byeRow.text.includes(`R${result.nextRound}`), "expected the real bye count and round in the alert");
    assert.ok(byeRow.text.includes("Bye Player One") && byeRow.text.includes("Bye Player Two"), "expected both real affected players named");
  } finally {
    await close();
  }
});

test("War Room Briefing falls back to an honest 'nothing urgent' message when no real signal exists", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      App.myTeam = ["Quiet Player"];
      App.players = [{ name: "Quiet Player", team: "TEAM", pos: "HFB", avg: 55, last3Avg: 56 }];
      App.playerMap = new Map(App.players.map(p => [p.name, p]));
      App.projectionAccuracy = null;
      App.projectionCache?.clear?.();
      if (typeof invalidateRoundProjCache === "function") invalidateRoundProjCache();
      const html = warRoomBriefingHtml();
      return { html };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.html.includes("Nothing urgent right now"), "expected the honest fallback message when no row has real data");
  } finally {
    await close();
  }
});
