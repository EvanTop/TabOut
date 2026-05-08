// Runs synchronously in <head> before CSS parses, so saved theme overrides
// prefers-color-scheme without a flash of wrong theme on load.
(() => {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch {}
})();
