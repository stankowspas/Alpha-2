import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { PRODUCT_BRANDING } from "@alpha/branding";
import { listConversationMessages, saveConversationMessage, type ConversationMessage } from "@alpha/memory";
import { CloudflareGemmaAdapter, type ChatLine } from "./cloudflare-gemma";
import { getInitialLocale, persistLocale, UI_LANGUAGES, UI_MESSAGES, type UiLocale } from "../i18n";

const LEGACY_CONVERSATION = "alpha-default";
const CONVERSATIONS_KEY = "alpha2-conversation-list-v1";
const ACTIVE_CONVERSATION_KEY = "alpha2-active-conversation-v1";
const model = new CloudflareGemmaAdapter();

interface ConversationSummary { id: string; title: string }

function readConversations(): ConversationSummary[] {
  try {
    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || "null") as unknown;
    if (Array.isArray(stored)) {
      const valid = stored.filter((value): value is ConversationSummary =>
        typeof value?.id === "string" && value.id.length < 90 &&
        typeof value?.title === "string" && value.title.length <= 100);
      if (valid.length) return valid.slice(0, 100);
    }
  } catch { /* no access to storage */ }
  // Preserve messages saved by older versions under alpha-default.
  return [{ id: LEGACY_CONVERSATION, title: "Alpha Chat" }];
}

function readActiveConversation(chats: ConversationSummary[]): string {
  try {
    const saved = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
    if (saved && chats.some(chat => chat.id === saved)) return saved;
  } catch { /* no access to storage */ }
  return chats[0].id;
}

function recentMessages(history: ConversationMessage[], prompt: string): ChatLine[] {
  const prior: ChatLine[] = [];
  for (const entry of history.slice(-8)) {
    const content = entry.content.trim().slice(0, 1800);
    if (!content) continue;
    if (prior.at(-1)?.role === entry.role) prior.pop();
    prior.push({ role: entry.role, content });
  }
  if (prior.at(-1)?.role === "user") prior.pop();
  while (prior.length && prior[0].role !== "user") prior.shift();
  return [...prior, { role: "user", content: prompt }].slice(-9);
}

export function App() {
  const [locale, setLocale] = useState<UiLocale>(getInitialLocale);
  const [conversations, setConversations] = useState<ConversationSummary[]>(readConversations);
  const [activeId, setActiveId] = useState(() => readActiveConversation(readConversations()));
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [modelReady, setModelReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const t = UI_MESSAGES[locale];

  useEffect(() => { persistLocale(locale); }, [locale]);
  useEffect(() => {
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeId);
    } catch { /* the chat can work without localStorage */ }
  }, [conversations, activeId]);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistory([]);
    void listConversationMessages(activeId)
      .then(items => { if (!cancelled) setHistory(items); })
      .catch(() => { if (!cancelled) setHistory([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, busy, activeId, error, historyLoading]);

  useEffect(() => { void loadModel(); }, []);

  async function loadModel(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await model.load();
      setModelReady(true);
    } catch (cause) {
      setModelReady(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  function openNewChat(): void {
    if (busy) return;
    const id = crypto.randomUUID();
    setConversations(previous => [{ id, title: t.untitledChat }, ...previous].slice(0, 100));
    setActiveId(id);
    setMessage("");
    setError(null);
    setSidebarOpen(false);
    textareaRef.current?.focus();
  }

  function selectChat(id: string): void {
    if (busy || id === activeId) return;
    setActiveId(id);
    setMessage("");
    setError(null);
    setSidebarOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const prompt = message.trim();
    if (!prompt || busy || historyLoading) return;
    if (!modelReady) { setError(t.connectionError); return; }
    if (prompt.length > 1800) return;
    setBusy(true);
    setError(null);

    try {
      const result = await model.generateConversation(recentMessages(history, prompt), AbortSignal.timeout(90000));
      const now = Date.now();
      const entries: ConversationMessage[] = [
        { id: crypto.randomUUID(), conversationId: activeId, role: "user", content: prompt, createdAt: new Date(now).toISOString() },
        { id: crypto.randomUUID(), conversationId: activeId, role: "assistant", content: result, createdAt: new Date(now + 1).toISOString() }
      ];
      setHistory(previous => [...previous, ...entries]);
      if (history.length === 0) {
        setConversations(previous => previous.map(chat =>
          chat.id === activeId ? { ...chat, title: prompt.slice(0, 54) } : chat));
      }
      setMessage("");
      await Promise.allSettled(entries.map(saveConversationMessage));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!busy && modelReady && !historyLoading && message.trim()) {
        event.currentTarget.form?.requestSubmit();
      }
    }
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-group">
        <button className="mobile-menu" type="button" onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={t.conversations} aria-expanded={sidebarOpen}>☰</button>
        <div className="brand-icon" aria-hidden="true">A²</div>
        <div className="brand-copy">
          <h1>{PRODUCT_BRANDING.version}</h1>
          <p>{t.tagline}</p>
        </div>
      </div>
      <div className="topbar-tools">
        <div className={`connection-status ${modelReady ? "is-ready" : "is-offline"}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          <span>{modelReady ? t.ready : loading ? t.connecting : t.offline}</span>
        </div>
        <label className="language-picker">
          <span className="language-label">{t.language}</span>
          <select value={locale} onChange={event => setLocale(event.target.value as UiLocale)} aria-label={t.language}>
            {UI_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.label}</option>)}
          </select>
        </label>
      </div>
    </header>

    <div className="workspace">
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`} aria-label={t.conversations}>
        <button className="new-chat" type="button" onClick={openNewChat} disabled={busy}>
          <span aria-hidden="true">＋</span><span>{t.newChat}</span>
        </button>
        <h2 className="sidebar-heading">{t.conversations}</h2>
        <nav className="conversation-list" aria-label={t.conversations}>
          {conversations.map(chat => <button key={chat.id} type="button" onClick={() => selectChat(chat.id)}
            className={`conversation-link ${chat.id === activeId ? "is-active" : ""}`}
            aria-current={chat.id === activeId ? "page" : undefined} disabled={busy}>
            <span className="conversation-glyph" aria-hidden="true">▤</span>
            <span className="conversation-title">{chat.title}</span>
          </button>)}
        </nav>
        <div className="sidebar-footer">
          <div className="model-meta"><span className="model-glyph" aria-hidden="true">✦</span>
            <div><strong>Gemma 4</strong><small>26B A4B · Cloudflare AI</small></div>
          </div>
          <p>{t.localHistory}</p>
          <small>© {new Date().getFullYear()} {PRODUCT_BRANDING.developer}</small>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label={t.conversations}
        type="button" onClick={() => setSidebarOpen(false)} />}

      <section className="chat-panel" aria-label={t.conversations}>
        <div className="chat-scroll" ref={scrollRef}>
          {historyLoading ? <div className="chat-loading" aria-live="polite">{t.connecting}</div> :
            history.length === 0 && !busy ? <div className="empty-state">
              <div className="empty-orb" aria-hidden="true">✦</div>
              <span className="empty-eyebrow">ALPHA AI</span>
              <h2>{t.welcomeTitle}</h2>
              <p>{t.welcomeText}</p>
            </div> : null}
          <div className="messages">
            {history.map(item => <article className={`message-item ${item.role === "user" ? "from-user" : "from-ai"}`} key={item.id}>
              <div className="message-avatar" aria-hidden="true">{item.role === "user" ? "U" : "✦"}</div>
              <div className="message-body">
                <div className="message-author">{item.role === "user" ? t.you : t.assistant}</div>
                <div className="message-bubble">{item.content}</div>
              </div>
            </article>)}
            {busy && <div className="pending-response" aria-live="polite">
              <div className="message-item from-user pending-user">
                <div className="message-avatar" aria-hidden="true">U</div>
                <div className="message-body"><div className="message-author">{t.you}</div>
                  <div className="message-bubble">{message.trim()}</div>
                </div>
              </div>
              <div className="message-item from-ai">
                <div className="message-avatar" aria-hidden="true">✦</div>
                <div className="message-body"><div className="message-author">{t.assistant}</div>
                  <div className="message-bubble thinking-bubble"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><span>{t.working}</span></div>
                </div>
              </div>
            </div>}
          </div>
          {error && <div className="error-banner" role="alert">
            <span>{error}</span>
            {!modelReady && <button type="button" onClick={() => void loadModel()} disabled={loading}>{t.retry}</button>}
          </div>}
        </div>
        <div className="composer-wrap">
          <form className="composer" onSubmit={event => void submit(event)}>
            <label className="sr-only" htmlFor="chat-message">{t.message}</label>
            <textarea ref={textareaRef} id="chat-message" value={message} onChange={event => setMessage(event.target.value)}
              onKeyDown={handleComposerKeyDown} maxLength={1800} rows={2}
              placeholder={modelReady ? t.placeholder : t.connecting} disabled={busy || !modelReady || historyLoading} />
            <button className="send-button" type="submit" disabled={busy || !modelReady || historyLoading || !message.trim()}
              aria-label={t.send}><span aria-hidden="true">➤</span><span className="send-label">{t.send}</span></button>
          </form>
          <p className="composer-hint">{t.promptHint}</p>
        </div>
      </section>
    </div>
  </main>;
}
