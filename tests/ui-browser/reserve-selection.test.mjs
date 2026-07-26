import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Real SuperCoach rule (confirmed via WebSearch: participants choose 13
// starters plus 4 of their remaining 12 "substitutes" each round): which 4
// reserves count is a manual weekly choice, not something the app should
// guess by auto-picking the top scorers. This tests the toggle mechanism
// itself - select/deselect, the max-4 cap with a toast, and that the toggle
// re-renders the DOM with the real selection state.
test("toggleSelectedReserve selects/deselects, enforces the max-4 cap, and re-renders the DOM", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const selectedBefore = [...(App.selectedReserves || [])];

      const toDeselect = selectedBefore[0];
      toggleSelectedReserve(toDeselect);
      const afterDeselect = [...App.selectedReserves];
      const deselectWorked = !afterDeselect.includes(toDeselect) && afterDeselect.length === selectedBefore.length - 1;

      const candidate = state.reserveRows.find(r => r.player && !afterDeselect.includes(r.player.name));
      toggleSelectedReserve(candidate.player.name);
      const afterSelect = [...App.selectedReserves];
      const selectWorked = afterSelect.includes(candidate.player.name) && afterSelect.length === 4;

      const card = [...document.querySelectorAll(".formation-reserve-card")]
        .find(c => c.querySelector(".formation-reserve-name")?.textContent?.trim() === candidate.player.name);
      const domSelectedOn = card ? card.querySelector(".formation-reserve-select-on") !== null : null;

      // Now at 4 selected - try a 5th, must be refused with a toast, selection unchanged.
      const fifthCandidate = state.reserveRows.find(r => r.player && !afterSelect.includes(r.player.name));
      let toastMsg = null;
      const originalToast = window.toast;
      window.toast = msg => { toastMsg = msg; };
      toggleSelectedReserve(fifthCandidate.player.name);
      const afterFifthAttempt = [...App.selectedReserves];
      window.toast = originalToast;

      // restore original selection so this test doesn't affect others
      App.selectedReserves = selectedBefore;
      saveLocal();
      renderTeam();

      return {
        selectedBeforeLen: selectedBefore.length,
        deselectWorked,
        selectWorked,
        domSelectedOn,
        maxEnforced: afterFifthAttempt.length === 4 && !afterFifthAttempt.includes(fifthCandidate.player.name),
        toastSeen: !!toastMsg
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.equal(result.selectedBeforeLen, 4, "expected the default seeding to populate exactly 4 selected reserves");
    assert.ok(result.deselectWorked, "expected toggleSelectedReserve to remove an already-selected reserve");
    assert.ok(result.selectWorked, "expected toggleSelectedReserve to add a new reserve back up to 4");
    assert.equal(result.domSelectedOn, true, "expected the selected reserve's card to re-render with the on-state checkmark");
    assert.ok(result.maxEnforced, "expected a 5th selection attempt while already at 4 to be refused");
    assert.ok(result.toastSeen, "expected a toast to explain why the 5th selection was refused");
  } finally {
    await close();
  }
});

// Real rule: non-bye substitution must draw ONLY from the user's manually
// selected reserves - never auto-pick the highest scorer in the group.
// Bye coverage is the opposite: it must draw from the WHOLE bench
// regardless of selection, since byes are scheduled and known well in
// advance rather than a weekly pick. Both are proven here with a
// deliberately-inverted score (the unselected reserve scores far higher
// than the selected one) so a coincidental match can't hide a real bug.
test("non-bye substitution respects manual reserve selection; bye coverage ignores it", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const selectedReservesBefore = [...(App.selectedReserves || [])];

      const group2RF = state.reserveRows.filter(r => r.player && reserveSlotBase(r.slotId) === "2RF").map(r => r.player.name);
      if (group2RF.length < 2) return { skip: true };
      const [selectedName, unselectedHighScorer] = group2RF;
      const targetSlot = state.fieldSlots.find(f => f.slot.short === "2RF");
      if (!targetSlot) return { skip: true };
      const outName = targetSlot.name;

      const originalRoundProj = window.roundProj;
      const originalAvailability = window.availabilityStatus;
      const patchedRoundProj = function (p) {
        if (p && p.name === selectedName) return { ...originalRoundProj(p), expected: 40 };
        if (p && p.name === unselectedHighScorer) return { ...originalRoundProj(p), expected: 999 };
        if (p && p.name === outName) return { ...originalRoundProj(p), expected: 0 };
        return originalRoundProj(p);
      };
      window.roundProj = patchedRoundProj;
      App.selectedReserves = [selectedName];

      // Non-bye case: starter is OUT (risk), not on bye.
      window.availabilityStatus = function (p, round) {
        if (p && p.name === outName) return { ...originalAvailability(p, round), key: "risk", available: false, label: "OUT" };
        return originalAvailability(p, round);
      };
      const nonByeSubs = autoEmergencySubstitutes(state);
      const nonByeSub = nonByeSubs[targetSlot.slot.id] ? nonByeSubs[targetSlot.slot.id].name : null;

      // Bye case: same starter, but on bye instead.
      window.availabilityStatus = function (p, round) {
        if (p && p.name === outName) return { ...originalAvailability(p, round), key: "bye", available: false, label: "BYE" };
        return originalAvailability(p, round);
      };
      const byeSubs = autoEmergencySubstitutes(state);
      const byeSub = byeSubs[targetSlot.slot.id] ? byeSubs[targetSlot.slot.id].name : null;

      window.roundProj = originalRoundProj;
      window.availabilityStatus = originalAvailability;
      App.selectedReserves = selectedReservesBefore;

      return { skip: false, selectedName, unselectedHighScorer, nonByeSub, byeSub };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    if (result.skip) return;

    assert.equal(
      result.nonByeSub,
      result.selectedName,
      `expected the non-bye gap to be covered by the manually selected reserve (${result.selectedName}), not the higher-scoring unselected one (${result.unselectedHighScorer}); got ${result.nonByeSub}`
    );
    assert.equal(
      result.byeSub,
      result.unselectedHighScorer,
      `expected bye coverage to draw from the whole bench regardless of selection, picking the real higher scorer (${result.unselectedHighScorer}); got ${result.byeSub}`
    );
  } finally {
    await close();
  }
});
