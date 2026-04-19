'use strict';

const THEME_STORAGE_KEY = 'ket-ui-theme';
const META_THEME_SELECTOR = 'meta[name="theme-color"]';
const DARK_THEME_COLOR = '#111827';
const LIGHT_THEME_COLOR = '#4F7BF7';

let mediaQuery = null;
let mediaListenerBound = false;
let mediaListener = null;

export function loadThemePreference() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(theme) {
  const next = theme === 'light' || theme === 'dark' ? theme : 'system';
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // ignore storage failures
  }
  applyTheme(next);
  return next;
}

export function resolveTheme(theme = loadThemePreference()) {
  if (theme === 'light' || theme === 'dark') return theme;
  if (!window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme = loadThemePreference()) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  syncThemeMeta(resolved);
  return resolved;
}

export function initTheme() {
  applyTheme(loadThemePreference());

  if (!window.matchMedia || mediaListenerBound) return;

  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemThemeChange = () => {
    if (loadThemePreference() === 'system') {
      applyTheme('system');
    }
  };

  mediaListener = handleSystemThemeChange;
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleSystemThemeChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleSystemThemeChange);
  }
  mediaListenerBound = true;
}

function syncThemeMeta(resolvedTheme) {
  const meta = document.querySelector(META_THEME_SELECTOR);
  if (!meta) return;
  meta.setAttribute('content', resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
}
