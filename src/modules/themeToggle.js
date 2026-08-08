// ---------------------------------------------------------------------------
// themeToggle.js
//
// Dark/light theme switch. Theme is applied via a `data-theme` attribute on
// <html>; the CSS custom properties in _variables.scss key off that
// attribute to swap every color token at once (see :root / [data-theme='light']).
// Preference persists in localStorage; dark is the default when nothing's
// been chosen yet. A tiny inline script in index.html applies the stored
// preference before first paint to avoid a flash of the wrong theme.
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'crossword-solver:theme';
export const THEMES = { DARK: 'dark', LIGHT: 'light' };

function getStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === THEMES.LIGHT || stored === THEMES.DARK ? stored : null;
  } catch {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (e.g. disabled/private mode) — theme just won't
    // persist across reloads, which is fine as a fallback.
  }
}

function applyTheme(theme) {
  // Dark is the implicit default look (every unthemed color already is
  // dark), so only mark the document when light mode is active.
  if (theme === THEMES.LIGHT) {
    document.documentElement.setAttribute('data-theme', THEMES.LIGHT);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

let currentTheme = THEMES.DARK;

/**
 * Call once on boot, before the first render. Reads any stored preference
 * (defaulting to dark) and applies it.
 * @returns {string} the active theme
 */
export function initTheme() {
  currentTheme = getStoredTheme() || THEMES.DARK;
  applyTheme(currentTheme);
  return currentTheme;
}

/** @returns {string} the currently active theme */
export function getTheme() {
  return currentTheme;
}

/** Flips the theme, applies it, and persists the choice. */
export function toggleTheme() {
  currentTheme = currentTheme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
  applyTheme(currentTheme);
  storeTheme(currentTheme);
  return currentTheme;
}
