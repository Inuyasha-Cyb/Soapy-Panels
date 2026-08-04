(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.ui = root.SoapyPanels.ui || {};
  root.SoapyPanels.ui.dockController = api;
})(typeof self !== "undefined" ? self : this, function () {
  function createDockController(options) {
    options = options || {};
    var layouts = options.layouts || {}, root = options.root, activeLayout = "classic", state = {};
    function applyLayout(next) {
      activeLayout = next === "modern" ? "modern" : "classic";
      if (root) root.setAttribute("data-dock-layout", activeLayout);
      if (layouts.classic && layouts.classic.setVisible) layouts.classic.setVisible(activeLayout === "classic");
      if (layouts.modern && layouts.modern.setVisible) layouts.modern.setVisible(activeLayout === "modern");
      update(state); if (typeof options.onLayoutChanged === "function") options.onLayoutChanged(activeLayout);
    }
    function update(nextState) {
      state = nextState || {};
      if (layouts.classic && layouts.classic.update) layouts.classic.update(state);
      if (layouts.modern && layouts.modern.update) layouts.modern.update(state);
    }
    function setModernActive(id, metadata) { if (typeof options.onModernSelect === "function") options.onModernSelect(id, metadata || {}); }
    var modernSelectHandler = typeof options.onModernSelect === "function" ? setModernActive
      : layouts.modern && typeof layouts.modern.onSelect === "function" ? layouts.modern.onSelect : setModernActive;
    if (layouts.modern) { layouts.modern.onSelect = modernSelectHandler; if (layouts.modern.mount) layouts.modern.mount(); }
    if (layouts.classic && layouts.classic.mount) layouts.classic.mount();
    return { getLayout: function () { return activeLayout; }, setLayout: applyLayout, update: update, setModernActive: setModernActive,
      destroy: function () { if (layouts.classic && layouts.classic.destroy) layouts.classic.destroy(); if (layouts.modern && layouts.modern.destroy) layouts.modern.destroy(); } };
  }
  return { createDockController: createDockController };
});
