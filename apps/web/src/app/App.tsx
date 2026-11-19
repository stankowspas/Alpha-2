import { FormEvent, useEffect, useMemo, useState } from "react";
import { PRODUCT_BRANDING } from "@alpha/branding";
import { listConversationMessages, saveConversationMessage, type ConversationMessage } from "@alpha/memory";
import { CloudflareGemmaAdapter, type ChatLine } from "./cloudflare-gemma";
import { TurnstileVerification } from "./turnstile";
import { SearxngSearchProviderAdapter } from "@alpha/retrieval/searxng";
import type { SmolWebSearchSource } from "@alpha/search-agent";
import { getInitialLocale, persistLocale, UI_LANGUAGES, UI_MESSAGES, type UiLocale } from "../i18n";


const CONVERSATION_ID = "alpha-default";
const model = new CloudflareGemmaAdapter();

type TaskId = "internet-search" | null;

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
  return [...prior, { role: "user", content: prompt }].slice(-9);
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
  const [sources, setSources] = useState<SmolWebSearchSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskId>(null);
  const t = UI_MESSAGES[locale];

  const searxngUrl = (import.meta.env.VITE_SEARXNG_URL as string | undefined)?.trim();
  const searchProvider = useMemo(() => {
    if (!searxngUrl) return null;
    return new SearxngSearchProviderAdapter({ baseUrl: searxngUrl, language: locale, categories: ["general"] });
  }, [locale, searxngUrl]);

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

  function selectInternetSearch(): void {
    setSelectedTask("internet-search");
    setMessage("");
    setAnswer("Задача: Търси в нашата интернет търсачка. Въведи заявка и натисни „Изпълни“.");
    setSources([]);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const prompt = message.trim();
    if (!prompt || busy) return;

    if (selectedTask === "internet-search") {
      if (!searchProvider) {
        setError("Нашата търсачка още няма конфигуриран SearXNG endpoint.");
        return;
      }
      setBusy(true); setError(null); setAnswer(""); setSources([]);
      try {
        const results = await searchProvider.search({ query: prompt, maxResults: 10 });
        setSources(results.map((result) => ({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          publishedAt: result.publishedAt,
          retrievedAtUtc: result.retrievedAtUtc
        })));
        setAnswer(results.length > 0
          ? `Намерени резултати за: “${prompt}”`
          : `Няма намерени резултати за: “${prompt}”`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!modelReady) { setError("AI връзката още не е готова."); return; }
    if (!verificationToken) { setError("Потвърди проверката Turnstile, преди да изпратиш въпрос."); return; }
    if (prompt.length > 1800) { setError("Въпросът трябва да бъде до 1800 символа."); return; }
    setBusy(true); setError(null); setAnswer(""); setSources([]);
    model.setVerificationToken(verificationToken);
    try {
      let result: string;
      if (searchProvider) {
        // One model request: Turnstile tokens are single-use.
        const hits = await searchProvider.search({ query: prompt, maxResults: 6 });
        setSources(hits.map(({title,url,snippet,publishedAt,retrievedAtUtc}) => ({title,url,snippet,publishedAt,retrievedAtUtc})));
        const evidence = hits.map(hit => `${hit.title}\n${hit.url}\n${hit.snippet ?? ""}`).join("\n\n");
        const prefix = `Въпрос: ${prompt}\n\nИзточници (може да са непълни или неточни):\n`;
        const cloudPrompt = (prefix + evidence.slice(0, Math.max(0, 1800 - prefix.length))).slice(0, 1800);
        result = await model.generateConversation([{ role: "user", content: cloudPrompt }], AbortSignal.timeout(90000));
      } else {
        result = await model.generateConversation(recentMessages(history, prompt), AbortSignal.timeout(90000));
      }
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

  const taskActive = selectedTask === "internet-search";

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">{PRODUCT_BRANDING.version}</p><h1>{PRODUCT_BRANDING.officialName}</h1><p className="subtitle">Developed by {PRODUCT_BRANDING.developer}</p></div>
      <div className="topbar-tools"><label className="language-picker"><span className="language-icon" aria-hidden="true">◎</span><span className="language-label">{t.language}</span><select value={locale} onChange={(event) => setLocale(event.target.value as UiLocale)} aria-label={t.language}>{UI_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label><div className="status-stack" aria-live="polite"><span className={`status ${modelReady ? "ok" : "warn"}`}>AI: {modelReady ? "Gemma 4 · Cloudflare" : loading ? "Свързване…" : "Не е свързан"}</span><span className={`status ${searxngUrl ? "ok" : "warn"}`}>Search: {searxngUrl ? "Alpha search ready" : "endpoint not configured"}</span></div></div></header>
    <section className="workspace"><aside className="sidebar" aria-label={t.conversations}>
      <strong>Задачи</strong>
      <button type="button" className="primary" onClick={selectInternetSearch}>Търси в интернет</button>
      {taskActive && <p className="muted">Активна задача: наша интернет търсачка</p>}
      <hr />
      <button type="button" className="primary" onClick={() => void loadModel()} disabled={loading}>{loading ? "Свързване…" : modelReady ? "Провери Gemma 4" : "Свържи Gemma 4"}</button>
      <p className="muted model-load-text">{progressText}</p>
      {modelReady && <div className="model-load"><strong>Проверка срещу автоматизирани заявки</strong><TurnstileVerification siteKey={model.siteKey} resetVersion={challengeVersion} onToken={setVerificationToken}/><p className="muted model-load-note">За всеки въпрос е необходима нова проверка.</p></div>}
      <p className="muted">{t.savedMessages}: {history.length}</p><div className="diagnostic"><strong>{t.provider}</strong><span>Cloudflare Workers AI · Gemma 4 26B A4B</span></div></aside>
      <section className="chat-panel">{!answer && <div className="empty-state"><h2>Alpha Chat 2.0 · Автоматизации</h2><p>Избери задача от бутоните вляво или изпрати въпрос до Gemma 4. „Търси в интернет“ използва отделния search provider.</p></div>}
        {answer && <article className="answer"><h3>{taskActive ? "Търсене" : "Отговор"}</h3><pre>{answer}</pre>{sources.length > 0 && <ol>{sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{source.snippet && <p>{source.snippet}</p>}</li>)}</ol>}</article>}
        {error && <p className="notice" aria-live="polite">{error}</p>}
        <form className="composer" onSubmit={(event) => void submit(event)}><label htmlFor="message">{taskActive ? "Какво да намеря в интернет?" : t.message}</label><div className="composer-row"><textarea id="message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={taskActive ? "Например: новини за WebGPU" : modelReady ? t.placeholder : "Изчаква се връзка с Cloudflare AI"} rows={3} maxLength={taskActive ? undefined : 1800} disabled={busy || (!taskActive && !modelReady)} /><button type="submit" className="primary" disabled={busy || !message.trim() || (!taskActive && (!modelReady || !verificationToken))}>{busy ? "Работи…" : taskActive ? "Изпълни" : t.send}</button></div></form>
      </section></section>
  </main>;
}
