export type ThemePreference = 'system' | 'light' | 'dark';
const key = 'data-canvas-theme';
const system = window.matchMedia('(prefers-color-scheme: dark)');
let preference: ThemePreference = 'system';
try {
  const saved = localStorage.getItem(key);
  if (saved === 'light' || saved === 'dark') preference = saved;
} catch { /* Storage can be unavailable in private contexts. */ }
function applyTheme() {
  const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f2f2f2' : '#0e0e0e');
}
export const getThemePreference = () => preference;
export function setThemePreference(value: ThemePreference) {
  preference = value;
  try { localStorage.setItem(key, value); } catch { /* Keep the selection for this session. */ }
  applyTheme();
}
system.addEventListener('change', applyTheme);
applyTheme();
