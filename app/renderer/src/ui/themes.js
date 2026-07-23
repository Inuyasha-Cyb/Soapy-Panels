(function (root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.ui = root.SoapyPanels.ui || {};
  root.SoapyPanels.ui.themes = api;
})(typeof self !== "undefined" ? self : this, function () {
  const THEMES = [
    {
      id: "light",
      labelKey: "themes.light",
      mode: "light",
      plusOnly: false,
      className: "theme-light",
      preview: ["#eff6ff", "#f5faff", "#60a5fa", "#0f172a"],
    },
    {
      id: "dark",
      labelKey: "themes.dark",
      mode: "dark",
      plusOnly: false,
      className: "theme-dark",
      preview: ["#020617", "#111c2e", "#38bdf8", "#e2e8f0"],
    },
    {
      id: "studio",
      labelKey: "themes.studio",
      mode: "light",
      plusOnly: true,
      className: "theme-studio",
      preview: ["#eeeeec", "#fafaf9", "#525252", "#242424"],
    },
    {
      id: "graphite",
      labelKey: "themes.graphite",
      mode: "dark",
      plusOnly: true,
      className: "theme-graphite",
      preview: ["#171717", "#262626", "#737373", "#f2f2f2"],
    },
    {
      id: "dark-orange",
      labelKey: "themes.ember",
      mode: "dark",
      plusOnly: true,
      className: "theme-dark-orange",
      preview: ["#0b0c0d", "#242526", "#ffa200", "#e4e6eb"],
    },
    {
      id: "sakura",
      labelKey: "themes.sakura",
      mode: "light",
      plusOnly: true,
      className: "theme-sakura",
      preview: ["#fff7f7", "#fffafb", "#d94674", "#3f2630"],
    },
    {
      id: "forest",
      labelKey: "themes.forest",
      mode: "dark",
      plusOnly: true,
      className: "theme-forest",
      preview: ["#08130f", "#13251d", "#d6a84b", "#edf7f1"],
    },
    {
      id: "amethyst",
      labelKey: "themes.amethyst",
      mode: "dark",
      plusOnly: true,
      className: "theme-amethyst",
      preview: ["#120d21", "#24183c", "#b794f6", "#f2ecff"],
    },
  ];

  const THEME_BY_ID = Object.create(null);
  THEMES.forEach(function (theme) {
    THEME_BY_ID[theme.id] = theme;
  });

  function getThemes() {
    return THEMES.slice();
  }

  function getTheme(themeId) {
    return THEME_BY_ID[themeId] || null;
  }

  function normalizeThemeId(themeId, systemTheme) {
    const value = themeId === "system" ? systemTheme : themeId;
    return getTheme(value) ? value : null;
  }

  function canUseTheme(themeId, hasPremiumThemes) {
    const theme = getTheme(themeId);
    return !!theme && (!theme.plusOnly || hasPremiumThemes === true);
  }

  function getThemeClassNames(themeId) {
    const theme = getTheme(themeId) || THEME_BY_ID.light;
    const classNames = [];
    if (theme.mode === "dark") classNames.push("theme-dark");
    if (classNames.indexOf(theme.className) === -1) classNames.push(theme.className);
    return classNames;
  }

  function resolveThemePreference(options) {
    const source = options && typeof options === "object" ? options : {};
    const systemTheme = source.systemTheme === "dark" ? "dark" : "light";
    const desiredTheme = normalizeThemeId(source.desiredTheme, systemTheme) || systemTheme;
    let freeFallback = normalizeThemeId(source.freeFallback, systemTheme);

    if (!freeFallback || !canUseTheme(freeFallback, false)) {
      freeFallback = canUseTheme(desiredTheme, false) ? desiredTheme : systemTheme;
    }

    return {
      desiredTheme: desiredTheme,
      freeFallback: freeFallback,
      activeTheme: canUseTheme(desiredTheme, source.hasPremiumThemes)
        ? desiredTheme
        : freeFallback,
    };
  }

  return {
    THEMES: THEMES,
    getThemes: getThemes,
    getTheme: getTheme,
    normalizeThemeId: normalizeThemeId,
    canUseTheme: canUseTheme,
    getThemeClassNames: getThemeClassNames,
    resolveThemePreference: resolveThemePreference,
  };
});
