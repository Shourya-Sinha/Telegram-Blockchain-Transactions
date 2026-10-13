import { useLang, LANGUAGES, type Lang } from '../i18n';
import { haptic } from '../telegram';

/**
 * Flag selector for the interface language: 🇬🇧 EN / 🇨🇳 ZH. Picking a flag
 * switches the whole Mini App and remembers the choice (the backend locale is
 * synced so bot messages follow too).
 */
export function LanguageSwitcher({ variant = 'chip' }: { variant?: 'chip' | 'panel' }) {
  const lang = useLang((state) => state.lang);
  const setLang = useLang((state) => state.setLang);
  const select = (next: Lang) => {
    if (next === lang) return;
    haptic('medium');
    setLang(next);
  };
  if (variant === 'panel') {
    return <div className="lang-panel">
      {LANGUAGES.map((language) => (
        <button key={language.code} className={lang === language.code ? 'lang-option active' : 'lang-option'} onClick={() => select(language.code)}>
          <span className="lang-flag">{language.flag}</span>
          <span className="lang-name">{language.code === 'en' ? 'English' : '中文'}</span>
          <span className="lang-code">{language.label}</span>
        </button>
      ))}
    </div>;
  }
  return <div className="lang-switcher" role="group" aria-label="Language / 语言">
    {LANGUAGES.map((language) => (
      <button
        key={language.code}
        className={lang === language.code ? 'lang-btn active' : 'lang-btn'}
        onClick={() => select(language.code)}
        aria-pressed={lang === language.code}
        title={language.code === 'en' ? 'English' : '中文'}
      >
        <span className="lang-flag">{language.flag}</span>
        <span>{language.label}</span>
      </button>
    ))}
  </div>;
}
