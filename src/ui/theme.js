'use strict';
// Applies a VRK theme to a document: colors become CSS variables (with the
// in-between shades derived so any palette stays coherent), plus font, tab
// shape, density, glass toolbar, animation flags and the theme's custom CSS.
// Shared by the browser UI and the address-bar suggestion list.

(() => {
  const FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, sans-serif',
    serif: 'ui-serif, "New York", Georgia, serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
    condensed: '"Avenir Next Condensed", "Helvetica Neue", -apple-system, sans-serif',
  };
  const VARS = ['--bg', '--strip', '--toolbar', '--field', '--text', '--muted', '--line', '--accent', '--accent-2', '--radius-ui', '--font-ui', '--glass'];
  let customSheet = null;

  function setCustomCss(css) {
    customSheet ||= new CSSStyleSheet();
    try {
      customSheet.replaceSync(css || '');
    } catch {
      customSheet.replaceSync('');
    }
    if (!document.adoptedStyleSheets.includes(customSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, customSheet];
  }

  // The theme's CSS variables, for applying to any element (the editor's preview uses this).
  function vars(theme) {
    const c = theme.colors;
    return {
      '--bg': c.bg,
      '--strip': c.strip,
      '--toolbar': c.surface,
      '--field': c.field,
      '--text': c.text,
      '--muted': c.muted,
      '--line': c.line,
      '--accent': c.accent,
      '--accent-2': c.accent2,
      '--radius-ui': `${theme.radius}px`,
      '--font-ui': FONTS[theme.font] || FONTS.system,
      '--glass': String(theme.glass),
    };
  }

  const systemTheme = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  // `classic` = VRK Classic (driven by the basic appearance settings), else a full theme object.
  function apply(theme, { classic = {} } = {}) {
    const body = document.body;
    if (!theme || theme.classic) {
      delete body.dataset.custom;
      for (const name of VARS) body.style.removeProperty(name);
      body.dataset.tabstyle = 'classic';
      body.dataset.glass = '0';
      body.dataset.chromeGradient = '0';
      body.dataset.animTabs = '1';
      body.dataset.glow = '1';
      if (classic.theme) body.dataset.theme = classic.theme === 'system' ? systemTheme() : classic.theme;
      if (classic.accent) body.dataset.accent = classic.accent;
      if (classic.density) body.dataset.density = classic.density;
      setCustomCss('');
      return;
    }
    body.dataset.custom = '1';
    body.dataset.theme = theme.base;
    body.dataset.density = theme.density;
    body.dataset.tabstyle = theme.tabStyle;
    body.dataset.glass = theme.glass > 0 ? '1' : '0';
    body.dataset.chromeGradient = theme.chromeGradient ? '1' : '0';
    body.dataset.animTabs = theme.animations.tabs ? '1' : '0';
    body.dataset.glow = theme.animations.glow ? '1' : '0';
    body.dataset.logoPulse = theme.animations.logoPulse ? '1' : '0';
    for (const [name, value] of Object.entries(vars(theme))) body.style.setProperty(name, value);
    setCustomCss(theme.css);
  }

  window.VRKTheme = { apply, vars, FONTS, mediaUrl: (name) => `vrk://media/${encodeURIComponent(name)}` };
})();
