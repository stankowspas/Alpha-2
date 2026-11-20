import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { PRODUCT_BRANDING } from "@alpha/branding";
import { clearConversation, listConversationMessages, saveConversationMessage, type ConversationMessage } from "@alpha/memory";
import { CloudflareGemmaAdapter, type ChatLine, type WebSearchMode } from "./cloudflare-gemma";
import { getInitialLocale, persistLocale, UI_LANGUAGES, UI_MESSAGES, type UiLocale } from "../i18n";

const LEGACY_CONVERSATION = "alpha-default";
const CONVERSATIONS_KEY = "alpha2-conversation-list-v1";
const ACTIVE_CONVERSATION_KEY = "alpha2-active-conversation-v1";
const WEB_SEARCH_KEY = "alpha2-web-search-mode-v1";
const model = new CloudflareGemmaAdapter();

interface ConversationSummary { id: string; title: string }

function readConversations(): ConversationSummary[] {
  try {
    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || "null") as unknown;
    if (Array.isArray(stored)) {
      const valid = stored.filter((value): value is ConversationSummary =>
        typeof value?.id === "string" && value.id.length < 90 &&
        typeof value?.title === "string" && value.title.length <= 100);
      if (valid.length) return valid;
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
  for (const entry of history) {
    const content = entry.content.trim();
    if (!content) continue;
    if (prior.at(-1)?.role === entry.role) prior.pop();
    prior.push({ role: entry.role, content });
  }
  if (prior.at(-1)?.role === "user") prior.pop();
  while (prior.length && prior[0].role !== "user") prior.shift();
  return [...prior, { role: "user" as const, content: prompt }];
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>(() => {
    try {
      const saved = localStorage.getItem(WEB_SEARCH_KEY);
      if (saved === "auto" || saved === "on" || saved === "off") return saved;
    } catch { /* storage may be unavailable */ }
    return "auto";
  });
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const t = UI_MESSAGES[locale];

  useEffect(() => { persistLocale(locale); }, [locale]);
  useEffect(() => {
    try { localStorage.setItem(WEB_SEARCH_KEY, webSearchMode); } catch { /* non-fatal */ }
  }, [webSearchMode]);
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
    if (busy || deletingId) return;
    const id = crypto.randomUUID();
    setConversations(previous => [{ id, title: t.untitledChat }, ...previous]);
    setActiveId(id);
    setMessage("");
    setError(null);
    setSidebarOpen(false);
    textareaRef.current?.focus();
  }

  function selectChat(id: string): void {
    if (busy || deletingId || id === activeId) return;
    setActiveId(id);
    setMessage("");
    setError(null);
    setSidebarOpen(false);
  }

  async function deleteChat(chat: ConversationSummary): Promise<void> {
    if (busy || deletingId || !conversations.some(item => item.id === chat.id)) return;
    if (!window.confirm(`${t.confirmDeleteChat}\n\n${chat.title}`)) return;

    setDeletingId(chat.id);
    setError(null);
    try {
      await clearConversation(chat.id);
      const remaining = conversations.filter(item => item.id !== chat.id);
      const next = remaining.length ? remaining : [{ id: crypto.randomUUID(), title: t.untitledChat }];
      setConversations(next);
      if (activeId === chat.id) {
        setActiveId(next[0].id);
        setMessage("");
      }
    } catch {
      setError(t.deleteChatError);
    } finally {
      setDeletingId(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const prompt = message.trim();
    if (!prompt || busy || deletingId || historyLoading) return;
    if (!modelReady) { setError(t.connectionError); return; }
    setBusy(true);
    setError(null);

    try {
      const result = await model.generateConversationWithSources(recentMessages(history, prompt), model.searchAvailable ? webSearchMode : "off");
      const now = Date.now();
      const entries: ConversationMessage[] = [
        { id: crypto.randomUUID(), conversationId: activeId, role: "user", content: prompt, createdAt: new Date(now).toISOString() },
        { id: crypto.randomUUID(), conversationId: activeId, role: "assistant", content: result.answer, sources: result.sources, searchWarning: result.searchWarning, createdAt: new Date(now + 1).toISOString() }
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
          <a className="developer-credit" href="https://stankowspas.github.io/"
            title="Developer website">Developer website</a>
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
        <button className="new-chat" type="button" onClick={openNewChat} disabled={busy || deletingId !== null}>
          <span aria-hidden="true">＋</span><span>{t.newChat}</span>
        </button>
        <h2 className="sidebar-heading">{t.conversations}</h2>
        <nav className="conversation-list" aria-label={t.conversations}>
          {conversations.map(chat => <div className={`conversation-row ${chat.id === activeId ? "is-active" : ""}`} key={chat.id}>
            <button type="button" onClick={() => selectChat(chat.id)}
              className={`conversation-link ${chat.id === activeId ? "is-active" : ""}`}
              aria-current={chat.id === activeId ? "page" : undefined} disabled={busy || deletingId !== null}>
              <span className="conversation-glyph" aria-hidden="true">▤</span>
              <span className="conversation-title">{chat.title}</span>
            </button>
            <button type="button" className="delete-chat" onClick={() => void deleteChat(chat)}
              disabled={busy || deletingId !== null}
              aria-label={`${t.deleteChat}: ${chat.title}`} title={t.deleteChat}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h16M10 4h4M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />
              </svg>
            </button>
          </div>)}
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
                {item.role === "assistant" && Boolean(item.sources?.length) && <div className="web-sources">
                  <strong>{t.webSources}</strong>
                  {item.sources?.filter(source => {
                    try {
                      const url = new URL(source.url);
                      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
                    } catch { return false; }
                  }).map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                    [{index + 1}] {source.title}
                  </a>)}
                </div>}
                {item.role === "assistant" && item.searchWarning && <p className="web-warning">{t.webUnavailable}</p>}
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
              onKeyDown={handleComposerKeyDown} rows={2}
              placeholder={modelReady ? t.placeholder : t.connecting} disabled={busy || deletingId !== null || !modelReady || historyLoading} />
            <button className="send-button" type="submit" disabled={busy || deletingId !== null || !modelReady || historyLoading || !message.trim()}
              aria-label={t.send}><span aria-hidden="true">➤</span><span className="send-label">{t.send}</span></button>
          </form>
          <div className="composer-bottom">
            {modelReady && model.searchAvailable && <label className="web-search-setting" htmlFor="web-search-mode">
              <span aria-hidden="true">◎</span> {t.webSearchLabel}
              <select id="web-search-mode" value={webSearchMode}
                onChange={event => setWebSearchMode(event.target.value as WebSearchMode)} disabled={busy}>
                <option value="auto">{t.webAuto}</option>
                <option value="on">{t.webOn}</option>
                <option value="off">{t.webOff}</option>
              </select>
            </label>}
            <p className="composer-hint">{t.promptHint}</p>
          </div>
        </div>
      </section>
    </div>
  </main>;
}
