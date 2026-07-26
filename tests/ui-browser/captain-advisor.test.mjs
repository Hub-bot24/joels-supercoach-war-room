import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Captain/vice picks live as compact star/VC badges directly on field
// cards, not a full-width panel, so the My Team page stays about showing
// the team. Two real SuperCoach rules drive the logic, confirmed by the
// user against their own real team: (1) if the named Captain does not
// take the field, the Vice-Captain's score is automatically doubled
// instead - the zero-risk "guaranteed loophole" is nominating a
// confirmed-BYE player as Captain and your best real player as Vice;
// (2) Captain AND Vice-Captain must BOTH come from the 14 on-field
// starters - never a bench/reserve player, even one of the 4 that are
// selected to count toward score. A bye player is only eligible for the
// loophole if they've been deliberately fielded in one of the 14 slots.
test("Captain/vice badges follow the real on-field-only rule with bye-loophole preferred when available", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const fieldNames = new Set(state.fieldSlots.map(f => f.name));
      const fieldProjections = state.fieldSlots.map(({ name, player }) => ({
        name,
        expected: roundProj(player).expected
      })).sort((a, b) => b.expected - a.expected);

      const picks = captainVicePicks(state);
      const captainKickoff = picks.captain ? playerKickoffTime(getPlayer(picks.captain.name)) : null;
      const viceKickoff = picks.vice ? playerKickoffTime(getPlayer(picks.vice.name)) : null;

      const captainBadgeCard = [...document.querySelectorAll(".formation-card, .formation-reserve-card")].find(c => c.querySelector(".formation-cv-captain"));
      const viceBadgeCard = [...document.querySelectorAll(".formation-card, .formation-reserve-card")].find(c => c.querySelector(".formation-cv-vice"));
      const captainBadgeName = captainBadgeCard?.querySelector(".formation-name, .formation-reserve-name")?.textContent || "";
      const viceBadgeName = viceBadgeCard?.querySelector(".formation-name, .formation-reserve-name")?.textContent || "";
      const captainBadgeOnField = captainBadgeCard ? captainBadgeCard.classList.contains("formation-card") : null;
      const captainCount = document.querySelectorAll(".formation-cv-captain").length;
      const viceCount = document.querySelectorAll(".formation-cv-vice").length;
      const noLoopholeBadgeCount = document.querySelectorAll(".formation-cv-nolh").length;
      const panelGone = document.querySelector(".captain-advisor") === null;

      return {
        fieldNames: [...fieldNames], fieldProjections, picks, captainKickoff, viceKickoff,
        captainBadgeName, viceBadgeName, captainBadgeOnField, captainCount, viceCount, noLoopholeBadgeCount, panelGone
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.fieldProjections.length > 0, "expected a real starting field to be set");
    assert.ok(result.panelGone, "expected the old full-width Captain Advisor panel to be gone - captain/vice picks now live as compact field badges");
    assert.equal(result.captainCount, 1, "expected exactly one captain (star) badge");
    assert.equal(result.viceCount, 1, "expected exactly one vice-captain badge");

    // Both captain and vice must always be on-field players - never a bench card.
    assert.ok(result.fieldNames.includes(result.captainBadgeName.trim()) || result.fieldNames.some(n => result.captainBadgeName.startsWith(n)), `captain (${result.captainBadgeName}) must be an on-field player`);
    assert.ok(result.fieldNames.some(n => result.viceBadgeName.startsWith(n)), `vice (${result.viceBadgeName}) must be an on-field player`);
    assert.equal(result.captainBadgeOnField, true, "captain badge must render on a field card (.formation-card), never a bench card");

    if (result.picks.captain?.isDeadCert) {
      // Guaranteed loophole path: captain must be a real, on-field, confirmed-bye player.
      assert.ok(result.fieldNames.includes(result.picks.captain.name), "guaranteed-loophole captain must be an on-field player");
    } else {
      // Timing loophole fallback: captain is the real top-projected on-field player.
      const top = result.fieldProjections[0];
      assert.ok(result.captainBadgeName.startsWith(top.name), `expected the captain badge (${result.captainBadgeName}) to mark the real highest-projected field player (${top.name}, ${top.expected} pts)`);

      if (result.picks.vice?.hasLoophole) {
        assert.ok(
          result.viceKickoff !== null && result.captainKickoff !== null && result.viceKickoff < result.captainKickoff,
          `claimed timing loophole cover but vice kickoff (${result.viceKickoff}) is not strictly before captain kickoff (${result.captainKickoff})`
        );
        assert.equal(result.noLoopholeBadgeCount, 0, "expected no dashed no-loophole styling when a real loophole was found");
      } else if (result.picks.vice) {
        assert.ok(result.noLoopholeBadgeCount >= 1, "expected the no-loophole VC to render with the dashed/no-cover badge styling");
      }
    }
  } finally {
    await close();
  }
});

// Synthetic-but-real: forces a bench player onto BYE and confirms the
// guaranteed loophole does NOT fire for them (since they're not fielded),
// then fields that same bye player in place of the real captain and
// confirms the loophole DOES fire once they're on-field - proving the
// on-field-only restriction is a real gate, not just an untested claim.
test("bye-loophole only activates for a bye player once they are actually fielded", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const result = await page.evaluate(() => {
      const state = teamRenderState();
      const reserveWithPlayer = state.reserveRows.find(r => r.player);
      if (!reserveWithPlayer) return { skip: true };
      const benchByeName = reserveWithPlayer.player.name;

      const originalAvailability = window.availabilityStatus;
      window.availabilityStatus = function (p, round) {
        if (p && p.name === benchByeName) return { ...originalAvailability(p, round), key: "bye", available: false, label: "BYE" };
        return originalAvailability(p, round);
      };

      const picksWhileOnBench = captainVicePicks(state);
      const loopholeFiredWhileOnBench = picksWhileOnBench.captain?.name === benchByeName;

      // Now field them: swap them into the first field slot in place of whoever is there.
      const targetSlot = state.fieldSlots[0];
      const fieldStateWithByeFielded = {
        ...state,
        fieldSlots: state.fieldSlots.map((f, i) => i === 0 ? { ...f, name: benchByeName, player: reserveWithPlayer.player } : f)
      };
      const picksWhileFielded = captainVicePicks(fieldStateWithByeFielded);
      const loopholeFiredWhileFielded = picksWhileFielded.captain?.name === benchByeName;

      window.availabilityStatus = originalAvailability;

      return { skip: false, benchByeName, loopholeFiredWhileOnBench, loopholeFiredWhileFielded };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    if (result.skip) return;

    assert.equal(result.loopholeFiredWhileOnBench, false, `${result.benchByeName} is on BYE but still on the bench - the loophole must not fire for them`);
    assert.equal(result.loopholeFiredWhileFielded, true, `${result.benchByeName} is on BYE and now fielded - the loophole should fire for them`);
  } finally {
    await close();
  }
});

// Real bug found via user report: the C/VC badge used to sit at a negative
// offset (poking outside its own field card), which at common laptop widths
// (<=1280px, where cards sit close together) visually overlapped onto the
// *next* card - so clicking the badge opened the wrong player's card. This
// checks the actual rendered hit-test (elementFromPoint at the badge's own
// center), not just that the badge exists, at several real widths.
test("C/VC badge never overlaps a neighboring field card at common widths", async () => {
  const widths = [1920, 1600, 1280, 1024];
  for (const width of widths) {
    const { page, pageErrors, close } = await openApp();
    try {
      await page.setViewportSize({ width, height: 1000 });
      const result = await page.evaluate(() => {
        const badgedCards = [...document.querySelectorAll(".formation-card")].filter(c => c.querySelector(".formation-cv-badge"));
        return badgedCards.map(card => {
          const nameEl = card.querySelector(".formation-name");
          const badge = card.querySelector(".formation-cv-badge");
          const r = badge.getBoundingClientRect();
          const hitEl = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const hitCard = hitEl ? hitEl.closest(".formation-card") : null;
          return {
            ownerName: nameEl?.textContent || "",
            hitName: hitCard ? (hitCard.querySelector(".formation-name")?.textContent || "") : ""
          };
        });
      });

      assert.deepEqual(pageErrors, [], `width ${width}: expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
      for (const r of result) {
        assert.equal(
          r.hitName,
          r.ownerName,
          `width ${width}: ${r.ownerName}'s C/VC badge visually lands on ${r.hitName}'s card instead of its own - clicking it would open the wrong player`
        );
      }
    } finally {
      await close();
    }
  }
});

// Second and third real bugs found via user report, once the field cards
// were redesigned into the real NRL position shape (halfback/five-eighth
// stacked vertically down the middle, FLEX moved beside the reserves
// panel): a card's own name label - which intentionally extends below its
// own card box as a nameplate - visually collided with elements of
// whichever card was stacked directly beneath or beside it. The first fix
// attempt only checked name-vs-badge, which is why it missed a second,
// still-live collision between a name label and the next card's score/
// tag. This checks real bounding-box intersection between every visible
// sub-element (name, score, position tag, C/VC badge) of every field card
// against every OTHER field card's, at several real widths, since one
// root cause (a hardcoded pixel nudge left over from the old layout) only
// showed up once the confounding "just add more gap" fix was ruled out.
test("no field card's visible elements collide with another card's, at several real widths", async () => {
  const widths = [1920, 1600, 1366, 1280, 1024];
  for (const width of widths) {
    const { page, pageErrors, close } = await openApp();
    try {
      await page.setViewportSize({ width, height: 900 });
      const result = await page.evaluate(() => {
        const rectOf = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

        const cards = [...document.querySelectorAll(".formation-card")];
        const elementsOf = c => [".formation-name", ".formation-score", ".wr-slot-tag", ".formation-cv-badge"]
          .map(sel => c.querySelector(sel))
          .filter(Boolean)
          .map(el => ({ sel: el.className, rect: rectOf(el) }));
        const perCard = cards.map(c => ({
          owner: c.querySelector(".formation-name")?.textContent || "",
          slot: c.getAttribute("data-slot"),
          els: elementsOf(c)
        }));

        const collisions = [];
        for (let i = 0; i < perCard.length; i++) {
          for (let j = 0; j < perCard.length; j++) {
            if (i === j) continue;
            for (const ea of perCard[i].els) {
              for (const eb of perCard[j].els) {
                if (intersects(ea.rect, eb.rect)) {
                  collisions.push(`${perCard[i].slot}(${perCard[i].owner}).${ea.sel} collides with ${perCard[j].slot}(${perCard[j].owner}).${eb.sel}`);
                }
              }
            }
          }
        }
        return [...new Set(collisions)];
      });

      assert.deepEqual(pageErrors, [], `width ${width}: expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
      assert.deepEqual(result, [], `width ${width}: expected no visible-element collisions between field cards, got: ${result.join(" | ")}`);
    } finally {
      await close();
    }
  }
});
