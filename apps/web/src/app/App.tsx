import { useEffect, useState } from "react";
import { PRODUCT_BRANDING } from "@alpha/branding";
import { listConversationMessages, type ConversationMessage } from "@alpha/memory";
import { getInitialLocale, persistLocale, UI_LANGUAGES, UI_MESSAGES, type UiLocale } from "../i18n";

const CONVERSATION_ID = "alpha-default";

export function App() {
  const [locale, setLocale] = useState<UiLocale>(getInitialLocale);
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const t = UI_MESSAGES[locale];

  useEffect(() => {
    void listConversationMessages(CONVERSATION_ID).then(setHistory).catch(() => undefined);
  }, []);

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{PRODUCT_BRANDING.version}</p>
          <h1>{PRODUCT_BRANDING.officialName}</h1>
          <p className="subtitle">Developed by {PRODUCT_BRANDING.developer}</p>
        </div>
        <div className="topbar-tools">
          <label className="language-picker">
            <span className="language-icon" aria-hidden="true">◎</span>
            <span className="language-label">{t.language}</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value as UiLocale)} aria-label={t.language}>
              {UI_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
            </select>
          </label>
          <div className="status-stack" aria-live="polite">
            <span className="status warn">AI runtime: not configured</span>
            <span className="status warn">{t.model}: {t.notSelected}</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar" aria-label={t.conversations}>
          <button type="button" className="primary">{t.newChat}</button>
          <p className="muted">{t.savedMessages}: {history.length}</p>
          <div className="diagnostic"><strong>{t.provider}</strong><span>local-browser</span></div>
        </aside>

        <section className="chat-panel">
          <div className="empty-state">
            <h2>Alpha Chat 2.0</h2>
            <p>Gemini е премахнат. Локалният browser модел още не е инсталиран.</p>
          </div>

          <p className="notice" aria-live="polite">MODEL_NOT_CONFIGURED</p>

          <form className="composer" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="message">{t.message}</label>
            <div className="composer-row">
              <textarea id="message" placeholder={t.placeholder} rows={3} disabled />
              <button type="submit" className="primary" disabled>{t.send}</button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
