import assert from "node:assert/strict";
import test from "node:test";

import { openApp, switchTab } from "./helpers.mjs";

test("all 5 tabs render real content with no JS exceptions", async () => {
  const { page, pageErrors, close } = await openApp();

  try {
    // My Team: real player field with projected scores rendered
    await assert.doesNotReject(
      page.locator(".field-wrap, .mobile-team-layout").first().waitFor({ state: "visible", timeout: 5000 })
    );
    const reserveCount = await page.locator(".formation-reserve-card").count();
    assert.ok(reserveCount > 0, "expected at least one rendered reserve card");

    await switchTab(page, "bye");
    await assert.doesNotReject(
      page.locator("#bye").getByText("Bye Planner", { exact: false }).first().waitFor({ timeout: 5000 })
    );

    await switchTab(page, "level3");
    const level3Rows = await page.locator("#level3 table tbody tr, #level3 tr").count();
    assert.ok(level3Rows > 0, "expected Level 3 table to render rows");

    await switchTab(page, "explorer");
    await assert.doesNotReject(
      page.locator("#explorer").getByText("Player Explorer", { exact: false }).first().waitFor({ timeout: 5000 })
    );
    const explorerFilterText = await page.locator("#explorer").innerText();
    assert.match(explorerFilterText, /All\s+\d+/);

    await switchTab(page, "trade");
    await assert.doesNotReject(
      page.locator("#trade").getByText("Trade Lab", { exact: false }).first().waitFor({ timeout: 5000 })
    );
    await assert.doesNotReject(page.locator("#tradeOut").waitFor({ timeout: 5000 }));

    await switchTab(page, "team");

    assert.deepEqual(pageErrors, [], `expected zero uncaught JS exceptions, got: ${pageErrors.join(" | ")}`);
  } finally {
    await close();
  }
});
