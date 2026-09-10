(function() {
  const THEME_STORAGE_KEY = 'uiTheme';
  const THEME_DEFAULT = 'notion';

  function applyTheme(themeId) {
    const currentTheme = themeId === 'regular' ? 'regular' : 'notion';
    document.documentElement.setAttribute('data-theme', currentTheme);
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([THEME_STORAGE_KEY], (result) => {
      applyTheme(result[THEME_STORAGE_KEY] || THEME_DEFAULT);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[THEME_STORAGE_KEY]) {
        applyTheme(changes[THEME_STORAGE_KEY].newValue);
      }
    });
  } else {
    applyTheme(localStorage.getItem('app_theme_v1') || THEME_DEFAULT);
    window.addEventListener('storage', event => {
      if (event.key === 'app_theme_v1') {
        applyTheme(event.newValue);
      }
    });
  }
})();