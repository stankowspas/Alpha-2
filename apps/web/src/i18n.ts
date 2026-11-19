export const UI_LANGUAGES = [
  { code: "bg", label: "Български", short: "BG" },
  { code: "en", label: "English", short: "EN" },
  { code: "sr", label: "Српски", short: "SR" },
  { code: "de", label: "Deutsch", short: "DE" },
  { code: "fr", label: "Français", short: "FR" },
  { code: "es", label: "Español", short: "ES" },
  { code: "it", label: "Italiano", short: "IT" },
  { code: "pt", label: "Português", short: "PT" },
  { code: "ro", label: "Română", short: "RO" },
  { code: "el", label: "Ελληνικά", short: "EL" },
  { code: "tr", label: "Türkçe", short: "TR" },
  { code: "ru", label: "Русский", short: "RU" },
  { code: "uk", label: "Українська", short: "UK" },
  { code: "pl", label: "Polski", short: "PL" },
  { code: "nl", label: "Nederlands", short: "NL" }
] as const;

export type UiLocale = (typeof UI_LANGUAGES)[number]["code"];

const STORAGE_KEY = "alpha2-ui-locale";
const SUPPORTED = new Set<string>(UI_LANGUAGES.map(language => language.code));

export function getInitialLocale(): UiLocale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.has(saved)) return saved as UiLocale;
  } catch { /* storage may be unavailable */ }
  const preferred = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const candidate of preferred) {
    const base = candidate.toLowerCase().split("-")[0];
    if (SUPPORTED.has(base)) return base as UiLocale;
  }
  return "bg";
}

export function persistLocale(locale: UiLocale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = "ltr";
  try { window.localStorage.setItem(STORAGE_KEY, locale); } catch { /* non-fatal */ }
}

export interface UiMessages {
  newChat: string;
  conversations: string;
  language: string;
  tagline: string;
  message: string;
  placeholder: string;
  send: string;
  connecting: string;
  ready: string;
  offline: string;
  retry: string;
  welcomeTitle: string;
  welcomeText: string;
  assistant: string;
  you: string;
  working: string;
  untitledChat: string;
  localHistory: string;
  promptHint: string;
  connectionError: string;
}

export const UI_MESSAGES: Record<UiLocale, UiMessages> = {
  bg: {
    newChat: "Нов разговор",
    conversations: "Разговори",
    language: "Език",
    tagline: "Твоят AI асистент",
    message: "Съобщение",
    placeholder: "Напиши съобщение…",
    send: "Изпрати",
    connecting: "Свързване…",
    ready: "Готов за разговор",
    offline: "Няма връзка",
    retry: "Опитай отново",
    welcomeTitle: "Как мога да помогна?",
    welcomeText: "Попитай нещо, за да започнем. Gemma 4 отговаря чрез Cloudflare.",
    assistant: "Gemma 4",
    you: "Ти",
    working: "Gemma 4 отговаря…",
    untitledChat: "Нов разговор",
    localHistory: "Историята се запазва само в този браузър.",
    promptHint: "Enter — изпрати · Shift+Enter — нов ред",
    connectionError: "Връзката с AI не е налична."
  },
  en: {
    newChat: "New chat",
    conversations: "Conversations",
    language: "Language",
    tagline: "Your AI assistant",
    message: "Message",
    placeholder: "Write a message…",
    send: "Send",
    connecting: "Connecting…",
    ready: "Ready to chat",
    offline: "Disconnected",
    retry: "Try again",
    welcomeTitle: "How can I help?",
    welcomeText: "Ask anything to start. Gemma 4 responds through Cloudflare.",
    assistant: "Gemma 4",
    you: "You",
    working: "Gemma 4 is responding…",
    untitledChat: "New conversation",
    localHistory: "History is saved only in this browser.",
    promptHint: "Enter to send · Shift+Enter for a new line",
    connectionError: "AI connection is unavailable."
  },
  sr: {
    newChat: "Нови разговор",
    conversations: "Разговори",
    language: "Језик",
    tagline: "Твој AI асистент",
    message: "Порука",
    placeholder: "Напиши поруку…",
    send: "Пошаљи",
    connecting: "Повезивање…",
    ready: "Спреман за разговор",
    offline: "Нема везе",
    retry: "Покушај поново",
    welcomeTitle: "Како могу да помогнем?",
    welcomeText: "Постави питање за почетак. Gemma 4 одговара преко Cloudflare-а.",
    assistant: "Gemma 4",
    you: "Ти",
    working: "Gemma 4 одговара…",
    untitledChat: "Нови разговор",
    localHistory: "Историја се чува само у овом прегледачу.",
    promptHint: "Enter — пошаљи · Shift+Enter — нови ред",
    connectionError: "AI веза није доступна."
  },
  de: {
    newChat: "Neuer Chat",
    conversations: "Unterhaltungen",
    language: "Sprache",
    tagline: "Dein KI-Assistent",
    message: "Nachricht",
    placeholder: "Schreibe eine Nachricht…",
    send: "Senden",
    connecting: "Verbindung wird hergestellt…",
    ready: "Bereit zum Chatten",
    offline: "Nicht verbunden",
    retry: "Erneut versuchen",
    welcomeTitle: "Wie kann ich helfen?",
    welcomeText: "Stelle eine Frage. Gemma 4 antwortet über Cloudflare.",
    assistant: "Gemma 4",
    you: "Du",
    working: "Gemma 4 antwortet…",
    untitledChat: "Neue Unterhaltung",
    localHistory: "Der Verlauf wird nur in diesem Browser gespeichert.",
    promptHint: "Enter — senden · Shift+Enter — neue Zeile",
    connectionError: "KI-Verbindung nicht verfügbar."
  },
  fr: {
    newChat: "Nouvelle discussion",
    conversations: "Conversations",
    language: "Langue",
    tagline: "Votre assistant IA",
    message: "Message",
    placeholder: "Écrivez un message…",
    send: "Envoyer",
    connecting: "Connexion…",
    ready: "Prêt à discuter",
    offline: "Déconnecté",
    retry: "Réessayer",
    welcomeTitle: "Comment puis-je vous aider ?",
    welcomeText: "Posez une question pour commencer. Gemma 4 répond via Cloudflare.",
    assistant: "Gemma 4",
    you: "Vous",
    working: "Gemma 4 répond…",
    untitledChat: "Nouvelle conversation",
    localHistory: "L’historique est conservé uniquement dans ce navigateur.",
    promptHint: "Entrée — envoyer · Maj+Entrée — nouvelle ligne",
    connectionError: "Connexion IA indisponible."
  },
  es: {
    newChat: "Nuevo chat",
    conversations: "Conversaciones",
    language: "Idioma",
    tagline: "Tu asistente de IA",
    message: "Mensaje",
    placeholder: "Escribe un mensaje…",
    send: "Enviar",
    connecting: "Conectando…",
    ready: "Listo para conversar",
    offline: "Sin conexión",
    retry: "Reintentar",
    welcomeTitle: "¿Cómo puedo ayudarte?",
    welcomeText: "Haz una pregunta para empezar. Gemma 4 responde mediante Cloudflare.",
    assistant: "Gemma 4",
    you: "Tú",
    working: "Gemma 4 está respondiendo…",
    untitledChat: "Nueva conversación",
    localHistory: "El historial solo se guarda en este navegador.",
    promptHint: "Intro — enviar · Mayús+Intro — nueva línea",
    connectionError: "Conexión con la IA no disponible."
  },
  it: {
    newChat: "Nuova chat",
    conversations: "Conversazioni",
    language: "Lingua",
    tagline: "Il tuo assistente AI",
    message: "Messaggio",
    placeholder: "Scrivi un messaggio…",
    send: "Invia",
    connecting: "Connessione…",
    ready: "Pronto a chattare",
    offline: "Disconnesso",
    retry: "Riprova",
    welcomeTitle: "Come posso aiutarti?",
    welcomeText: "Fai una domanda per iniziare. Gemma 4 risponde tramite Cloudflare.",
    assistant: "Gemma 4",
    you: "Tu",
    working: "Gemma 4 sta rispondendo…",
    untitledChat: "Nuova conversazione",
    localHistory: "La cronologia viene salvata solo in questo browser.",
    promptHint: "Invio — invia · Maiusc+Invio — nuova riga",
    connectionError: "Connessione AI non disponibile."
  },
  pt: {
    newChat: "Nova conversa",
    conversations: "Conversas",
    language: "Idioma",
    tagline: "O teu assistente de IA",
    message: "Mensagem",
    placeholder: "Escreve uma mensagem…",
    send: "Enviar",
    connecting: "A ligar…",
    ready: "Pronto para conversar",
    offline: "Sem ligação",
    retry: "Tentar novamente",
    welcomeTitle: "Como posso ajudar?",
    welcomeText: "Faz uma pergunta para começar. Gemma 4 responde através da Cloudflare.",
    assistant: "Gemma 4",
    you: "Tu",
    working: "Gemma 4 está a responder…",
    untitledChat: "Nova conversa",
    localHistory: "O histórico é guardado apenas neste navegador.",
    promptHint: "Enter — enviar · Shift+Enter — nova linha",
    connectionError: "Ligação à IA indisponível."
  },
  ro: {
    newChat: "Conversație nouă",
    conversations: "Conversații",
    language: "Limbă",
    tagline: "Asistentul tău AI",
    message: "Mesaj",
    placeholder: "Scrie un mesaj…",
    send: "Trimite",
    connecting: "Se conectează…",
    ready: "Gata de conversație",
    offline: "Deconectat",
    retry: "Încearcă din nou",
    welcomeTitle: "Cum te pot ajuta?",
    welcomeText: "Pune o întrebare pentru a începe. Gemma 4 răspunde prin Cloudflare.",
    assistant: "Gemma 4",
    you: "Tu",
    working: "Gemma 4 răspunde…",
    untitledChat: "Conversație nouă",
    localHistory: "Istoricul este salvat doar în acest browser.",
    promptHint: "Enter — trimite · Shift+Enter — rând nou",
    connectionError: "Conexiunea AI nu este disponibilă."
  },
  el: {
    newChat: "Νέα συνομιλία",
    conversations: "Συνομιλίες",
    language: "Γλώσσα",
    tagline: "Ο βοηθός AI σου",
    message: "Μήνυμα",
    placeholder: "Γράψε ένα μήνυμα…",
    send: "Αποστολή",
    connecting: "Σύνδεση…",
    ready: "Έτοιμο για συνομιλία",
    offline: "Χωρίς σύνδεση",
    retry: "Δοκίμασε ξανά",
    welcomeTitle: "Πώς μπορώ να βοηθήσω;",
    welcomeText: "Κάνε μια ερώτηση για να ξεκινήσεις. Το Gemma 4 απαντά μέσω Cloudflare.",
    assistant: "Gemma 4",
    you: "Εσύ",
    working: "Το Gemma 4 απαντά…",
    untitledChat: "Νέα συνομιλία",
    localHistory: "Το ιστορικό αποθηκεύεται μόνο σε αυτό το πρόγραμμα περιήγησης.",
    promptHint: "Enter — αποστολή · Shift+Enter — νέα γραμμή",
    connectionError: "Η σύνδεση AI δεν είναι διαθέσιμη."
  },
  tr: {
    newChat: "Yeni sohbet",
    conversations: "Sohbetler",
    language: "Dil",
    tagline: "Yapay zekâ asistanın",
    message: "Mesaj",
    placeholder: "Bir mesaj yaz…",
    send: "Gönder",
    connecting: "Bağlanıyor…",
    ready: "Sohbete hazır",
    offline: "Bağlantı yok",
    retry: "Tekrar dene",
    welcomeTitle: "Nasıl yardımcı olabilirim?",
    welcomeText: "Başlamak için bir soru sor. Gemma 4, Cloudflare üzerinden yanıt verir.",
    assistant: "Gemma 4",
    you: "Sen",
    working: "Gemma 4 yanıtlıyor…",
    untitledChat: "Yeni sohbet",
    localHistory: "Geçmiş yalnızca bu tarayıcıda saklanır.",
    promptHint: "Enter — gönder · Shift+Enter — yeni satır",
    connectionError: "AI bağlantısı kullanılamıyor."
  },
  ru: {
    newChat: "Новый чат",
    conversations: "Чаты",
    language: "Язык",
    tagline: "Ваш ИИ-помощник",
    message: "Сообщение",
    placeholder: "Напишите сообщение…",
    send: "Отправить",
    connecting: "Подключение…",
    ready: "Готов к общению",
    offline: "Нет соединения",
    retry: "Повторить",
    welcomeTitle: "Чем могу помочь?",
    welcomeText: "Задайте вопрос для начала. Gemma 4 отвечает через Cloudflare.",
    assistant: "Gemma 4",
    you: "Вы",
    working: "Gemma 4 отвечает…",
    untitledChat: "Новый чат",
    localHistory: "История хранится только в этом браузере.",
    promptHint: "Enter — отправить · Shift+Enter — новая строка",
    connectionError: "Соединение с ИИ недоступно."
  },
  uk: {
    newChat: "Новий чат",
    conversations: "Розмови",
    language: "Мова",
    tagline: "Ваш ШІ-помічник",
    message: "Повідомлення",
    placeholder: "Напишіть повідомлення…",
    send: "Надіслати",
    connecting: "Підключення…",
    ready: "Готовий до розмови",
    offline: "Немає з’єднання",
    retry: "Спробувати ще",
    welcomeTitle: "Чим можу допомогти?",
    welcomeText: "Поставте запитання для початку. Gemma 4 відповідає через Cloudflare.",
    assistant: "Gemma 4",
    you: "Ви",
    working: "Gemma 4 відповідає…",
    untitledChat: "Нова розмова",
    localHistory: "Історія зберігається лише в цьому браузері.",
    promptHint: "Enter — надіслати · Shift+Enter — новий рядок",
    connectionError: "З’єднання з ШІ недоступне."
  },
  pl: {
    newChat: "Nowy czat",
    conversations: "Rozmowy",
    language: "Język",
    tagline: "Twój asystent AI",
    message: "Wiadomość",
    placeholder: "Napisz wiadomość…",
    send: "Wyślij",
    connecting: "Łączenie…",
    ready: "Gotowy do rozmowy",
    offline: "Brak połączenia",
    retry: "Spróbuj ponownie",
    welcomeTitle: "Jak mogę pomóc?",
    welcomeText: "Zadaj pytanie na początek. Gemma 4 odpowiada przez Cloudflare.",
    assistant: "Gemma 4",
    you: "Ty",
    working: "Gemma 4 odpowiada…",
    untitledChat: "Nowa rozmowa",
    localHistory: "Historia jest zapisywana tylko w tej przeglądarce.",
    promptHint: "Enter — wyślij · Shift+Enter — nowa linia",
    connectionError: "Połączenie z AI niedostępne."
  },
  nl: {
    newChat: "Nieuwe chat",
    conversations: "Gesprekken",
    language: "Taal",
    tagline: "Je AI-assistent",
    message: "Bericht",
    placeholder: "Schrijf een bericht…",
    send: "Versturen",
    connecting: "Verbinding maken…",
    ready: "Klaar om te chatten",
    offline: "Niet verbonden",
    retry: "Opnieuw proberen",
    welcomeTitle: "Hoe kan ik helpen?",
    welcomeText: "Stel een vraag om te beginnen. Gemma 4 antwoordt via Cloudflare.",
    assistant: "Gemma 4",
    you: "Jij",
    working: "Gemma 4 antwoordt…",
    untitledChat: "Nieuw gesprek",
    localHistory: "Geschiedenis wordt alleen in deze browser opgeslagen.",
    promptHint: "Enter — versturen · Shift+Enter — nieuwe regel",
    connectionError: "AI-verbinding niet beschikbaar."
  }
};
