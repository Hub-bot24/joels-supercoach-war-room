export { openApp } from "../../scripts/lib/headless-app.mjs";

export async function switchTab(page, tabId) {
  await page.locator(`nav button[data-tab="${tabId}"]`).click();
  await page.waitForTimeout(400);
}
