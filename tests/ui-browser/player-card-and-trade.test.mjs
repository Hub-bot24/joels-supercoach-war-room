import assert from "node:assert/strict";
import test from "node:test";

import { openApp } from "./helpers.mjs";

test("player card opens with real stats and the trade popup lists real eligible options", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    const nameLink = page.locator(".player-name-link, [onclick*='openPlayerCard']").first();
    await nameLink.click({ force: true, timeout: 15000 });

    const overlay = page.locator("#wrPlayerCardOverlay");
    await assert.doesNotReject(overlay.waitFor({ state: "visible", timeout: 15000 }));

    const cardText = await overlay.innerText();
    assert.match(cardText, /Price/);
    assert.match(cardText, /AVG/i);
    assert.match(cardText, /Last 3/i);
    assert.match(cardText, /Last 5/i);

    const tradeButton = overlay.getByRole("button", { name: "Trade", exact: true });
    await tradeButton.click({ timeout: 15000 });

    // #teamActionPanel is a zero-size wrapper - its position:fixed popup content
    // is what's actually rendered on screen, so check a real option button instead.
    const firstOption = page.locator("[data-trade-option]").first();
    await assert.doesNotReject(firstOption.waitFor({ state: "visible", timeout: 15000 }));

    const optionButtons = await page.locator("[data-trade-option]").count();
    assert.ok(optionButtons > 0, "expected at least one real eligible trade option to render");

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
  } finally {
    await close();
  }
});
