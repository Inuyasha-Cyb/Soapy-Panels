(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.ui = root.SoapyPanels.ui || {};
  root.SoapyPanels.ui.dockLayouts = api;
})(typeof self !== "undefined" ? self : this, function () {
  var globalRoot = typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : {};
  var LAYOUTS = [
    { id: "classic", labelKey: "dockLayouts.twoRow", descriptionKey: "dockLayouts.twoRowDescription" },
    { id: "modern", labelKey: "dockLayouts.modern", descriptionKey: "dockLayouts.modernDescription" },
  ];
  var MODERN_DOCK_STYLES = [
    { id: "elevated-studio", labelKey: "dockStyles.elevatedStudio", descriptionKey: "dockStyles.elevatedStudioDescription" },
  ];
  var MODERN_DOCK_STYLE_ALIASES = {
    segmented: "elevated-studio", "soft-cards": "elevated-studio",
    "minimal-underline": "elevated-studio", "compact-pro": "elevated-studio",
  };

  function getDockLayouts() { return LAYOUTS.slice(); }
  function normalizeDockLayout(value) { return value === "classic" || value === "modern" ? value : "modern"; }
  function getModernDockStyles() { return MODERN_DOCK_STYLES.slice(); }
  function normalizeModernDockStyle(value) {
    var normalized = MODERN_DOCK_STYLE_ALIASES[value] || value;
    return MODERN_DOCK_STYLES.some(function (style) { return style.id === normalized; }) ? normalized : "elevated-studio";
  }
  function calculateDockTabScrollTarget(options) {
    options = options || {};
    var current = Math.max(0, Number(options.currentScrollLeft) || 0);
    var viewportWidth = Math.max(0, Number(options.viewportWidth) || 0);
    var scrollWidth = Math.max(viewportWidth, Number(options.scrollWidth) || 0);
    var max = Math.max(0, scrollWidth - viewportWidth);
    if (options.isFirstTab) return 0;
    var activeLeft = Number(options.activeLeft) || 0;
    var activeRight = Number(options.activeRight) || activeLeft;
    var target = current;
    if (activeLeft < current) target = activeLeft;
    else if (activeRight > current + viewportWidth) target = activeRight - viewportWidth;
    return Math.min(max, Math.max(0, target));
  }
  function getLabel(tab) {
    var label = tab && tab.querySelector ? tab.querySelector(".docker-label") : null;
    return label ? label.textContent.trim() : String(tab && tab.dataset ? tab.dataset.docker : "");
  }

  function ClassicDockLayout(options) { this.root = options && options.root; }
  ClassicDockLayout.prototype.mount = function () {};
  ClassicDockLayout.prototype.update = function () {};
  ClassicDockLayout.prototype.setVisible = function (visible) {
    if (this.root) this.root.setAttribute("data-dock-layout-visible", visible ? "true" : "false");
  };
  ClassicDockLayout.prototype.destroy = function () {};

  function ModernDockLayout(options) {
    options = options || {};
    this.root = options.root;
    this.tabs = Array.isArray(options.tabs) ? options.tabs.slice() : [];
    this.onSelect = typeof options.onSelect === "function" ? options.onSelect : function () {};
    this.style = normalizeModernDockStyle(options.style);
    this.host = null; this.viewport = null; this.tablist = null;
    this.previous = null; this.next = null; this.buttons = Object.create(null);
    this.visibleIds = []; this.activeId = null; this.scrollLeft = 0; this.resizeObserver = null;
  }

  ModernDockLayout.prototype.mount = function () {
    if (!this.root || this.host) return;
    var doc = this.root.ownerDocument || document;
    var host = doc.createElement("div");
    host.className = "modern-dock-layout"; host.hidden = true;
    host.setAttribute("data-modern-dock-layout", "true");
    host.setAttribute("data-modern-dock-style", this.style);
    if (this.root) this.root.setAttribute("data-modern-dock-style", this.style);
    var previous = doc.createElement("button"); previous.type = "button";
    previous.className = "modern-dock-nav modern-dock-nav-previous";
    previous.setAttribute("data-i18n-aria-label", "dockLayouts.previous");
    previous.setAttribute("aria-label", "Scroll tabs left"); previous.textContent = "‹";
    var viewport = doc.createElement("div"); viewport.className = "modern-dock-tab-viewport";
    viewport.setAttribute("data-modern-dock-viewport", "true"); viewport.tabIndex = 0;
    var tablist = doc.createElement("div"); tablist.className = "modern-dock-tab-list";
    tablist.setAttribute("role", "tablist"); tablist.setAttribute("data-i18n-aria-label", "dockLayouts.tabsAria");
    tablist.setAttribute("aria-label", "Dock tabs"); viewport.appendChild(tablist);
    var next = doc.createElement("button"); next.type = "button";
    next.className = "modern-dock-nav modern-dock-nav-next";
    next.setAttribute("data-i18n-aria-label", "dockLayouts.next");
    next.setAttribute("aria-label", "Scroll tabs right"); next.textContent = "›";
    host.appendChild(previous); host.appendChild(viewport); host.appendChild(next); this.root.appendChild(host);
    this.host = host; this.viewport = viewport; this.tablist = tablist; this.previous = previous; this.next = next;
    var self = this;
    previous.addEventListener("click", function () { self.scrollBy(-1); });
    next.addEventListener("click", function () { self.scrollBy(1); });
    viewport.addEventListener("scroll", function () {
      self.scrollLeft = viewport.scrollLeft; self.updateNavigation();
    }, { passive: true });
    viewport.addEventListener("keydown", function (event) {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) === -1) return;
      var ids = self.visibleIds, current = Math.max(0, ids.indexOf(self.activeId)), nextIndex = current;
      if (event.key === "ArrowLeft") nextIndex = Math.max(0, current - 1);
      if (event.key === "ArrowRight") nextIndex = Math.min(ids.length - 1, current + 1);
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = Math.max(0, ids.length - 1);
      if (ids[nextIndex]) { event.preventDefault(); self.onSelect(ids[nextIndex], { focus: true }); }
    });
    tablist.addEventListener("transitionend", function (event) {
      if (!event.target || !event.target.classList || !event.target.classList.contains("docker-tab")) return;
      if (["flex-grow", "padding-left", "padding-right"].indexOf(event.propertyName) === -1) return;
      self.ensureActiveVisible(); self.updateNavigation();
    });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(function () { self.updateNavigation(); });
      this.resizeObserver.observe(viewport);
      this.resizeObserver.observe(tablist);
    }
    this.tabs.forEach(function (source) {
      var id = source.getAttribute("data-docker"); if (!id) return;
      var button = source.cloneNode(true); button.removeAttribute("id"); button.removeAttribute("data-row");
      button.setAttribute("data-modern-docker", id);
      button.setAttribute("aria-label", source.getAttribute("aria-label") || getLabel(source));
      button.setAttribute("tabindex", "-1"); button.classList.remove("active");
      button.setAttribute("aria-selected", "false"); button.hidden = true;
      button.addEventListener("click", function () { self.onSelect(id, { focus: false }); });
      tablist.appendChild(button); self.buttons[id] = button;
    });
    if (globalRoot.SoapyPanels && globalRoot.SoapyPanels.i18n && globalRoot.SoapyPanels.i18n.translateDom) globalRoot.SoapyPanels.i18n.translateDom(host);
    this.updateNavigation();
  };

  ModernDockLayout.prototype.scrollBy = function (direction) {
    if (!this.viewport) return;
    var amount = Math.max(80, this.viewport.clientWidth * 0.72) * direction;
    var reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.viewport.scrollTo({ left: this.viewport.scrollLeft + amount, behavior: reduced ? "auto" : "smooth" });
  };
  ModernDockLayout.prototype.setStyle = function (style) {
    this.style = normalizeModernDockStyle(style);
    if (this.host) this.host.setAttribute("data-modern-dock-style", this.style);
    if (this.root) this.root.setAttribute("data-modern-dock-style", this.style);
  };
  ModernDockLayout.prototype.updateNavigation = function () {
    if (!this.viewport || !this.previous || !this.next) return;
    var max = Math.max(0, this.viewport.scrollWidth - this.viewport.clientWidth);
    this.previous.disabled = this.viewport.scrollLeft <= 1; this.next.disabled = this.viewport.scrollLeft >= max - 1;
    this.previous.setAttribute("aria-disabled", this.previous.disabled ? "true" : "false");
    this.next.setAttribute("aria-disabled", this.next.disabled ? "true" : "false");
  };
  ModernDockLayout.prototype.ensureActiveVisible = function () {
    if (!this.viewport || !this.activeId || !this.buttons[this.activeId]) return;
    var active = this.buttons[this.activeId], viewportRect = this.viewport.getBoundingClientRect(), activeRect = active.getBoundingClientRect();
    var activeLeft = this.viewport.scrollLeft + activeRect.left - viewportRect.left;
    var activeRight = this.viewport.scrollLeft + activeRect.right - viewportRect.left;
    var target = calculateDockTabScrollTarget({
      currentScrollLeft: this.viewport.scrollLeft,
      viewportWidth: this.viewport.clientWidth,
      scrollWidth: this.viewport.scrollWidth,
      activeLeft: activeLeft,
      activeRight: activeRight,
      isFirstTab: this.visibleIds[0] === this.activeId,
    });
    if (target !== this.viewport.scrollLeft) { this.viewport.scrollLeft = target; this.scrollLeft = target; }
  };
  ModernDockLayout.prototype.update = function (state) {
    state = state || {}; if (!this.host) this.mount();
    var visible = Array.isArray(state.visibleTabIds) ? state.visibleTabIds : [], visibleSet = Object.create(null);
    visible.forEach(function (id) { visibleSet[id] = true; }); this.visibleIds = visible.slice();
    this.activeId = state.activeTabId && visibleSet[state.activeTabId] ? state.activeTabId : (visible[0] || null);
    var self = this;
    Object.keys(this.buttons).forEach(function (id) {
      var button = self.buttons[id], isVisible = !!visibleSet[id], isActive = isVisible && id === self.activeId;
      button.hidden = !isVisible; button.setAttribute("aria-hidden", isVisible ? "false" : "true");
      button.classList.toggle("active", isActive); button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    if (state.ensureActiveVisible && this.activeId && this.buttons[this.activeId]) {
      this.ensureActiveVisible();
    } else if (this.viewport) this.viewport.scrollLeft = this.scrollLeft;
    this.updateNavigation();
  };
  ModernDockLayout.prototype.setVisible = function (visible) { if (!this.host) this.mount(); if (this.host) this.host.hidden = !visible; };
  ModernDockLayout.prototype.destroy = function () { if (this.resizeObserver) this.resizeObserver.disconnect(); if (this.host) this.host.remove(); this.host = null; };

  return { getDockLayouts: getDockLayouts, normalizeDockLayout: normalizeDockLayout, getModernDockStyles: getModernDockStyles, normalizeModernDockStyle: normalizeModernDockStyle, calculateDockTabScrollTarget: calculateDockTabScrollTarget, ClassicDockLayout: ClassicDockLayout, ModernDockLayout: ModernDockLayout };
});
