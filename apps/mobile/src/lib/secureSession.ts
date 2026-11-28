/**
 * Session storage for supabase-js backed by Android Keystore (expo-secure-store). SecureStore keeps values of about
 * 2 KB at most, and a Supabase session is usually larger, so each value is split into chunks under that limit.
 * Nothing is written to plain AsyncStorage. The store is injected so the logic can be tested without a device.
 */
export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const CHUNK_SIZE = 1800;
const MAX_CHUNKS = 64;

/** SecureStore keys may contain only letters, digits, ".", "-" and "_". */
export function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function createChunkedStorage(store: KeyValueStore) {
  const countKey = (key: string) => `${safeKey(key)}.n`;
  const chunkKey = (key: string, i: number) => `${safeKey(key)}.${i}`;

  async function removeItem(key: string): Promise<void> {
    const n = Number((await store.getItemAsync(countKey(key))) ?? "0");
    const count = Number.isInteger(n) && n > 0 && n <= MAX_CHUNKS ? n : 0;
    await store.deleteItemAsync(countKey(key));
    for (let i = 0; i < count; i++) await store.deleteItemAsync(chunkKey(key, i));
  }

  async function getItem(key: string): Promise<string | null> {
    const raw = await store.getItemAsync(countKey(key));
    if (raw === null) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CHUNKS) {
      await removeItem(key);
      return null;
    }
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const part = await store.getItemAsync(chunkKey(key, i));
      if (part === null) {
        // Incomplete (for example the app was killed mid-write): treat as signed out rather than use a broken session.
        await removeItem(key);
        return null;
      }
      parts.push(part);
    }
    return parts.join("");
  }

  async function setItem(key: string, value: string): Promise<void> {
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
    if (chunks.length === 0) chunks.push("");
    if (chunks.length > MAX_CHUNKS) throw new Error("Session is too large to store securely.");
    await removeItem(key);
    for (let i = 0; i < chunks.length; i++) await store.setItemAsync(chunkKey(key, i), chunks[i]);
    // The count is written last, so a partial write is never read back as a session.
    await store.setItemAsync(countKey(key), String(chunks.length));
  }

  return { getItem, setItem, removeItem };
}
