/**
 * i18n.js — Simple localization system for RohanKar Launcher
 */

class I18n {
  constructor() {
    this.currentLocale = 'en';
    this.translations = {};
    this.fallbackLocale = 'en';
  }

  async init() {
    // Load translations via IPC (for Electron)
    try {
      this.translations.en = await window.electronAPI.getTranslation('en');
    } catch (e) {
      this.translations.en = {};
    }

    try {
      this.translations.ru = await window.electronAPI.getTranslation('ru');
    } catch (e) {
      this.translations.ru = {};
    }

    // Load saved locale from settings
    try {
      const settings = await window.electronAPI.getSettings();
      const savedLocale = settings.language || 'en';
      if (this.translations[savedLocale]) {
        this.currentLocale = savedLocale;
      } else {
        this.currentLocale = this.fallbackLocale;
      }
    } catch (e) {
      this.currentLocale = 'en';
    }

    this.applyTranslations();
  }

  setLocale(locale) {
    if (this.translations[locale]) {
      this.currentLocale = locale;
      this.applyTranslations();

      // Refresh dynamic elements
      if (window.renderLibraryGrid) window.renderLibraryGrid();
      if (window.renderHomeStats) window.renderHomeStats();
      if (window.selectedGame && window.showDetailView) {
        window.showDetailView(window.selectedGame);
      }

      return true;
    }
    return false;
  }

  getLocale() {
    return this.currentLocale;
  }

  getLocaleCode() {
    // Returns locale code for date formatting (en-US, ru-RU)
    return this.currentLocale === 'ru' ? 'ru-RU' : 'en-US';
  }

  t(key, params = {}) {
    const keys = key.split('.');
    let value = this.translations[this.currentLocale];

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        value = undefined;
        break;
      }
    }

    // Fallback to English if translation not found
    if (value === undefined && this.currentLocale !== this.fallbackLocale) {
      value = this.translations[this.fallbackLocale];
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          value = undefined;
          break;
        }
      }
    }

    if (value === undefined) {
      // Return English fallback for common keys if available
      const fallbackValue = this.translations['en'];
      if (fallbackValue) {
        let fbValue = fallbackValue;
        for (const k of keys) {
          if (fbValue && typeof fbValue === 'object' && k in fbValue) {
            fbValue = fbValue[k];
          } else {
            fbValue = undefined;
            break;
          }
        }
        if (fbValue) {
          value = fbValue;
        }
      }
      // If still no value, return key as last resort
      if (value === undefined) {
        return key;
      }
    }

    // Parameter substitution
    if (typeof value === 'string' && params) {
      Object.keys(params).forEach(paramKey => {
        value = value.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), params[paramKey]);
      });
    }

    return value;
  }

  applyTranslations() {
    // Update all elements with data-i18n attribute
    const elements = document.querySelectorAll('[data-i18n]');

    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translation = this.t(key);

      // Check if element is input or textarea
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.getAttribute('data-i18n-attr') === 'placeholder') {
          el.placeholder = translation;
        } else {
          el.value = translation;
        }
      } else if (el.tagName === 'IMG' || el.tagName === 'svg') {
        // For icons and images, use title attribute
        const titleKey = key + '.title';
        const titleTranslation = this.t(titleKey);
        if (titleTranslation !== titleKey) {
          el.setAttribute('title', titleTranslation);
        }
      } else {
        el.textContent = translation;
      }
    });

    // Update placeholder for input with data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = this.t(key);
    });

    // Update title for elements with data-i18n-title
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      el.setAttribute('title', this.t(key));
    });

    // Update option elements in select
    document.querySelectorAll('option[data-i18n-option]').forEach(option => {
      const key = option.getAttribute('data-i18n-option');
      option.textContent = this.t(key);
    });

    // Update html lang attribute
    document.documentElement.lang = this.currentLocale;
  }
}

// Create global instance
window.i18n = new I18n();
