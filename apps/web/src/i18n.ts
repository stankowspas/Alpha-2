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
  model: string;
  notSelected: string;
  language: string;
  conversations: string;
  message: string;
  placeholder: string;
  send: string;
}

export const UI_MESSAGES: Record<UiLocale, UiMessages> = {
  bg: {
    newChat: "+ Нов чат",
    savedMessages: "Локално записани съобщения",
    provider: "Среда",
    model: "Модел",
    notSelected: "не е избран",
    language: "Език",
    conversations: "Разговори",
    message: "Съобщение",
    placeholder: "Напиши съобщение...",
    send: "Изпрати"
  },
  en: {
    newChat: "+ New chat",
    savedMessages: "Locally saved messages",
    provider: "Runtime",
    model: "Model",
    notSelected: "not selected",
    language: "Language",
    conversations: "Conversations",
    message: "Message",
    placeholder: "Write a message...",
    send: "Send"
  },
  sr: {
    newChat: "+ Нови разговор",
    savedMessages: "Локално сачуване поруке",
    provider: "Окружење",
    model: "Модел",
    notSelected: "није изабран",
    language: "Језик",
    conversations: "Разговори",
    message: "Порука",
    placeholder: "Напиши поруку...",
    send: "Пошаљи"
  }
};
