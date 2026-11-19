import { FormEvent, useEffect, useState } from "react";
import { PRODUCT_BRANDING } from "@alpha/branding";
import { listConversationMessages, saveConversationMessage, type ConversationMessage } from "@alpha/memory";
import { CloudflareGemmaAdapter, type ChatLine } from "./cloudflare-gemma";
import { TurnstileVerification } from "./turnstile";
import { getInitialLocale, persistLocale, UI_LANGUAGES, UI_MESSAGES, type UiLocale } from "../i18n";


const CONVERSATION_ID = "alpha-default";
const model = new CloudflareGemmaAdapter();

function recentMessages(history: ConversationMessage[], prompt: string): ChatLine[] {
  const prior: ChatLine[] = [];
  for (const entry of history.slice(-8)) {
    const content = entry.content.trim().slice(0, 1800);
    if (!content || !["user", "assistant"].includes(entry.role)) continue;
    if (prior.at(-1)?.role === entry.role) prior.pop();
    prior.push({ role: entry.role, content });
  }
  if (prior.at(-1)?.role === "user") prior.pop();
  while (prior.length && prior[0].role !== "user") prior.shift();
  return [...prior, { role: "user" as const, content: prompt }].slice(-9);
}

export function App() {
  const [locale, setLocale] = useState<UiLocale>(getInitialLocale);
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [modelReady, setModelReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("Проверка на Gemma 4 в Cloudflare…");
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = UI_MESSAGES[locale];

  useEffect(() => { void listConversationMessages(CONVERSATION_ID).then(setHistory).catch(() => undefined); }, []);
  useEffect(() => { persistLocale(locale); }, [locale]);
  useEffect(() => { void loadModel(); }, []);

  async function loadModel(): Promise<void> {
    setLoading(true); setError(null);
    try {
      await model.load((_progress, text) => setProgressText(text));
      setModelReady(true);
    } catch (cause) {
      setModelReady(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setLoading(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const prompt = message.trim();
    if (!prompt || busy) return;

    if (!modelReady) { setError("AI връзката още не е готова."); return; }
    if (!verificationToken) { setError("Потвърди проверката Turnstile, преди да изпратиш въпрос."); return; }
    if (prompt.length > 1800) { setError("Въпросът трябва да бъде до 1800 символа."); return; }
    setBusy(true); setError(null); setAnswer("");
    model.setVerificationToken(verificationToken);
    try {
      const result = await model.generateConversation(recentMessages(history, prompt), AbortSignal.timeout(90000));
      setAnswer(result);
      const now = Date.now();
      const messages: ConversationMessage[] = [
        { id: crypto.randomUUID(), conversationId: CONVERSATION_ID, role: "user", content: prompt, createdAt: new Date(now).toISOString() },
        { id: crypto.randomUUID(), conversationId: CONVERSATION_ID, role: "assistant", content: result, createdAt: new Date(now + 1).toISOString() }
      ];
      setHistory(current => [...current, ...messages]);
      await Promise.allSettled(messages.map(saveConversationMessage));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      setBusy(false);
      setVerificationToken("");
      setChallengeVersion(v => v + 1);
    }
  }

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">{PRODUCT_BRANDING.version}</p><h1>{PRODUCT_BRANDING.officialName}</h1><p className="subtitle">Developed by {PRODUCT_BRANDING.developer}</p></div>
      <div className="topbar-tools"><label className="language-picker"><span className="language-icon" aria-hidden="true">◎</span><span className="language-label">{t.language}</span><select value={locale} onChange={(event) => setLocale(event.target.value as UiLocale)} aria-label={t.language}>{UI_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label><div className="status-stack" aria-live="polite"><span className={`status ${modelReady ? "ok" : "warn"}`}>AI: {modelReady ? "Gemma 4 · Cloudflare" : loading ? "Свързване…" : "Не е свързан"}</span></div></div></header>
    <section className="workspace"><aside className="sidebar" aria-label={t.conversations}>
      <strong>AI модел</strong>
      <button type="button" className="primary" onClick={() => void loadModel()} disabled={loading}>{loading ? "Свързване…" : modelReady ? "Провери Gemma 4" : "Свържи Gemma 4"}</button>
      <p className="muted model-load-text">{progressText}</p>
      {modelReady && <div className="model-load"><strong>Проверка срещу автоматизирани заявки</strong><TurnstileVerification siteKey={model.siteKey} resetVersion={challengeVersion} onToken={setVerificationToken}/><p className="muted model-load-note">За всеки въпрос е необходима нова проверка.</p></div>}
      <p className="muted">{t.savedMessages}: {history.length}</p><div className="diagnostic"><strong>{t.provider}</strong><span>Cloudflare Workers AI · Gemma 4 26B A4B</span></div></aside>
      <section className="chat-panel">{!answer && <div className="empty-state"><h2>Alpha Chat 2.0</h2><p>Въведи въпрос, за да получиш отговор от облачния модел Gemma 4. Интернет търсенето не е включено.</p></div>}
        {answer && <article className="answer"><h3>Отговор</h3><pre>{answer}</pre></article>}
        {error && <p className="notice" aria-live="polite">{error}</p>}
        <form className="composer" onSubmit={(event) => void submit(event)}><label htmlFor="message">{t.message}</label><div className="composer-row"><textarea id="message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={modelReady ? t.placeholder : "Изчаква се връзка с Cloudflare AI"} rows={3} maxLength={1800} disabled={busy || !modelReady} /><button type="submit" className="primary" disabled={busy || !message.trim() || !modelReady || !verificationToken}>{busy ? "Работи…" : t.send}</button></div></form>
      </section></section>
  </main>;
}
