import { useLang, LANGUAGES, type Lang } from '../i18n';

/**
 * Flag selector for the admin console language: 🇬🇧 EN / 🇨🇳 ZH.
 * Compact chips for the sidebar and login screen.
 */
export function LanguageSwitcher() {
  const lang = useLang((state) => state.lang);
  const setLang = useLang((state) => state.setLang);
  const select = (next: Lang) => setLang(next);
  return <div className="lang-switcher" role="group" aria-label="Language / 语言">
    {LANGUAGES.map((language) => (
      <button
        key={language.code}
        className={lang === language.code ? 'lang-btn active' : 'lang-btn'}
        onClick={() => select(language.code)}
        aria-pressed={lang === language.code}
        title={language.name}
      >
        <span className="lang-flag">{language.flag}</span>
        <span>{language.codeLabel}</span>
      </button>
    ))}
  </div>;
}
