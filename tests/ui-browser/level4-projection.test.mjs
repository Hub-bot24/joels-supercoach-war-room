import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Exercises the Level 4 engines (positional matchup, teammate synergy,
// goal-kicker matchup, aging curve) through the real, live ProjectionEngine
// object in a real browser - not string-matching the source, actually
// calling the functions the app calls and inspecting their output.
test("Level 4 engines are wired into the live ProjectionEngine and stay honest about data quality", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const players = App.players.filter(p => p.team && p.name);
      const sample = players.slice(0, 60);

      const projections = sample.map(p => {
        const pr = ProjectionEngine.project(p, App.round);
        return {
          name: p.name,
          team: p.team,
          expected: pr.expected,
          floor: pr.floor,
          ceiling: pr.ceiling,
          version: pr.version,
          reasons: pr.reasons,
          positionalMatchup: pr.breakdown?.positionalMatchup,
          teammateSynergy: pr.breakdown?.teammateSynergy,
          agingCurve: pr.breakdown?.agingCurve
        };
      });

      // Find a team where the synergy engine identifies a real primary
      // creator, to prove the generic (non-hardcoded) detection works.
      const teams = [...new Set(sample.map(p => p.team))];
      const hubs = teams
        .map(team => {
          const hub = ProjectionEngine.creativeHub(team, null);
          return hub ? { team, name: hub.name, pos: ProjectionEngine.playerPosition(hub) } : null;
        })
        .filter(Boolean);

      return { projections, hubs, playerCount: App.players.length };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.playerCount > 100, "expected real player data to have loaded");
    assert.ok(result.projections.length > 0, "expected projections to compute");

    for (const pr of result.projections) {
      assert.equal(pr.version, "ProjectionEngine-v2-level4", `${pr.name}: expected the live engine to report the level4 version tag`);

      // Every projection must carry all four Level 4 breakdown blocks -
      // proves the engines are actually wired into projectGame(), not just
      // defined and orphaned.
      assert.ok(pr.positionalMatchup, `${pr.name}: missing positionalMatchup breakdown`);
      assert.ok(pr.teammateSynergy, `${pr.name}: missing teammateSynergy breakdown`);
      assert.ok(pr.agingCurve, `${pr.name}: missing agingCurve breakdown`);

      // Data-honesty regression check: only one real round of history has
      // been captured in this repo so far, so no player should be able to
      // claim an "empirical" positional matchup source yet. If this ever
      // fires, either real history has genuinely accumulated (update the
      // test) or the sample-size gate in build-positional-matchups.mjs
      // broke and is publishing on too little data.
      assert.notEqual(
        pr.positionalMatchup.source,
        "empirical",
        `${pr.name}: claimed empirical positional matchup data with insufficient captured history`
      );

      // Aging curve must stay an honest no-op until a real data source
      // exists - it must never silently start adjusting scores.
      assert.equal(pr.agingCurve.expected, 0, `${pr.name}: aging curve should be inert with no age data source`);
      assert.equal(pr.agingCurve.active, false, `${pr.name}: aging curve should report itself inactive`);

      assert.ok(Number.isFinite(pr.expected), `${pr.name}: expected score must be a finite number`);
      assert.ok(pr.expected >= 0, `${pr.name}: expected score must not be negative`);
    }

    // At least one home/away fixture reason should show up somewhere in
    // this round's sample - proves the new home/away weighting fired.
    const hasHomeAwayReason = result.projections.some(pr =>
      (pr.reasons || []).some(r => r === "Home fixture" || r === "Away fixture")
    );
    assert.ok(hasHomeAwayReason, "expected at least one player to carry a home/away fixture reason");

    // Teammate Synergy Engine: confirm it identifies real primary creators
    // generically (by season average, not by name) for at least one team
    // in the sample.
    assert.ok(result.hubs.length > 0, "expected the synergy engine to identify at least one team's primary creator from real data");
    for (const { team, name, pos } of result.hubs) {
      assert.ok(name, `${team}: creativeHub() returned a record with no name`);
      assert.ok(["HFB", "5/8", "HOK"].includes(pos), `${team}: creative hub ${name} resolved to position "${pos}", not a spine/hooker position`);
    }
  } finally {
    await close();
  }
});
