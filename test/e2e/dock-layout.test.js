const test = require("node:test");
const assert = require("node:assert/strict");
const {
  closeTestApp,
  dismissStartupOverlays,
  launchTestApp,
} = require("../support/electron-app");

async function openDockLayoutChooser(page) {
  await dismissStartupOverlays(page);
  await page.click("#menu-view");
  await page.click("#mi-dock-layout-chooser");
}

async function selectModernDock(page, id) {
  await page.locator(`[data-modern-docker="${id}"]:visible`).click();
  await page.waitForFunction((dockId) => {
    const tab = document.querySelector(`[data-modern-docker="${dockId}"]`);
    const panel = document.getElementById(`${dockId}Panel`);
    return tab?.getAttribute("aria-selected") === "true" && panel?.classList.contains("active");
  }, id);
}

test("dock layout defaults to Modern, preserves Two-Row selections, and persists", { timeout: 90000 }, async () => {
  const session = await launchTestApp({ profileKey: "dock-layout-choice" });
  try {
    const { page } = session;
    await page.waitForSelector("#addBubbleToggle");
    await dismissStartupOverlays(page);
    await page.click("#addBubbleToggle");
    await page.click('.add-bubble-option[data-bubble-type="speech"]');
    await page.waitForSelector('#dockerTabs:not([hidden])');
    assert.equal(await page.evaluate(() => localStorage.getItem("sp.dockLayout")), null);
    assert.equal(await page.locator("#dockerTabs").getAttribute("data-dock-layout"), "modern");
    assert.equal(await page.locator(".modern-dock-layout").isVisible(), true);
    assert.equal(await page.locator(".docker-tabs-primary").isVisible(), false);
    assert.equal(await page.locator(".docker-tabs-secondary").isVisible(), false);
    assert.ok(await page.locator(".modern-dock-tab-list [data-modern-docker]:visible").count() > 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("sp.dockLayout")), null);
    assert.equal(await page.evaluate(() => localStorage.getItem("sp.modernDockStyle")), null);
    assert.equal(await page.locator("#dockerTabs").getAttribute("data-modern-dock-style"), "elevated-studio");
    assert.equal(await page.locator(".modern-dock-layout").getAttribute("data-modern-dock-style"), "elevated-studio");
    const appearanceWidthBefore = await page.locator('[data-modern-docker="appearance"]:visible').evaluate((tab) => tab.getBoundingClientRect().width);
    const tabTransition = await page.locator('[data-modern-docker="appearance"]:visible').evaluate((tab) => getComputedStyle(tab).transitionProperty);
    assert.match(tabTransition, /flex-grow/);
    await selectModernDock(page, "appearance");
    await page.waitForFunction((before) => document.querySelector('[data-modern-docker="appearance"]').getBoundingClientRect().width > before, appearanceWidthBefore);
    const appearanceWidthAfter = await page.locator('[data-modern-docker="appearance"]:visible').evaluate((tab) => tab.getBoundingClientRect().width);
    assert.ok(appearanceWidthAfter > appearanceWidthBefore);
    assert.equal(await page.locator("#textPanel").evaluate((panel) => panel.classList.contains("active")), false);
    assert.equal(await page.locator("#dockerTabs").getAttribute("data-modern-dock-panel-style"), null);
    await selectModernDock(page, "transform");
    assert.equal(await page.locator("#appearancePanel").evaluate((panel) => panel.classList.contains("active")), false);
    await page.locator("[data-modern-dock-viewport]").focus();
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector('[data-modern-docker="tail"]')?.getAttribute("aria-selected") === "true");
    assert.equal(await page.locator("#tailPanel").evaluate((panel) => panel.classList.contains("active")), true);

    await page.setViewportSize({ width: 560, height: 760 });
    await page.locator(".modern-dock-nav-next").click();
    await page.waitForFunction(() => document.querySelector("[data-modern-dock-viewport]")?.scrollLeft > 0);
    const scrollBeforeText = await page.locator("[data-modern-dock-viewport]").evaluate((viewport) => viewport.scrollLeft);
    await selectModernDock(page, "text");
    const scrollAfterText = await page.locator("[data-modern-dock-viewport]").evaluate((viewport) => viewport.scrollLeft);
    assert.ok(scrollAfterText <= scrollBeforeText);
    await page.locator("[data-modern-dock-viewport]").focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector('[data-modern-docker="text"]')?.getAttribute("aria-selected") === "true");
    await page.waitForFunction(() => document.querySelector("[data-modern-dock-viewport]").scrollLeft === 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedMotionDuration = await page.locator('[data-modern-docker="text"]:visible').evaluate((tab) => getComputedStyle(tab).transitionDuration);
    assert.equal(reducedMotionDuration, "0s");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1400, height: 900 });

    await openDockLayoutChooser(page);
    assert.equal(await page.locator("[data-modern-dock-style-option]").count(), 0);
    assert.equal(await page.locator("[data-modern-dock-panel-style-option]").count(), 0);
    assert.match(await page.locator('[data-dock-layout-option="classic"]').textContent(), /Two-Row Dock Layout/);
    await page.keyboard.press("Escape");
    await page.click("#menu-view");
    await page.click("#mi-dock-layout-chooser");
    await page.locator('[data-dock-layout-option="classic"]').click();
    await page.waitForFunction(() => document.querySelector("#dockerTabs")?.getAttribute("data-dock-layout") === "classic");
    assert.equal(await page.locator(".docker-tabs-primary").isVisible(), true);
    assert.equal(await page.locator(".modern-dock-layout").isVisible(), false);
    await openDockLayoutChooser(page);
    assert.equal(await page.locator("[data-modern-dock-panel-style-option]").count(), 0);
    await page.keyboard.press("Escape");
    // Reload tests preferences, so save the document first instead of invoking
    // Chromium's beforeunload prompt for the bubble created above.
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => ({
        name: 'dock.soapy', queryPermission: async () => 'granted',
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      });
      document.querySelector('#mi-save').click();
    });
    await page.waitForFunction(() => !document.querySelector('#mi-save').disabled && !window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#addBubbleToggle");
    await dismissStartupOverlays(page);
    assert.equal(await page.evaluate(() => localStorage.getItem("sp.dockLayout")), "classic");
    assert.equal(await page.locator("#dockerTabs").getAttribute("data-dock-layout"), "classic");
    await page.evaluate(() => localStorage.setItem("sp.dockLayout", "invalid"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#addBubbleToggle");
    await dismissStartupOverlays(page);
    assert.equal(await page.locator("#dockerTabs").getAttribute("data-dock-layout"), "modern");
    assert.equal(await page.locator(".modern-dock-layout").getAttribute("data-modern-dock-style"), "elevated-studio");
  } finally {
    await closeTestApp(session);
  }
});
