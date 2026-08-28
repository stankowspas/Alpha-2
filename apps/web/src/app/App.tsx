import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ApplicationCore,
  type ChatMode,
  type ResponseDepth,
  type TaskPlan
} from "@alpha/ai-core";
import { PRODUCT_BRANDING } from "@alpha/branding";
import { listConversationMessages, saveConversationMessage, type ConversationMessage } from "@alpha/memory";
import { RemoteGeminiModelAdapter, type ModelGenerationMetadata } from "@alpha/models";

const depths: ResponseDepth[] = ["LOW", "MEDIUM", "HIGH"];
const modes: ChatMode[] = ["FAST", "THINKING"];
const CONVERSATION_ID = "alpha-default";
const DEV_AI_ENDPOINT = "http://127.0.0.1:5177";
const AI_ENDPOINT = (import.meta.env.VITE_AI_ENDPOINT || (import.meta.env.DEV ? DEV_AI_ENDPOINT : "")).replace(/\/$/, "");

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
  const model = useMemo(() => new RemoteGeminiModelAdapter({
    baseUrl: AI_ENDPOINT || window.location.origin
  }), []);
  const core = useMemo(() => new ApplicationCore(model), [model]);
  const abortRef = useRef<AbortController | null>(null);
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
  const [notice, setNotice] = useState(AI_ENDPOINT ? "Свържи Alpha 2 с безплатния AI backend." : "PWA е готова, но production AI backend не е конфигуриран.");
  const [developerMode, setDeveloperMode] = useState(true);
  const [taskDebug, setTaskDebug] = useState<TaskDebugState | null>(null);

  useEffect(() => {
    void listConversationMessages(CONVERSATION_ID).then(setHistory).catch(() => undefined);
  }, []);

  async function loadModel() {
    if (!AI_ENDPOINT) {
      setNotice("Липсва VITE_AI_ENDPOINT за production PWA.");
      return;
    }
    if (loadingModel || modelLoaded) return;
    setLoadingModel(true);
    setNotice("Проверка на Alpha 2 AI backend...");
    try {
      await core.loadModel((value, text) => {
        setProgress(Math.round(value * 100));
        setNotice(text);
      });
      setModelLoaded(true);
      setNotice("Безплатният Gemini backend е готов.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI backend не може да бъде зареден.");
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
    setNotice(mode === "THINKING" ? "Thinking..." : "Генериране...");
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
        setNotice(`Отговорът е блокиран от execution/verification gate: ${result.failureReason ?? "непотвърден резултат"}`);
        return;
      }

      // Finalized result is the source of truth. This also renders deterministic
      // Direct execution result remains the source of truth after finalization.
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
      setNotice("TASK_COMPLETE — отговорът премина приложимите final gates.");
    } catch (error) {
      if (controller.signal.aborted) setNotice("Генерирането е спряно.");
      else setNotice(error instanceof Error ? error.message : "Inference/execution грешка.");
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
        <div className="status-stack" aria-live="polite">
          <span className={modelLoaded ? "status ok" : "status warn"}>AI backend: {modelLoaded ? "готов" : "не е свързан"}</span>
          <span className={modelRuntime ? "status ok" : "status warn"}>Model: {modelRuntime?.actualModel ?? "не е избран"}{modelRuntime?.fallbackUsed ? " (fallback)" : ""}</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar" aria-label="Разговори">
          <button type="button" className="primary">+ Нов чат</button>
          <p className="muted">Локално записани съобщения: {history.length}</p>
          <div className="diagnostic"><strong>Provider</strong><span>{modelRuntime?.provider ?? "g4f-gemini / free-only"}</span></div>
          <div className="diagnostic">
            <strong>Developer Mode</strong>
            <button type="button" className="secondary" onClick={() => setDeveloperMode((value) => !value)}>
              {developerMode ? "Изключи" : "Включи"}
            </button>
          </div>
        </aside>
        <section className="chat-panel">
          <div className="empty-state">
            <h2>Alpha Chat 2.0</h2>
            <p>Inference се изпълнява през локалния Alpha AI backend и разрешени безплатни Gemini модели. Няма локален model inference.</p>
            <button type="button" className="primary" onClick={loadModel} disabled={loadingModel || modelLoaded}>
              {modelLoaded ? "AI backend е готов" : loadingModel ? `Проверка ${progress}%` : "Свържи AI backend"}
            </button>
          </div>

          <div className="control-row"><fieldset><legend>Режим</legend>{modes.map((item) => <button key={item} type="button" className={mode === item ? "selected" : ""} onClick={() => setMode(item)}>{item === "FAST" ? "Fast" : "Thinking"}</button>)}</fieldset><fieldset><legend>Ниво на отговор</legend>{depths.map((item) => <button key={item} type="button" className={depth === item ? "selected" : ""} onClick={() => setDepth(item)}>{item}</button>)}</fieldset></div>

          <p className="notice" aria-live="polite">{notice}</p>

          {developerMode && taskDebug && (
            <details className="answer debug-panel" open>
              <summary>Developer — Task Engine</summary>
              <div className="debug-grid">
                <div><strong>Publishable</strong><span>{taskDebug.publishable ? "yes" : "no"}</span></div>
                <div><strong>Finalization</strong><span>{taskDebug.finalizationStatus ?? "not reached"}</span></div>
                <div><strong>Citations</strong><span>{taskDebug.citationCount}</span></div>
                <div><strong>Task ID</strong><span>{taskDebug.plan.taskId}</span></div>
                <div><strong>Task status</strong><span>{taskDebug.plan.status}</span></div>
                <div><strong>Steps</strong><span>{taskDebug.plan.steps.length}</span></div>
              </div>
              {taskDebug.failureReason && <div className="debug-block"><strong>Blocked reason</strong><p>{taskDebug.failureReason}</p></div>}
              {taskDebug.plan.constraints && taskDebug.plan.constraints.length > 0 && (
                <div className="debug-block"><strong>Hard constraints</strong><ul>{taskDebug.plan.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul></div>
              )}
              <div className="debug-block">
                <strong>Task plan</strong>
                <ol>{taskDebug.plan.steps.map((step) => <li key={step.id}><code>{step.id}</code> — {step.goal} <span className="muted">[{step.kind}; {step.status}; depends: {step.dependsOn.length ? step.dependsOn.join(", ") : "none"}]</span></li>)}</ol>
              </div>
              <p className="muted">GENERATION_COMPLETE не означава STEP_COMPLETE. User-visible отговор се пази само след Completion/Finalization gates.</p>
            </details>
          )}

          {thinking && <details className="answer thinking" open={generating}><summary>Мислене / Анализ</summary><pre>{thinking}</pre></details>}
          {answer && <article className="answer" aria-live="polite"><h3>Отговор</h3><pre>{answer}</pre></article>}
          {citations.length > 0 && (
            <section className="answer" aria-label="Източници">
              <h3>Източници</h3>
              <ol>
                {citations.map((citation) => (
                  <li key={citation.citationId}>
                    <a href={citation.canonicalUrl} target="_blank" rel="noreferrer">{citation.sourceTitle}</a>
                    <div className="muted">Подкрепя: {citation.claimText}</div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <form className="composer" onSubmit={onSubmit}><label htmlFor="message">Съобщение</label><div className="composer-row"><textarea id="message" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Напиши съобщение..." rows={3} disabled={!modelLoaded || generating} />{generating ? <button type="button" className="secondary" onClick={stopGeneration}>Стоп</button> : <button type="submit" className="primary" disabled={!modelLoaded}>Изпрати</button>}</div></form>
        </section>
      </section>
    </main>
  );
}
