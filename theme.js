/* Apply the saved theme before the stylesheet loads to avoid a color flash. */
(() => {
  'use strict';
  const storageKey = 'tmis-theme';
  let theme = 'dark';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch { /* Theme switching also works when storage is unavailable. */ }

  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101214' : '#f5f7fa';
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.querySelector('.theme-icon').textContent = theme === 'dark' ? '☀' : '☾';
    button.querySelector('.theme-label').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  }

  applyTheme();
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      try { localStorage.setItem(storageKey, theme); } catch { /* Keep the in-memory choice. */ }
    });
  });
})();
