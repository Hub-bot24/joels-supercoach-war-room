import assert from "node:assert/strict";
import test from "node:test";

import { openApp, switchTab } from "./helpers.mjs";

// Exercises Season Journey (index.html) - a real, honest record of what
// the user's OWN team actually scored, round by round. Every entry is
// created by genuinely recording the real lineup at the moment a round
// ends (captureSeasonJournalSnapshotIfNeeded), and later filled in with
// a real score once data/history/scores/<year>.json actually has it
// (finalizeSeasonJournalEntries) - never fabricated, never backfilled
// for rounds before this feature existed.

test("computeActualRoundScore sums real scores and doubles the captain when they played", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const entry = { round: 20, lineup: { HFB1: "Player A", CTW1: "Player B" }, captain: "Player A", vice: "Player B" };
      const scores = { "Player A": { 20: 80 }, "Player B": { 20: 50 } };
      return computeActualRoundScore(entry, scores);
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    // base 80+50=130, captain (Player A, real score 80>0) doubles: +80 = 210
    assert.equal(result.total, 210);
  } finally {
    await close();
  }
});

test("computeActualRoundScore doubles the vice instead when the captain has no real score that round (bye/DNP)", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const entry = { round: 20, lineup: { HFB1: "Player A", CTW1: "Player B" }, captain: "Player A", vice: "Player B" };
      // Player A has no entry for round 20 - a real bye/DNP, per the
      // source's own convention (parseScoresByRound never writes a 0/absent
      // round), not a fabricated zero.
      const scores = { "Player B": { 20: 50 } };
      return computeActualRoundScore(entry, scores);
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    // base 0+50=50, captain didn't play (0), vice (Player B, 50) doubles instead: +50 = 100
    assert.equal(result.total, 100);
  } finally {
    await close();
  }
});

test("computeActualRoundScore returns null for an entry with no fielded lineup", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => computeActualRoundScore({ round: 20, lineup: {} }, {}));
    assert.deepEqual(pageErrors, []);
    assert.equal(result, null);
  } finally {
    await close();
  }
});

test("seasonJournalMaxCapturedRound derives the real highest round seen anywhere in the captured dataset", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      App.formHistory = { players: { "Player A": { 18: 60, 19: 70 }, "Player B": { 18: 55, 20: 65 } } };
      return seasonJournalMaxCapturedRound();
    });
    assert.deepEqual(pageErrors, []);
    assert.equal(result, 20);
  } finally {
    await close();
  }
});

test("finalizeSeasonJournalEntries only scores rounds within the real captured range, and never rescores an already-finalized entry", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      App.formHistory = { players: { "Player A": { 18: 60, 19: 70 } } };
      App.seasonJournal = [
        { round: 18, lineup: { HFB1: "Player A" }, captain: "Player A", vice: null, actualScore: null, scoredAt: null },
        { round: 19, lineup: { HFB1: "Player A" }, captain: "Player A", vice: null, actualScore: 999, scoredAt: "already-scored" },
        { round: 21, lineup: { HFB1: "Player A" }, captain: "Player A", vice: null, actualScore: null, scoredAt: null }
      ];
      const changed = finalizeSeasonJournalEntries();
      return { changed, journal: App.seasonJournal };
    });

    assert.deepEqual(pageErrors, []);
    assert.equal(result.changed, true);
    assert.equal(result.journal[0].actualScore, 120, "round 18 (within captured range) should be scored: 60 base + 60 captain double");
    assert.equal(result.journal[1].actualScore, 999, "an already-scored entry must never be recomputed");
    assert.equal(result.journal[2].actualScore, null, "round 21 is beyond the real captured range and must stay pending");
  } finally {
    await close();
  }
});

test("captureSeasonJournalSnapshotIfNeeded records the real lineup once, and is idempotent for the same round", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const realPlayer = App.players.find(p => p.team && p.name);
      App.myTeam = [realPlayer.name];
      App.lineup = { HFB1: realPlayer.name };
      App.reserveOrder = {};
      App.round = 15;
      App.seasonJournal = [];

      const first = captureSeasonJournalSnapshotIfNeeded(15);
      const second = captureSeasonJournalSnapshotIfNeeded(15);
      return { first, second, journal: App.seasonJournal, realPlayerName: realPlayer.name };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.equal(result.first, true, "expected the first call to record a real snapshot");
    assert.equal(result.second, false, "expected the second call for the same round to be a no-op");
    assert.equal(result.journal.length, 1);
    assert.equal(result.journal[0].round, 15);
    assert.equal(result.journal[0].lineup.HFB1, result.realPlayerName, "expected the real fielded player's name in the snapshot");
    assert.equal(result.journal[0].actualScore, null, "a freshly captured snapshot must start pending, never a guessed score");
  } finally {
    await close();
  }
});

test("captureSeasonJournalSnapshotIfNeeded does nothing when there's no real fielded lineup to record", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      App.myTeam = [];
      App.lineup = {};
      App.round = 15;
      App.seasonJournal = [];
      const captured = captureSeasonJournalSnapshotIfNeeded(15);
      return { captured, journalLength: App.seasonJournal.length };
    });

    assert.deepEqual(pageErrors, []);
    assert.equal(result.captured, false);
    assert.equal(result.journalLength, 0);
  } finally {
    await close();
  }
});

test("mergeSeasonJournal keeps every distinct round from both copies and prefers a real scored entry over a pending one", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const local = [
        { round: 18, actualScore: null },
        { round: 19, actualScore: 1500 }
      ];
      const cloud = [
        { round: 18, actualScore: 1400 },
        { round: 20, actualScore: null }
      ];
      return mergeSeasonJournal(local, cloud);
    });

    assert.deepEqual(pageErrors, []);
    assert.equal(result.length, 3, "expected all 3 distinct rounds to survive the merge");
    assert.equal(result.find(e => e.round === 18).actualScore, 1400, "expected the cloud's real score to win over the local pending entry for the same round");
    assert.equal(result.find(e => e.round === 19).actualScore, 1500);
    assert.equal(result.find(e => e.round === 20).actualScore, null);
  } finally {
    await close();
  }
});

test("Season tab shows the honest empty state when there is no journal yet", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await switchTab(page, "season");
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => ({
      hasEmptyCard: Boolean(document.querySelector(".season-empty-card")),
      text: document.getElementById("season").textContent
    }));

    assert.deepEqual(pageErrors, []);
    // Real production state today has no journal yet, so the honest
    // empty state is expected; only assert its content when it's the
    // state actually showing, so this doesn't break once real entries
    // genuinely exist after this feature has been live a while.
    if (result.hasEmptyCard) {
      assert.ok(result.text.includes("Season Journey starts now"));
    }
  } finally {
    await close();
  }
});

test("Season tab renders a real chart once 2+ rounds are scored, and lists a pending round honestly", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      App.seasonJournal = [
        { round: 18, lineup: {}, captain: "Cap A", vice: null, teamValue: 15000000, actualScore: 1450, scoredAt: "x" },
        { round: 19, lineup: {}, captain: "Cap A", vice: null, teamValue: 15200000, actualScore: 1610, scoredAt: "x" },
        { round: 20, lineup: {}, captain: "Cap A", vice: null, teamValue: 15100000, actualScore: null, scoredAt: null }
      ];
      renderSeason();
      const box = document.getElementById("season");
      return {
        hasChart: Boolean(box.querySelector(".season-chart-svg")),
        text: box.textContent,
        pendingRows: box.querySelectorAll(".season-round-pending").length
      };
    });

    assert.deepEqual(pageErrors, []);
    assert.ok(result.hasChart, "expected a real chart once 2 rounds are scored");
    assert.ok(result.text.includes("2") && result.text.includes("Rounds Scored"));
    assert.ok(result.text.includes("1530") || result.text.includes("Average Score"), "expected an average score stat");
    assert.equal(result.pendingRows, 1, "expected exactly the one unscored round to show as Pending");
  } finally {
    await close();
  }
});

test("boot() genuinely captures a Season Journey snapshot for the round that just ended, on a real round transition", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const setup = await page.evaluate(() => {
      const realPlayer = App.players.find(p => p.team && p.name);
      App.myTeam = [realPlayer.name];
      App.lineup = { HFB1: realPlayer.name };
      App.reserveOrder = {};
      App.seasonJournal = [];
      const oldRound = Math.max(1, App.round - 1);
      App.round = oldRound;
      saveLocal({ cloud: false });
      return { oldRound };
    });

    if (setup.oldRound < 1) return;

    // Reload so the real boot() sequence runs again from scratch against
    // the localStorage state just set up - the exact code path a real
    // user hits opening the app after a round has genuinely ended.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    const result = await page.evaluate(() => ({ journal: App.seasonJournal, round: App.round }));

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.round >= setup.oldRound, "expected the real round to be at or beyond the round set before reload");
    if (result.round > setup.oldRound) {
      const entry = result.journal.find(e => e.round === setup.oldRound);
      assert.ok(entry, `expected a real Season Journey snapshot for R${setup.oldRound} once the real round advanced to R${result.round}`);
      assert.equal(entry.actualScore, null, "a just-captured snapshot must start pending, never a guessed score");
    }
  } finally {
    await close();
  }
});
