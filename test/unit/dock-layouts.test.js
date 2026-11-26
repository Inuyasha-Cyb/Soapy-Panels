const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const layouts = require("../../app/renderer/src/ui/dock-layouts");

test("dock layout registry keeps Modern as the default and preserves the Two-Row layout", () => {
  assert.deepEqual(layouts.getDockLayouts().map((layout) => layout.id), ["classic", "modern"]);
  assert.equal(layouts.getDockLayouts()[0].labelKey, "dockLayouts.twoRow");
  assert.equal(layouts.getDockLayouts()[0].descriptionKey, "dockLayouts.twoRowDescription");
  assert.equal(layouts.normalizeDockLayout(undefined), "modern");
  assert.equal(layouts.normalizeDockLayout("classic"), "classic");
  assert.equal(layouts.normalizeDockLayout("modern"), "modern");
  assert.equal(layouts.normalizeDockLayout("unknown"), "modern");
});

test("Modern dock keeps Elevated Studio as the only tab style", () => {
  const styles = layouts.getModernDockStyles();
  assert.deepEqual(styles.map((style) => style.id), ["elevated-studio"]);
  assert.equal(styles[0].labelKey, "dockStyles.elevatedStudio");
  assert.equal(layouts.normalizeModernDockStyle(undefined), "elevated-studio");
  assert.equal(layouts.normalizeModernDockStyle("invalid"), "elevated-studio");
  assert.equal(layouts.normalizeModernDockStyle("segmented"), "elevated-studio");
  assert.equal(layouts.normalizeModernDockStyle("soft-cards"), "elevated-studio");
});

test("Modern dock clamps active-tab scroll targets", () => {
  assert.equal(layouts.calculateDockTabScrollTarget({
    currentScrollLeft: 180,
    viewportWidth: 240,
    scrollWidth: 900,
    activeLeft: 180,
    activeRight: 230,
    isFirstTab: true,
  }), 0);
  assert.equal(layouts.calculateDockTabScrollTarget({
    currentScrollLeft: 120,
    viewportWidth: 240,
    scrollWidth: 900,
    activeLeft: 150,
    activeRight: 190,
  }), 120);
  assert.equal(layouts.calculateDockTabScrollTarget({
    currentScrollLeft: 180,
    viewportWidth: 240,
    scrollWidth: 900,
    activeLeft: 90,
    activeRight: 140,
  }), 90);
  assert.equal(layouts.calculateDockTabScrollTarget({
    currentScrollLeft: 120,
    viewportWidth: 240,
    scrollWidth: 900,
    activeLeft: 350,
    activeRight: 410,
  }), 170);
  assert.equal(layouts.calculateDockTabScrollTarget({
    currentScrollLeft: 0,
    viewportWidth: 300,
    scrollWidth: 240,
    activeLeft: 0,
    activeRight: 50,
  }), 0);
  assert.equal(layouts.calculateDockTabScrollTarget({
    currentScrollLeft: 0,
    viewportWidth: 240,
    scrollWidth: 900,
    activeLeft: 880,
    activeRight: 940,
  }), 660);
});

test("modern layout implementation exposes the same lifecycle interface as Classic", () => {
  for (const Constructor of [layouts.ClassicDockLayout, layouts.ModernDockLayout]) {
    const instance = new Constructor({ root: null, tabs: [] });
    for (const method of ["mount", "update", "setVisible", "destroy"]) {
      assert.equal(typeof instance[method], "function", `${Constructor.name}.${method}`);
    }
    if (Constructor === layouts.ModernDockLayout) assert.equal(typeof instance.setStyle, "function");
  }
});

test("Modern tab style changes preserve interaction state", () => {
  const attributes = {};
  const root = { setAttribute(name, value) { attributes[name] = value; } };
  const instance = new layouts.ModernDockLayout({ root, style: "segmented" });
  instance.activeId = "appearance";
  instance.scrollLeft = 240;
  instance.setStyle("segmented");
  assert.equal(attributes["data-modern-dock-style"], "elevated-studio");
  assert.equal(instance.activeId, "appearance");
  assert.equal(instance.scrollLeft, 240);
});

test("renderer shell loads the dock layout modules before boot", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../app/renderer/index.html"), "utf8");
  assert.match(html, /id="dockerTabs" class="docker-group"/);
  assert.match(html, /id="mi-dock-layout-chooser"/);
  assert.ok(html.indexOf('src="src/ui/dock-layouts.js"') < html.indexOf('src="src/boot.js"'));
  assert.ok(html.indexOf('src="src/ui/dock-controller.js"') < html.indexOf('src="src/boot.js"'));
});

test("Modern tab styling remains scoped to the Modern host without interior overrides", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../app/renderer/styles/main.css"), "utf8");
  const refresh = css.slice(css.indexOf("/* Modern dock visual variation gallery."));
  assert.match(refresh, /#dockerTabs\[data-dock-layout="modern"\]/);
  assert.match(refresh, /--modern-dock-accent:/);
  assert.match(refresh, /--modern-dock-surface:/);
  assert.match(refresh, /data-modern-dock-style="elevated-studio"/);
  assert.match(refresh, /modern-dock-tab-list \.docker-tab\.active[\s\S]*flex-grow:\s*1\.35/);
  assert.match(refresh, /prefers-reduced-motion:\s*reduce[\s\S]*modern-dock-tab-list[\s\S]*transition:\s*none/);
  assert.doesNotMatch(refresh, /#d94674/i);
  assert.doesNotMatch(refresh, /\.docker-tabs-primary|\.docker-tabs-secondary/);
  assert.doesNotMatch(refresh, /data-modern-dock-style="(?:soft-cards|minimal-underline|compact-pro)"/);
  assert.doesNotMatch(refresh, /data-modern-dock-panel-style|modern-dock-panel-style|\.docker-panel/);
});
