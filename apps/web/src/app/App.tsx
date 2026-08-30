import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ApplicationCore,
  type ChatMode,
  type ResponseDepth,
  type TaskPlan
} from "@alpha/ai-core";
import { PRODUCT_BRANDING } from "@alpha/branding";
import { listConversationMessages, saveConversationMessage, type ConversationMessage } from "@alpha/memory";
import { BrowserGeminiModelAdapter, type ModelGenerationMetadata } from "@alpha/models";
import { getInitialLocale, persistLocale, UI_LANGUAGES, UI_MESSAGES, type UiLocale } from "../i18n";

const depths: ResponseDepth[] = ["LOW", "MEDIUM", "HIGH"];
const modes: ChatMode[] = ["FAST", "THINKING"];
const CONVERSATION_ID = "alpha-default";
const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY || "").trim();

interface TaskDebugState {
  plan: TaskPlan;
  publishable: boolean;
  finalizationStatus?: string;
  failureReason?: string;
  citationCount: number;
}

interface UiCitation {
  citationId: string;
  sourceTitle: string;
  canonicalUrl: string;
  claimText: string;
}

export function App() {
  const model = useMemo(() => new BrowserGeminiModelAdapter({ apiKey: GEMINI_API_KEY }), []);
  const core = useMemo(() => new ApplicationCore(model), [model]);
  const abortRef = useRef<AbortController | null>(null);
  const [locale, setLocale] = useState<UiLocale>(getInitialLocale);
  const t = UI_MESSAGES[locale];
  const [depth, setDepth] = useState<ResponseDepth>("MEDIUM");
  const [mode, setMode] = useState<ChatMode>("FAST");
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState("");
  const [citations, setCitations] = useState<UiCitation[]>([]);
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [loadingModel, setLoadingModel] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelRuntime, setModelRuntime] = useState<ModelGenerationMetadata | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState(() => {
    const initial = UI_MESSAGES[getInitialLocale()];
    return GEMINI_API_KEY ? initial.connectPrompt : initial.productionMissing;
  });
  const [developerMode, setDeveloperMode] = useState(true);
  const [taskDebug, setTaskDebug] = useState<TaskDebugState | null>(null);

  useEffect(() => {
    void listConversationMessages(CONVERSATION_ID).then(setHistory).catch(() => undefined);
  }, []);

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

  async function loadModel() {
    if (!GEMINI_API_KEY) {
      setNotice(t.missingEndpoint);
      return;
    }
    if (loadingModel || modelLoaded) return;
    setLoadingModel(true);
    setNotice(t.checkingBackend);
    try {
      await core.loadModel((value, text) => {
        setProgress(Math.round(value * 100));
        setNotice(text);
      });
      setModelLoaded(true);
      setNotice(t.freeBackendReady);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.backendLoadFailed);
    } finally {
      setLoadingModel(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !modelLoaded || generating) return;

    setInput("");
    setAnswer("");
    setThinking("");
    setCitations([]);
    setTaskDebug(null);
    setGenerating(true);
    setNotice(mode === "THINKING" ? `${t.thinkingMode}...` : t.generating);
    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(), conversationId: CONVERSATION_ID, role: "user", content: text, createdAt: new Date().toISOString()
    };
    await saveConversationMessage(userMessage);
    setHistory((current) => [...current, userMessage]);

    try {
      const result = await core.generate({
        text,
        mode,
        depth,
        signal: controller.signal,
        onAnswerToken: (token) => setAnswer((current) => current + token),
        onThinkingToken: (token) => setThinking((current) => current + token)
      });

      setModelRuntime(model.lastGenerationMetadata ?? null);

      const finalizedCitations = result.citations?.citations ?? [];
      setTaskDebug({
        plan: result.taskPlan,
        publishable: result.publishable,
        finalizationStatus: result.finalizationStatus,
        failureReason: result.failureReason,
        citationCount: finalizedCitations.length
      });

      if (!result.publishable) {
        setAnswer("");
        setThinking("");
        setCitations([]);
        setNotice(`${t.blockedPrefix}: ${result.failureReason ?? t.unverifiedResult}`);
        return;
      }

      setAnswer(result.answer);
      setThinking(result.thinking);
      setCitations(finalizedCitations.map((citation) => ({
        citationId: citation.citationId,
        sourceTitle: citation.sourceTitle,
        canonicalUrl: citation.canonicalUrl,
        claimText: citation.claimText
      })));

      const assistantMessage: ConversationMessage = {
        id: crypto.randomUUID(),
        conversationId: CONVERSATION_ID,
        role: "assistant",
        content: result.answer,
        thinking: result.thinking || undefined,
        createdAt: new Date().toISOString()
      };
      await saveConversationMessage(assistantMessage);
      setHistory((current) => [...current, assistantMessage]);
      setNotice(t.taskComplete);
    } catch (error) {
      if (controller.signal.aborted) setNotice(t.generationStopped);
      else setNotice(error instanceof Error ? error.message : t.inferenceError);
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  function stopGeneration() { abortRef.current?.abort(); }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">{PRODUCT_BRANDING.version}</p><h1>{PRODUCT_BRANDING.officialName}</h1><p className="subtitle">Developed by {PRODUCT_BRANDING.developer}</p></div>
        <div className="topbar-tools">
          <label className="language-picker">
            <span className="language-icon" aria-hidden="true">◎</span>
            <span className="language-label">{t.language}</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value as UiLocale)} aria-label={t.language}>
              {UI_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
            </select>
          </label>
          <div className="status-stack" aria-live="polite">
            <span className={modelLoaded ? "status ok" : "status warn"}>{t.aiBackend}: {modelLoaded ? t.ready : t.disconnected}</span>
            <span className={modelRuntime ? "status ok" : "status warn"}>{t.model}: {modelRuntime?.actualModel ?? t.notSelected}{modelRuntime?.fallbackUsed ? " (fallback)" : ""}</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar" aria-label={t.conversations}>
          <button type="button" className="primary">{t.newChat}</button>
          <p className="muted">{t.savedMessages}: {history.length}</p>
          <div className="diagnostic"><strong>{t.provider}</strong><span>{modelRuntime?.provider ?? "gemini-api-browser"}</span></div>
          <div className="diagnostic">
            <strong>{t.developerMode}</strong>
            <button type="button" className="secondary" onClick={() => setDeveloperMode((value) => !value)}>
              {developerMode ? t.disable : t.enable}
            </button>
          </div>
        </aside>
        <section className="chat-panel">
          <div className="empty-state">
            <h2>Alpha Chat 2.0</h2>
            <p>{t.intro}</p>
            <button type="button" className="primary" onClick={loadModel} disabled={loadingModel || modelLoaded}>
              {modelLoaded ? t.backendReady : loadingModel ? `${t.checking} ${progress}%` : t.connectBackend}
            </button>
          </div>

          <div className="control-row"><fieldset><legend>{t.mode}</legend>{modes.map((item) => <button key={item} type="button" className={mode === item ? "selected" : ""} onClick={() => setMode(item)}>{item === "FAST" ? t.fast : t.thinkingMode}</button>)}</fieldset><fieldset><legend>{t.responseLevel}</legend>{depths.map((item) => <button key={item} type="button" className={depth === item ? "selected" : ""} onClick={() => setDepth(item)}>{item}</button>)}</fieldset></div>

          <p className="notice" aria-live="polite">{notice}</p>

          {developerMode && taskDebug && (
            <details className="answer debug-panel" open>
              <summary>{t.developerTaskEngine}</summary>
              <div className="debug-grid">
                <div><strong>{t.publishable}</strong><span>{taskDebug.publishable ? "yes" : "no"}</span></div>
                <div><strong>{t.finalization}</strong><span>{taskDebug.finalizationStatus ?? "not reached"}</span></div>
                <div><strong>{t.citations}</strong><span>{taskDebug.citationCount}</span></div>
                <div><strong>{t.taskId}</strong><span>{taskDebug.plan.taskId}</span></div>
                <div><strong>{t.taskStatus}</strong><span>{taskDebug.plan.status}</span></div>
                <div><strong>{t.steps}</strong><span>{taskDebug.plan.steps.length}</span></div>
              </div>
              {taskDebug.failureReason && <div className="debug-block"><strong>{t.blockedReason}</strong><p>{taskDebug.failureReason}</p></div>}
              {taskDebug.plan.constraints && taskDebug.plan.constraints.length > 0 && (
                <div className="debug-block"><strong>{t.hardConstraints}</strong><ul>{taskDebug.plan.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul></div>
              )}
              <div className="debug-block">
                <strong>{t.taskPlan}</strong>
                <ol>{taskDebug.plan.steps.map((step) => <li key={step.id}><code>{step.id}</code> — {step.goal} <span className="muted">[{step.kind}; {step.status}; depends: {step.dependsOn.length ? step.dependsOn.join(", ") : t.none}]</span></li>)}</ol>
              </div>
              <p className="muted">{t.generationNote}</p>
            </details>
          )}

          {thinking && <details className="answer thinking" open={generating}><summary>{t.thinkingAnalysis}</summary><pre>{thinking}</pre></details>}
          {answer && <article className="answer" aria-live="polite"><h3>{t.answer}</h3><pre>{answer}</pre></article>}
          {citations.length > 0 && (
            <section className="answer" aria-label={t.sources}>
              <h3>{t.sources}</h3>
              <ol>
                {citations.map((citation) => (
                  <li key={citation.citationId}>
                    <a href={citation.canonicalUrl} target="_blank" rel="noreferrer">{citation.sourceTitle}</a>
                    <div className="muted">{t.supports}: {citation.claimText}</div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <form className="composer" onSubmit={onSubmit}><label htmlFor="message">{t.message}</label><div className="composer-row"><textarea id="message" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={t.placeholder} rows={3} disabled={!modelLoaded || generating} />{generating ? <button type="button" className="secondary" onClick={stopGeneration}>{t.stop}</button> : <button type="submit" className="primary" disabled={!modelLoaded}>{t.send}</button>}</div></form>
        </section>
      </section>
    </main>
  );
}
