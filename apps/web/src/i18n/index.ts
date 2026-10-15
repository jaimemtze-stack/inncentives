import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es-MX.json';

const saved = (() => {
  try {
    return localStorage.getItem('locale');
  } catch {
    return null;
  }
})();

void i18n.use(initReactI18next).init({
  resources: { 'es-MX': { translation: es }, en: { translation: en } },
  lng: saved === 'en' ? 'en' : 'es-MX',
  fallbackLng: 'es-MX',
  interpolation: { escapeValue: false }, // React escapes output
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem('locale', lng);
  } catch {
    /* storage unavailable */
  }
});

export default i18n;
