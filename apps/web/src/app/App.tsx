import { FormEvent, useEffect, useMemo, useState } from "react";
import { PRODUCT_BRANDING } from "@alpha/branding";
import { listConversationMessages, type ConversationMessage } from "@alpha/memory";
import { Qwen25WebGpuAdapter } from "@alpha/models";
import { SearxngSearchProviderAdapter } from "@alpha/retrieval/searxng";
import { SmolWebSearchAgent, type SmolWebSearchSource } from "@alpha/search-agent";
import { getInitialLocale, persistLocale, UI_LANGUAGES, UI_MESSAGES, type UiLocale } from "../i18n";
import { visibleLoadPercent } from "./loading-percent";

const CONVERSATION_ID = "alpha-default";
const model = new Qwen25WebGpuAdapter();

type TaskId = "internet-search" | null;

async function generateLocal(prompt: string): Promise<string> {
  let answer = "";
  for await (const token of model.generate({
    systemPrompt: "You are Alpha 2, a concise and accurate multilingual local assistant. Reply in the user's language. Do not claim current web facts unless web evidence is provided.",
    userPrompt: prompt,
    maxTokens: 700,
    thinking: false,
    temperature: 0.2
  })) answer += token;
  return answer.trim();
}

function runInternetSearch(query: string): boolean {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}

export function App() {
  const [locale, setLocale] = useState<UiLocale>(getInitialLocale);
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [modelReady, setModelReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("Qwen2.5-0.5B не е зареден");
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<SmolWebSearchSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskId>(null);
  const t = UI_MESSAGES[locale];

  const searxngUrl = (import.meta.env.VITE_SEARXNG_URL as string | undefined)?.trim();
  const searchAgent = useMemo(() => {
    if (!searxngUrl) return null;
    return new SmolWebSearchAgent(model, new SearxngSearchProviderAdapter({ baseUrl: searxngUrl, language: locale, categories: ["general"] }));
  }, [locale, searxngUrl]);

  useEffect(() => { void listConversationMessages(CONVERSATION_ID).then(setHistory).catch(() => undefined); }, []);
  useEffect(() => { persistLocale(locale); }, [locale]);

  async function loadModel(): Promise<void> {
    setLoading(true); setLoadProgress(0); setError(null);
    try {
      await model.load((progress, text) => { setLoadProgress(Math.max(0, Math.min(1, progress))); setProgressText(text); });
      setModelReady(true); setLoadProgress(1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }

  function selectInternetSearch(): void {
    setSelectedTask("internet-search");
    setMessage("");
    setAnswer("Задача: Търси в интернет. Въведи какво да намеря и натисни „Изпълни“.");
    setSources([]);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const prompt = message.trim();
    if (!prompt || busy) return;

    if (selectedTask === "internet-search") {
      setError(null);
      setSources([]);
      const opened = runInternetSearch(prompt);
      if (opened) setAnswer(`Стартирано интернет търсене за: “${prompt}”`);
      else setError("Браузърът блокира новия прозорец. Разреши pop-ups за Alpha Chat и опитай отново.");
      return;
    }

    if (!modelReady) return;
    setBusy(true); setError(null); setAnswer(""); setSources([]);
    try {
      if (searchAgent) { const result = await searchAgent.run(prompt); setAnswer(result.answer); setSources(result.sources); }
      else setAnswer(await generateLocal(prompt));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const loadPercent = visibleLoadPercent(loadProgress, modelReady);
  const taskActive = selectedTask === "internet-search";

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">{PRODUCT_BRANDING.version}</p><h1>{PRODUCT_BRANDING.officialName}</h1><p className="subtitle">Developed by {PRODUCT_BRANDING.developer}</p></div>
      <div className="topbar-tools"><label className="language-picker"><span className="language-icon" aria-hidden="true">◎</span><span className="language-label">{t.language}</span><select value={locale} onChange={(event) => setLocale(event.target.value as UiLocale)} aria-label={t.language}>{UI_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label><div className="status-stack" aria-live="polite"><span className={`status ${modelReady ? "ok" : "warn"}`}>AI runtime: {modelReady ? "WebGPU ready" : loading ? `${loadPercent}%` : "not loaded"}</span><span className={`status ${searxngUrl ? "ok" : "warn"}`}>Search: {searxngUrl ? "SearXNG configured" : "browser task ready"}</span></div></div></header>
    <section className="workspace"><aside className="sidebar" aria-label={t.conversations}>
      <strong>Задачи</strong>
      <button type="button" className="primary" onClick={selectInternetSearch}>Търси в интернет</button>
      {taskActive && <p className="muted">Активна задача: интернет търсене</p>}
      <hr />
      <button type="button" className="primary" onClick={() => void loadModel()} disabled={loading || modelReady}>{modelReady ? "Qwen2.5 зареден" : loading ? `Зареждане ${loadPercent}%` : "Зареди Qwen2.5-0.5B"}</button>
      {(loading || modelReady) && <div className="model-load" aria-live="polite"><div className="model-load-head"><strong>{modelReady ? "Готов" : `Зареждане · ${loadPercent}%`}</strong><span>{loadPercent}%</span></div><progress className="model-progress" max={100} value={loadPercent}>{loadPercent}%</progress><p className="muted model-load-text">{progressText}</p>{loading && <p className="muted model-load-note">Многоезичният модел се изтегля и след това се инициализира в WebGPU.</p>}</div>}
      {!loading && !modelReady && <p className="muted">{progressText}</p>}<p className="muted">{t.savedMessages}: {history.length}</p><div className="diagnostic"><strong>{t.provider}</strong><span>Transformers.js / WebGPU</span></div></aside>
      <section className="chat-panel">{!answer && <div className="empty-state"><h2>Alpha Chat 2.0 · Автоматизации</h2><p>Избери задача от бутоните вляво. Първата задача „Търси в интернет“ работи директно през браузъра и не изисква зареден AI модел.</p></div>}
        {answer && <article className="answer"><h3>{taskActive ? "Задача" : "Отговор"}</h3><pre>{answer}</pre>{sources.length > 0 && <details><summary>Източници ({sources.length})</summary><ol>{sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ol></details>}</article>}
        {error && <p className="notice" aria-live="polite">{error}</p>}
        <form className="composer" onSubmit={(event) => void submit(event)}><label htmlFor="message">{taskActive ? "Какво да намеря в интернет?" : t.message}</label><div className="composer-row"><textarea id="message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={taskActive ? "Например: новини за WebGPU" : modelReady ? t.placeholder : "Избери задача или зареди Qwen2.5-0.5B"} rows={3} disabled={busy || (!taskActive && !modelReady)} /><button type="submit" className="primary" disabled={busy || !message.trim() || (!taskActive && !modelReady)}>{busy ? "Работи…" : taskActive ? "Изпълни" : t.send}</button></div></form>
      </section></section>
  </main>;
}
