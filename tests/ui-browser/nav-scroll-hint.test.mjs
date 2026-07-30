import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

// Real UX finding: on a real phone width, nav overflows horizontally
// (Trade Lab, Season, Refresh, notifications end up off-screen) and
// scrolls, but nothing ever hinted it was scrollable - a user has no
// reason to think to swipe a top nav bar. updateNavScrollHint() shows a
// real chevron only while there's genuinely more to reveal, and hides it
// once scrolled to the true end or when nav isn't overflowing at all.

test("nav scroll hint shows on a narrow viewport where nav overflows, and hides once scrolled to the true end", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);

    const before = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      return {
        overflows: nav.scrollWidth > nav.clientWidth + 2,
        hintShown: document.getElementById("navScrollHint")?.classList.contains("show")
      };
    });

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
    assert.ok(before.overflows, "expected nav to genuinely overflow at this real phone width");
    assert.equal(before.hintShown, true, "expected the scroll hint to show when there's real hidden content");

    await page.evaluate(() => document.querySelector("nav").scrollBy(5000, 0));
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => document.getElementById("navScrollHint")?.classList.contains("show"));
    assert.equal(after, false, "expected the scroll hint to hide once scrolled to the real end of the nav");
  } finally {
    await close();
  }
});

test("nav scroll hint stays hidden on a wide viewport where nav does not overflow", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => updateNavScrollHint());

    const result = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      return {
        overflows: nav.scrollWidth > nav.clientWidth + 2,
        hintShown: document.getElementById("navScrollHint")?.classList.contains("show")
      };
    });

    assert.deepEqual(pageErrors, []);
    assert.ok(!result.overflows, "expected nav to genuinely fit at this real wide desktop width");
    assert.equal(result.hintShown, false, "expected no scroll hint when there's nothing hidden");
  } finally {
    await close();
  }
});
