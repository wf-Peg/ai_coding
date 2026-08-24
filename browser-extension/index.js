(function() {
  const THEME_STORAGE_KEY = 'app_theme_v1';

  function applyTheme(themeId, persist = true) {
    const currentTheme = themeId === 'notion' ? 'notion' : 'regular';
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (persist) {
      localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
    }
  }

  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY) {
      applyTheme(event.newValue, false);
    }
  });

  applyTheme(localStorage.getItem(THEME_STORAGE_KEY));
})();