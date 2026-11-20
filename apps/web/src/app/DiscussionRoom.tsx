import { type FormEvent, useEffect, useRef, useState } from "react";
import "./discussion.css";
import { CloudflareGemmaAdapter, MODEL_LABELS, type AiModelId, type WebSearchMode } from "./cloudflare-gemma";
import {
  activeDiscussionModels, availableSummarySpeaker, buildSummaryMessages, buildTurnMessages,
  canResumeDiscussion, createDiscussionSession, isProviderQuotaError, markModelQuotaLimited,
  DISCUSSION_MODE_NAMES, DISCUSSION_PARTICIPANTS, roundSpeakers,
  type DiscussionEntry, type DiscussionMode, type DiscussionSession, type ParticipationMode,
} from "./discussion-engine";

const ACTIVE_KEY = "alpha2-discussion-active-v1";
const ARCHIVE_KEY = "alpha2-discussion-archive-v1";
const MAX_ARCHIVED = 15;

const BG = {
  heading: "AI дискусии", back: "Обикновен чат", new: "Нова дискусия",
  setup: "Настройки на дискусията", topic: "Тема или въпрос",
  topicHint: "Въведи тема, която трите модела да обсъдят…",
  mode: "Режим", participation: "Управление", autonomous: "Автономно",
  participatory: "С мое участие", master: "Избери Master", rounds: "Кръгове",
  start: "Започни дискусията", resume: "Продължи", pause: "Пауза",
  stop: "Стоп", summary: "Финално обобщение",
  waiting: "Очаква твоето участие между кръговете", paused: "На пауза",
  running: "Дискусията продължава", finished: "Приключена", stopped: "Прекратена",
  error: "Грешка — можеш да опиташ отново", retry: "Опитай отново",
  intervene: "Твоето мнение, въпрос или нова насока…", send: "Изпрати",
  noModels: "Необходим е поне един активен AI модел. Недостъпни:",
  round: "Кръг", of: "от", turns: "Изказвания", noTurns: "Подготвя се първото изказване…",
  archive: "Предишни дискусии", restore: "Отвори", delete: "Изтрий",
  emptyArchive: "Все още няма предишни дискусии.",
  webOn: "Интернет търсенето използва текущата настройка на чата.",
  webOff: "Интернет търсенето е изключено или недостъпно.",
  data: "Историята на дискусиите се пази само в този браузър.",
  waitingHint: "Можеш да се включиш или направо да продължиш към следващия кръг.",
  abortHint: "Пауза прекъсва текущата заявка. Продължи я с бутона по-долу.",
  sources: "Източници", searchWarning: "Уеб търсенето не е потвърдено за този отговор.",
  finishedHint: "Можеш да започнеш нова дискусия или да отвориш предишна.",
  quotaNotice: "Лимит на квотата — пропуснат модел:",
  quotaRetry: "Пробвай отпадналите отново",
  noneAvailable: "Няма останали достъпни модели. Историята е запазена; можеш ръчно да опиташ отпадналите модели отново.",
};

const EN: typeof BG = {
  heading: "AI discussions", back: "Regular chat", new: "New discussion",
  setup: "Discussion settings", topic: "Topic or question",
  topicHint: "Enter a topic for the three models to discuss…",
  mode: "Mode", participation: "Control", autonomous: "Autonomous",
  participatory: "With my participation", master: "Choose Master", rounds: "Rounds",
  start: "Start discussion", resume: "Continue", pause: "Pause",
  stop: "Stop", summary: "Final summary",
  waiting: "Waiting for your input between rounds", paused: "Paused",
  running: "Discussion in progress", finished: "Completed", stopped: "Stopped",
  error: "Error — you can try again", retry: "Retry",
  intervene: "Your opinion, question or new direction…", send: "Send",
  noModels: "At least one AI model must be active. Unavailable:",
  round: "Round", of: "of", turns: "Contributions", noTurns: "Preparing the first contribution…",
  archive: "Previous discussions", restore: "Open", delete: "Delete",
  emptyArchive: "No previous discussions yet.",
  webOn: "Web search uses the current chat setting.",
  webOff: "Web search is disabled or unavailable.",
  data: "Discussion history is stored only in this browser.",
  waitingHint: "You can contribute or continue to the next round.",
  abortHint: "Pause cancels the active request. Use Continue to retry it.",
  sources: "Sources", searchWarning: "Web search was not confirmed for this response.",
  finishedHint: "Start a new discussion or open a previous one.",
  quotaNotice: "Quota limit — skipped model:",
  quotaRetry: "Retry excluded models",
  noneAvailable: "No active models remain. The history is saved; you can manually retry excluded models.",
};

function validSession(value: unknown): value is DiscussionSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DiscussionSession>;
  return typeof v.id === "string" && typeof v.topic === "string"
    && Object.hasOwn(DISCUSSION_MODE_NAMES, v.mode ?? "")
    && (v.participation === "autonomous" || v.participation === "participatory")
    && DISCUSSION_PARTICIPANTS.includes(v.master as AiModelId)
    && typeof v.maxRounds === "number" && v.maxRounds >= 1 && v.maxRounds <= 5
    && Number.isInteger(v.roundIndex) && Number.isInteger(v.speakerIndex)
    && v.roundIndex! >= 0 && v.speakerIndex! >= 0 && Array.isArray(v.entries)
    && typeof v.status === "string";
}

function loadActive(): DiscussionSession | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
    if (validSession(value)) return value.status === "running" ? { ...value, status: "paused" } : value;
  } catch { /* no storage available */ }
  return null;
}

function loadArchive(): DiscussionSession[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "null");
    if (Array.isArray(value)) return value.filter(validSession).slice(0, MAX_ARCHIVED);
  } catch { /* no storage available */ }
  return [];
}

function writeStorage(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* discussion continues without persistent storage */ }
}

function safeSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

type Props = {
  adapter: CloudflareGemmaAdapter;
  modelReady: boolean;
  webSearchMode: WebSearchMode;
  locale: string;
  onBack: () => void;
};

export function DiscussionRoom({ adapter, modelReady, webSearchMode, locale, onBack }: Props) {
  const t = locale === "bg" ? BG : EN;
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<DiscussionMode>("discussion");
  const [participation, setParticipation] = useState<ParticipationMode>("autonomous");
  const [master, setMaster] = useState<AiModelId>("gpt-oss-120b");
  const [rounds, setRounds] = useState(2);
  const [intervention, setIntervention] = useState("");
  const [session, setSession] = useState<DiscussionSession | null>(loadActive);
  const [archive, setArchive] = useState<DiscussionSession[]>(loadArchive);
  const [executing, setExecuting] = useState(false);
  const [speaking, setSpeaking] = useState<AiModelId | null>(null);
  const sessionRef = useRef(session);
  const executingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const missing = DISCUSSION_PARTICIPANTS.filter(id => !adapter.availableModels[id]);
  const ready = modelReady && missing.length < DISCUSSION_PARTICIPANTS.length;

  function publish(next: DiscussionSession | null): void {
    sessionRef.current = next;
    setSession(next);
    writeStorage(ACTIVE_KEY, next);
  }

  function storeArchive(items: DiscussionSession[]): void {
    const bounded = items.slice(0, MAX_ARCHIVED);
    setArchive(bounded);
    writeStorage(ARCHIVE_KEY, bounded);
  }

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [session?.entries.length, session?.status, speaking]);

  useEffect(() => () => {
    cancelledRef.current = true;
    controllerRef.current?.abort();
    const current = sessionRef.current;
    if (current?.status === "running") {
      writeStorage(ACTIVE_KEY, { ...current, status: "paused" });
    }
  }, []);

  function rememberCurrent(): void {
    const current = sessionRef.current;
    if (current?.entries.length) {
      storeArchive([{ ...current, status: current.status === "running" ? "paused" : current.status },
        ...archive.filter(item => item.id !== current.id)]);
    }
  }

  function newDiscussion(): void {
    if (executingRef.current) return;
    rememberCurrent();
    publish(null);
    setIntervention("");
    setTopic("");
  }

  function restoreDiscussion(chosen: DiscussionSession): void {
    if (executingRef.current) return;
    const current = sessionRef.current;
    const retained = archive.filter(item => item.id !== chosen.id && item.id !== current?.id);
    if (current?.entries.length) retained.unshift(current);
    storeArchive(retained);
    publish(chosen.status === "running" ? { ...chosen, status: "paused" } : chosen);
    setIntervention("");
  }

  function interrupt(stop: boolean): void {
    cancelledRef.current = true;
    controllerRef.current?.abort();
    const current = sessionRef.current;
    if (current && current.status !== "finished") publish({ ...current, status: stop ? "stopped" : "paused" });
  }

  async function run(initial?: DiscussionSession): Promise<void> {
    if (!ready || executingRef.current) return;
    let current = initial || sessionRef.current;
    if (!current || !canResumeDiscussion(current.status)) return;
    executingRef.current = true;
    cancelledRef.current = false;
    setExecuting(true);
    current = { ...current, status: "running", error: undefined };
    publish(current);
    try {
      while (!cancelledRef.current) {
        if (!activeDiscussionModels(current, adapter.availableModels).length) {
          current = { ...current, status: "error", error: t.noneAvailable };
          publish(current);
          break;
        }

        if (current.roundIndex >= current.maxRounds) {
          // If the usual moderator (or Master) is quota-limited, another active model
          // writes the summary. A second rate limit moves on to the last candidate.
          const summarizer = availableSummarySpeaker(current, adapter.availableModels);
          if (!summarizer) break;
          setSpeaking(summarizer);
          const controller = new AbortController();
          controllerRef.current = controller;
          try {
            const result = await adapter.generateConversationWithSources(
              buildSummaryMessages(current), adapter.searchAvailable ? webSearchMode : "off", controller.signal, summarizer,
            );
            if (cancelledRef.current || controller.signal.aborted) break;
            const entry: DiscussionEntry = {
              id: crypto.randomUUID(), author: "model", modelId: summarizer, summary: true,
              round: current.maxRounds, content: result.answer, sources: result.sources,
              searchWarning: result.searchWarning, createdAt: new Date().toISOString(),
            };
            current = { ...current, entries: [...current.entries, entry], status: "finished" };
            publish(current);
            break;
          } catch (cause) {
            if (cancelledRef.current || controller.signal.aborted) break;
            if (!isProviderQuotaError(cause)) throw cause;
            current = markModelQuotaLimited(current, summarizer);
            publish(current);
            continue;
          }
        }

        const speakers = roundSpeakers(current.mode, current.master);
        if (current.speakerIndex >= speakers.length) {
          current = {
            ...current, roundIndex: current.roundIndex + 1, speakerIndex: 0,
            status: current.participation === "participatory" ? "waiting" : "running",
          };
          publish(current);
          if (current.status === "waiting") break;
          continue;
        }

        const speaker = speakers[current.speakerIndex];
        if (!adapter.availableModels[speaker] || (current.limitedModels || []).includes(speaker)) {
          current = { ...current, speakerIndex: current.speakerIndex + 1 };
          publish(current);
          continue;
        }
        setSpeaking(speaker);
        const controller = new AbortController();
        controllerRef.current = controller;
        try {
          const result = await adapter.generateConversationWithSources(
            buildTurnMessages(current, speaker, current.speakerIndex),
            adapter.searchAvailable ? webSearchMode : "off", controller.signal, speaker,
          );
          if (cancelledRef.current || controller.signal.aborted) break;
          const entry: DiscussionEntry = {
            id: crypto.randomUUID(), author: "model", modelId: speaker,
            round: current.roundIndex + 1, content: result.answer,
            sources: result.sources, searchWarning: result.searchWarning,
            createdAt: new Date().toISOString(),
          };
          current = { ...current, speakerIndex: current.speakerIndex + 1, entries: [...current.entries, entry] };
          publish(current);
        } catch (cause) {
          if (cancelledRef.current || controller.signal.aborted) break;
          if (!isProviderQuotaError(cause)) throw cause;
          current = {
            ...markModelQuotaLimited(current, speaker),
            speakerIndex: current.speakerIndex + 1,
          };
          publish(current);
          // Do not retry this provider in later rounds of this discussion.
        }
      }
    } catch (cause) {
      if (!cancelledRef.current) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const latest = sessionRef.current;
        if (latest) publish({ ...latest, status: "error", error: message });
      }
    } finally {
      controllerRef.current = null;
      executingRef.current = false;
      setExecuting(false);
      setSpeaking(null);
    }
  }

  function retryLimitedModels(): void {
    const current = sessionRef.current;
    if (!current || executingRef.current || !current.limitedModels?.length || current.status === "finished") return;
    // Only an explicit user action clears exclusions. No background quota retries.
    publish({ ...current, limitedModels: [], status: "paused", error: undefined });
  }

  function start(): void {
    if (!ready || !topic.trim() || executingRef.current) return;
    const next = createDiscussionSession(topic.slice(0, 2000), mode, participation, master, rounds);
    publish(next);
    void run(next);
  }

  function submitIntervention(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const content = intervention.trim();
    const current = sessionRef.current;
    if (!content || !current || current.participation !== "participatory"
      || (current.status !== "waiting" && current.status !== "paused" && current.status !== "error")
      || executingRef.current) return;
    const entry: DiscussionEntry = {
      id: crypto.randomUUID(), author: "user", content,
      round: Math.min(current.maxRounds, current.roundIndex + 1),
      createdAt: new Date().toISOString(),
    };
    publish({ ...current, entries: [...current.entries, entry] });
    setIntervention("");
  }

  return <section className="chat-panel discussion-panel" aria-label={t.heading}>
    <div className="discussion-header">
      <div>
        <h2>{t.heading}</h2>
        <p>{t.data}</p>
      </div>
      <div className="discussion-header-actions">
        {session && <button type="button" onClick={newDiscussion} disabled={executing}>{t.new}</button>}
        <button type="button" onClick={onBack}>{t.back}</button>
      </div>
    </div>

    {!session ? <div className="discussion-setup">
      <h3>{t.setup}</h3>
      <label htmlFor="discussion-topic">{t.topic}</label>
      <textarea id="discussion-topic" rows={3} maxLength={2000}
        value={topic} onChange={event => setTopic(event.target.value)} placeholder={t.topicHint} />
      <div className="discussion-form-grid">
        <label>{t.mode}
          <select value={mode} onChange={event => setMode(event.target.value as DiscussionMode)}>
            {(Object.keys(DISCUSSION_MODE_NAMES) as DiscussionMode[]).map(id =>
              <option key={id} value={id}>{DISCUSSION_MODE_NAMES[id]}</option>)}
          </select>
        </label>
        <label>{t.participation}
          <select value={participation} onChange={event => setParticipation(event.target.value as ParticipationMode)}>
            <option value="autonomous">{t.autonomous}</option>
            <option value="participatory">{t.participatory}</option>
          </select>
        </label>
        <label>{t.rounds}
          <select value={rounds} onChange={event => setRounds(Number(event.target.value))}>
            {[1, 2, 3, 4, 5].map(number => <option key={number} value={number}>{number}</option>)}
          </select>
        </label>
        {mode === "master" && <label>{t.master}
          <select value={master} onChange={event => setMaster(event.target.value as AiModelId)}>
            {DISCUSSION_PARTICIPANTS.map(id => <option key={id} value={id}>{MODEL_LABELS[id]}</option>)}
          </select>
        </label>}
      </div>
      {!ready && <p className="discussion-notice" role="alert">{t.noModels} {missing.map(id => MODEL_LABELS[id]).join(", ")}</p>}
      <p className="discussion-hint">{adapter.searchAvailable && webSearchMode !== "off" ? t.webOn : t.webOff}</p>
      <button type="button" className="discussion-primary" onClick={start} disabled={!ready || !topic.trim()}>{t.start}</button>
    </div> : <>
      <div className="discussion-session-info">
        <strong>{session.topic}</strong>
        <div><span>{DISCUSSION_MODE_NAMES[session.mode]}</span><span>{session.participation === "autonomous" ? t.autonomous : t.participatory}</span>
          <span>{t.round} {Math.min(session.roundIndex + 1, session.maxRounds)} {t.of} {session.maxRounds}</span>
          <span>{t.turns}: {session.entries.filter(entry => entry.author === "model" && !entry.summary).length}</span>
          {session.mode === "master" && <span>Master: {MODEL_LABELS[session.master]}</span>}
          {(session.limitedModels || []).map(id => <span key={id}>{t.quotaNotice} {MODEL_LABELS[id]}</span>)}
        </div>
      </div>
      <div className="chat-scroll" ref={scrollRef}>
        <div className="messages discussion-messages">
          {session.entries.map(entry => <article key={entry.id}
            className={`message-item ${entry.author === "user" ? "from-user" : "from-ai"} ${entry.summary ? "discussion-summary" : ""}`}>
            <div className="message-avatar" aria-hidden="true">{entry.author === "user" ? "U" : "✦"}</div>
            <div className="message-body">
              <div className="message-author">
                {entry.summary ? t.summary + " — " : ""}
                {entry.author === "user" ? (locale === "bg" ? "Ти" : "You") : MODEL_LABELS[entry.modelId || "gemma4"]}
                {!entry.summary && <span className="discussion-round-label"> · {t.round} {entry.round}</span>}
              </div>
              <div className="message-bubble">{entry.content}</div>
              {Boolean(entry.sources?.length) && <div className="web-sources">
                <strong>{t.sources}</strong>
                {entry.sources?.filter(source => safeSource(source.url)).map((source, index) =>
                  <a key={source.url + index} href={source.url} target="_blank" rel="noopener noreferrer">
                    [{index + 1}] {source.title}
                  </a>)}
              </div>}
              {entry.searchWarning && <p className="web-warning">{t.searchWarning}</p>}
            </div>
          </article>)}
          {executing && <div className="message-item from-ai">
            <div className="message-avatar" aria-hidden="true">✦</div>
            <div className="message-body">
              <div className="message-author">{speaking ? MODEL_LABELS[speaking] : t.summary}</div>
              <div className="message-bubble thinking-bubble"><span className="typing-dots" aria-hidden="true"><i/><i/><i/></span>{t.running}</div>
            </div>
          </div>}
          {!session.entries.length && !executing && <p className="discussion-hint">{t.noTurns}</p>}
        </div>
      </div>
      <div className="discussion-footer">
        <div className="discussion-status" role="status">
          <span>{session.status === "running" ? t.running : session.status === "waiting" ? t.waiting
            : session.status === "paused" ? t.paused : session.status === "finished" ? t.finished
              : session.status === "stopped" ? t.stopped : t.error}</span>
          {session.error && <small role="alert">{session.error}</small>}
        </div>
        {session.participation === "participatory" && session.status !== "finished" && session.status !== "stopped" && <form
          className="discussion-intervene" onSubmit={submitIntervention}>
          <textarea value={intervention} onChange={event => setIntervention(event.target.value)}
            placeholder={t.intervene} rows={2} maxLength={2000}
            disabled={executing || (session.status !== "waiting" && session.status !== "paused" && session.status !== "error")} />
          <button type="submit" disabled={!intervention.trim() || executing
            || (session.status !== "waiting" && session.status !== "paused" && session.status !== "error")}>{t.send}</button>
        </form>}
        {session.status === "waiting" && <p className="discussion-hint">{t.waitingHint}</p>}
        {session.status === "paused" && <p className="discussion-hint">{t.abortHint}</p>}
        {session.status === "finished" && <p className="discussion-hint">{t.finishedHint}</p>}
        {Boolean(session.limitedModels?.length) && <p className="discussion-notice" role="status">
          {t.quotaNotice} {session.limitedModels?.map(id => MODEL_LABELS[id]).join(", ")}
          {session.mode === "master" && session.limitedModels?.includes(session.master) && <span> — {locale === "bg" ? "Останалите работят без Master." : "Remaining models proceed without the Master."}</span>}
        </p>}
        <div className="discussion-run-actions">
          {!executing && session.status !== "finished" && Boolean(session.limitedModels?.length) &&
            <button type="button" onClick={retryLimitedModels}>{t.quotaRetry}</button>}
          {executing ? <>
            <button type="button" onClick={() => interrupt(false)}>{t.pause}</button>
            <button type="button" onClick={() => interrupt(true)}>{t.stop}</button>
          </> : canResumeDiscussion(session.status) && <>
            <button type="button" className="discussion-primary" onClick={() => void run()} disabled={!ready}>
              {session.status === "error" ? t.retry : t.resume}
            </button>
            {session.status !== "stopped" && <button type="button" onClick={() => interrupt(true)}>{t.stop}</button>}
          </>}
        </div>
      </div>
    </>}

    {archive.length > 0 && <details className="discussion-archive">
      <summary>{t.archive} ({archive.length})</summary>
      <div>
        {archive.map(item => <div key={item.id} className="discussion-archive-row">
          <span title={item.topic}>{item.topic}</span>
          <button type="button" onClick={() => restoreDiscussion(item)} disabled={executing}>{t.restore}</button>
          <button type="button" onClick={() => storeArchive(archive.filter(entry => entry.id !== item.id))}
            disabled={executing} aria-label={t.delete + ": " + item.topic}>{t.delete}</button>
        </div>)}
      </div>
    </details>}
  </section>;
}
