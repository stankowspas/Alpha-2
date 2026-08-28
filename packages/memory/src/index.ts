export type MemoryType = "explicit" | "inferred";

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  text: string;
  projectScope?: string;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "conflict" | "stale";
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  createdAt: string;
}

const DB_NAME = "alpha-chat";
const DB_VERSION = 2;
const MEMORY_STORE = "memory";
const MESSAGES_STORE = "messages";

export async function openAlphaDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEMORY_STORE)) {
        db.createObjectStore(MEMORY_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const messages = db.createObjectStore(MESSAGES_STORE, { keyPath: "id" });
        messages.createIndex("conversationId", "conversationId", { unique: false });
        messages.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveConversationMessage(message: ConversationMessage): Promise<void> {
  const db = await openAlphaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, "readwrite");
    tx.objectStore(MESSAGES_STORE).put(message);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Conversation save aborted."));
  });
  db.close();
}

export async function listConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const db = await openAlphaDb();
  const messages = await new Promise<ConversationMessage[]>((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, "readonly");
    const request = tx.objectStore(MESSAGES_STORE).index("conversationId").getAll(conversationId);
    request.onsuccess = () => resolve(request.result as ConversationMessage[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function clearConversation(conversationId: string): Promise<void> {
  const db = await openAlphaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, "readwrite");
    const store = tx.objectStore(MESSAGES_STORE);
    const index = store.index("conversationId");
    const cursorRequest = index.openKeyCursor(IDBKeyRange.only(conversationId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
