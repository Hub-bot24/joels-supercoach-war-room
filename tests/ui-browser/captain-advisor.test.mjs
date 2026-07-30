import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Captain/vice picks live as compact star/VC badges directly on field
// cards, not a full-width panel, so the My Team page stays about showing
// the team. Real rule, confirmed directly by the user: captain is always
// the real highest-projected on-field player, vice is the best-scoring
// player among those whose game kicks off before the captain's (so the
// captain genuinely plays after the vice) - falling back to the real
// 2nd-highest scorer with a "no loophole cover" note if no one qualifies
// on timing. A guaranteed-bye loophole (nominating a confirmed-bye player
// as captain so the vice's score doubles instead) is a real, valid trade
// a user can make themselves, but the advisor must never auto-substitute
// it as the default recommendation - both captain and vice must always be
// the real on-field starters, never a bench player.
test("Captain/vice badges are the real highest scorer and the best timing-loophole vice, on-field only", async () => {
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

      // C/VC now renders as an inline badge inside the name element itself
      // (to the left of the name text, not stamped on the photo), so pull
      // the name out with the badge's own text stripped rather than
      // reading the whole element's textContent.
      const nameWithoutBadge = nameEl => {
        if (!nameEl) return "";
        const clone = nameEl.cloneNode(true);
        clone.querySelector(".formation-cv-badge")?.remove();
        return clone.textContent || "";
      };
      const captainBadgeCard = [...document.querySelectorAll(".formation-card, .formation-reserve-card")].find(c => c.querySelector(".formation-cv-captain"));
      const viceBadgeCard = [...document.querySelectorAll(".formation-card, .formation-reserve-card")].find(c => c.querySelector(".formation-cv-vice"));
      const captainBadgeName = nameWithoutBadge(captainBadgeCard?.querySelector(".formation-name, .formation-reserve-name"));
      const viceBadgeName = nameWithoutBadge(viceBadgeCard?.querySelector(".formation-name, .formation-reserve-name"));
      const captainBadgeOnField = captainBadgeCard ? captainBadgeCard.classList.contains("formation-card") : null;
      const viceBadgeOnField = viceBadgeCard ? viceBadgeCard.classList.contains("formation-card") : null;
      const captainCount = document.querySelectorAll(".formation-cv-captain").length;
      const viceCount = document.querySelectorAll(".formation-cv-vice").length;
      const noLoopholeBadgeCount = document.querySelectorAll(".formation-cv-nolh").length;
      const panelGone = document.querySelector(".captain-advisor") === null;

      return {
        fieldNames: [...fieldNames], fieldProjections, picks, captainKickoff, viceKickoff,
        captainBadgeName, viceBadgeName, captainBadgeOnField, viceBadgeOnField, captainCount, viceCount, noLoopholeBadgeCount, panelGone
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(result.fieldProjections.length > 0, "expected a real starting field to be set");
    assert.ok(result.panelGone, "expected the old full-width Captain Advisor panel to be gone - captain/vice picks now live as compact field badges");
    assert.equal(result.captainCount, 1, "expected exactly one captain (star) badge");
    assert.equal(result.viceCount, 1, "expected exactly one vice-captain badge");
    assert.equal(result.captainBadgeOnField, true, "captain badge must render on a field card (.formation-card), never a bench card");
    assert.equal(result.viceBadgeOnField, true, "vice badge must render on a field card (.formation-card), never a bench card");
    assert.equal(result.picks.captain?.isDeadCert, false, "the guaranteed bye-loophole must never auto-fire as the default recommendation");

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
  } finally {
    await close();
  }
});

// Synthetic-but-real: forces a bench player onto BYE and fields them in
// place of the real captain, then confirms the advisor still recommends
// the real highest-projected on-field player as captain (never the bye
// player) - proving the guaranteed-loophole auto-override is genuinely
// gone, not just untested.
test("captain recommendation never auto-switches to a fielded bye player", async () => {
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

      // Field them in place of the real captain (highest-projected starter).
      const byExpected = [...state.fieldSlots].sort((a, b) => roundProj(b.player).expected - roundProj(a.player).expected);
      const realCaptainSlotIndex = state.fieldSlots.findIndex(f => f.name === byExpected[0].name);
      const fieldStateWithByeFielded = {
        ...state,
        fieldSlots: state.fieldSlots.map((f, i) => i === realCaptainSlotIndex ? { ...f, name: benchByeName, player: reserveWithPlayer.player } : f)
      };
      const picks = captainVicePicks(fieldStateWithByeFielded);
      const captainIsByePlayer = picks.captain?.name === benchByeName;

      window.availabilityStatus = originalAvailability;

      return { skip: false, benchByeName, captainIsByePlayer, captainName: picks.captain?.name };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    if (result.skip) return;

    assert.equal(result.captainIsByePlayer, false, `${result.benchByeName} is fielded and on BYE, but the advisor picked them (${result.captainName}) as captain instead of the real highest-projected starter - the guaranteed-loophole auto-override should be gone`);
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
          // elementFromPoint only ever hits within the current viewport - a
          // badge sitting below the fold (e.g. once page content above the
          // field grows, like the War Room Briefing card) would otherwise
          // read back as a false "hits nothing" rather than a real overlap.
          // Scrolling it into view first is exactly what a real user would
          // do before clicking it, so this keeps testing the actual bug
          // (wrong-card hit) without depending on total page height.
          badge.scrollIntoView({ block: "center" });
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
