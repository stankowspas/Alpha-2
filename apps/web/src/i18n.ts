export type UiLocale = "bg" | "en" | "sr";

export const UI_LANGUAGES: ReadonlyArray<{ code: UiLocale; label: string; short: string }> = [
  { code: "bg", label: "Български", short: "BG" },
  { code: "en", label: "English", short: "EN" },
  { code: "sr", label: "Српски", short: "SR" }
];

const STORAGE_KEY = "alpha2-ui-locale";

export function getInitialLocale(): UiLocale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "bg" || saved === "en" || saved === "sr") return saved;
  } catch { /* storage may be unavailable */ }

  const browserLanguage = navigator.language.toLowerCase();
  if (browserLanguage.startsWith("sr")) return "sr";
  if (browserLanguage.startsWith("en")) return "en";
  return "bg";
}

export function persistLocale(locale: UiLocale): void {
  document.documentElement.lang = locale;
  try { window.localStorage.setItem(STORAGE_KEY, locale); } catch { /* non-fatal */ }
}
export interface UiMessages {
  newChat: string;
  savedMessages: string;
  provider: string;
  developerMode: string;
  disable: string;
  enable: string;
  aiBackend: string;
  ready: string;
  disconnected: string;
  model: string;
  notSelected: string;
  language: string;
  intro: string;
  connectBackend: string;
  backendReady: string;
  checking: string;
  mode: string;
  fast: string;
  thinkingMode: string;
  responseLevel: string;
  thinkingAnalysis: string;
  answer: string;
  sources: string;
  supports: string;
  message: string;
  placeholder: string;
  stop: string;
  send: string;
  connectPrompt: string;
  productionMissing: string;
  missingEndpoint: string;
  checkingBackend: string;
  freeBackendReady: string;
  backendLoadFailed: string;
  generating: string;
  generationStopped: string;
  inferenceError: string;
  blockedPrefix: string;
  unverifiedResult: string;
  taskComplete: string;
  conversations: string;
  developerTaskEngine: string;
  publishable: string;
  finalization: string;
  citations: string;
  taskId: string;
  taskStatus: string;
  steps: string;
  blockedReason: string;
  hardConstraints: string;
  taskPlan: string;
  none: string;
  generationNote: string;
}

export const UI_MESSAGES: Record<UiLocale, UiMessages> = {
  bg: {
    newChat: "+ Нов чат",
    savedMessages: "Локално записани съобщения",
    provider: "Provider",
    developerMode: "Developer Mode",
    disable: "Изключи",
    enable: "Включи",
    aiBackend: "AI backend",
    ready: "готов",
    disconnected: "не е свързан",
    model: "Model",
    notSelected: "не е избран",
    language: "Език",
    intro: "Inference се изпълнява през локалния Alpha AI backend и разрешени безплатни Gemini модели. Няма локален model inference.",
    connectBackend: "Свържи AI backend",
    backendReady: "AI backend е готов",
    checking: "Проверка",
    mode: "Режим",
    fast: "Fast",
    thinkingMode: "Thinking",
    responseLevel: "Ниво на отговор",
    thinkingAnalysis: "Мислене / Анализ",
    answer: "Отговор",
    sources: "Източници",
    supports: "Подкрепя",
    message: "Съобщение",
    placeholder: "Напиши съобщение...",
    stop: "Стоп",
    send: "Изпрати",
    connectPrompt: "Свържи Alpha 2 с безплатния AI backend.",
    productionMissing: "PWA е готова, но production AI backend не е конфигуриран.",
    missingEndpoint: "Липсва VITE_AI_ENDPOINT за production PWA.",
    checkingBackend: "Проверка на Alpha 2 AI backend...",
    freeBackendReady: "Безплатният Gemini backend е готов.",
    backendLoadFailed: "AI backend не може да бъде зареден.",
    generating: "Генериране...",
    generationStopped: "Генерирането е спряно.",
    inferenceError: "Inference/execution грешка.",
    blockedPrefix: "Отговорът е блокиран от execution/verification gate",
    unverifiedResult: "непотвърден резултат",
    taskComplete: "TASK_COMPLETE — отговорът премина приложимите final gates.",
    conversations: "Разговори",
    developerTaskEngine: "Developer — Task Engine",
    publishable: "Publishable",
    finalization: "Finalization",
    citations: "Citations",
    taskId: "Task ID",
    taskStatus: "Task status",
    steps: "Steps",
    blockedReason: "Blocked reason",
    hardConstraints: "Hard constraints",
    taskPlan: "Task plan",
    none: "няма",
    generationNote: "GENERATION_COMPLETE не означава STEP_COMPLETE. User-visible отговор се пази само след Completion/Finalization gates."
  },
  en: {
    newChat: "+ New chat",
    savedMessages: "Locally saved messages",
    provider: "Provider",
    developerMode: "Developer Mode",
    disable: "Disable",
    enable: "Enable",
    aiBackend: "AI backend",
    ready: "ready",
    disconnected: "not connected",
    model: "Model",
    notSelected: "not selected",
    language: "Language",
    intro: "Inference runs through the local Alpha AI backend and approved free Gemini models. No model inference runs locally.",
    connectBackend: "Connect AI backend",
    backendReady: "AI backend is ready",
    checking: "Checking",
    mode: "Mode",
    fast: "Fast",
    thinkingMode: "Thinking",
    responseLevel: "Response level",
    thinkingAnalysis: "Thinking / Analysis",
    answer: "Answer",
    sources: "Sources",
    supports: "Supports",
    message: "Message",
    placeholder: "Write a message...",
    stop: "Stop",
    send: "Send",
    connectPrompt: "Connect Alpha 2 to the free AI backend.",
    productionMissing: "The PWA is ready, but the production AI backend is not configured.",
    missingEndpoint: "VITE_AI_ENDPOINT is missing for the production PWA.",
    checkingBackend: "Checking Alpha 2 AI backend...",
    freeBackendReady: "The free Gemini backend is ready.",
    backendLoadFailed: "The AI backend could not be loaded.",
    generating: "Generating...",
    generationStopped: "Generation stopped.",
    inferenceError: "Inference/execution error.",
    blockedPrefix: "The answer was blocked by the execution/verification gate",
    unverifiedResult: "unverified result",
    taskComplete: "TASK_COMPLETE — the answer passed the applicable final gates.",
    conversations: "Conversations",
    developerTaskEngine: "Developer — Task Engine",
    publishable: "Publishable",
    finalization: "Finalization",
    citations: "Citations",
    taskId: "Task ID",
    taskStatus: "Task status",
    steps: "Steps",
    blockedReason: "Blocked reason",
    hardConstraints: "Hard constraints",
    taskPlan: "Task plan",
    none: "none",
    generationNote: "GENERATION_COMPLETE does not mean STEP_COMPLETE. User-visible output is kept only after Completion/Finalization gates."
  },
  sr: {
    newChat: "+ Нови разговор",
    savedMessages: "Локално сачуване поруке",
    provider: "Provider",
    developerMode: "Developer Mode",
    disable: "Искључи",
    enable: "Укључи",
    aiBackend: "AI backend",
    ready: "спреман",
    disconnected: "није повезан",
    model: "Model",
    notSelected: "није изабран",
    language: "Језик",
    intro: "Inference се извршава преко локалног Alpha AI backend-а и дозвољених бесплатних Gemini модела. Нема локалног model inference-а.",
    connectBackend: "Повежи AI backend",
    backendReady: "AI backend је спреман",
    checking: "Провера",
    mode: "Режим",
    fast: "Fast",
    thinkingMode: "Thinking",
    responseLevel: "Ниво одговора",
    thinkingAnalysis: "Размишљање / Анализа",
    answer: "Одговор",
    sources: "Извори",
    supports: "Подржава",
    message: "Порука",
    placeholder: "Напиши поруку...",
    stop: "Стоп",
    send: "Пошаљи",
    connectPrompt: "Повежи Alpha 2 са бесплатним AI backend-ом.",
    productionMissing: "PWA је спремна, али production AI backend није конфигурисан.",
    missingEndpoint: "Недостаје VITE_AI_ENDPOINT за production PWA.",
    checkingBackend: "Провера Alpha 2 AI backend-а...",
    freeBackendReady: "Бесплатни Gemini backend је спреман.",
    backendLoadFailed: "AI backend не може да се учита.",
    generating: "Генерисање...",
    generationStopped: "Генерисање је заустављено.",
    inferenceError: "Inference/execution грешка.",
    blockedPrefix: "Одговор је блокиран од execution/verification gate-а",
    unverifiedResult: "непотврђен резултат",
    taskComplete: "TASK_COMPLETE — одговор је прошао применљиве final gates.",
    conversations: "Разговори",
    developerTaskEngine: "Developer — Task Engine",
    publishable: "Publishable",
    finalization: "Finalization",
    citations: "Citations",
    taskId: "Task ID",
    taskStatus: "Task status",
    steps: "Steps",
    blockedReason: "Blocked reason",
    hardConstraints: "Hard constraints",
    taskPlan: "Task plan",
    none: "нема",
    generationNote: "GENERATION_COMPLETE не значи STEP_COMPLETE. User-visible одговор се чува тек после Completion/Finalization gates."
  }
};
