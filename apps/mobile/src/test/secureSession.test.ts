import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, createChunkedStorage, safeKey, type KeyValueStore } from "../lib/secureSession";

/** In-memory stand-in for expo-secure-store that enforces its ~2 KB value limit and key alphabet. */
function fakeSecureStore() {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    async getItemAsync(k) {
      return data.has(k) ? data.get(k)! : null;
    },
    async setItemAsync(k, v) {
      if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error(`invalid key ${k}`);
      if (v.length > 2048) throw new Error("value larger than 2048 bytes");
      data.set(k, v);
    },
    async deleteItemAsync(k) {
      data.delete(k);
    },
  };
  return { store, data };
}

const session = JSON.stringify({
  access_token: "a".repeat(1500),
  refresh_token: "r".repeat(40),
  user: { id: "u".repeat(2500) },
});

describe("chunked secure session storage", () => {
  it("stores a session larger than SecureStore's limit and reads it back exactly", async () => {
    const { store, data } = fakeSecureStore();
    const s = createChunkedStorage(store);
    await s.setItem("sb-abc-auth-token", session);
    expect(await s.getItem("sb-abc-auth-token")).toBe(session);
    expect(data.size).toBe(Math.ceil(session.length / CHUNK_SIZE) + 1);
  });

  it("removes every chunk on sign-out", async () => {
    const { store, data } = fakeSecureStore();
    const s = createChunkedStorage(store);
    await s.setItem("sb-abc-auth-token", session);
    await s.removeItem("sb-abc-auth-token");
    expect(await s.getItem("sb-abc-auth-token")).toBeNull();
    expect(data.size).toBe(0);
  });

  it("a shorter session replaces a longer one without leftover chunks", async () => {
    const { store, data } = fakeSecureStore();
    const s = createChunkedStorage(store);
    await s.setItem("k", session);
    await s.setItem("k", "small");
    expect(await s.getItem("k")).toBe("small");
    expect(data.size).toBe(2);
  });

  it("treats a half-written session as signed out (never returns a broken session)", async () => {
    const { store, data } = fakeSecureStore();
    const s = createChunkedStorage(store);
    await s.setItem("k", session);
    data.delete(`${safeKey("k")}.1`);
    expect(await s.getItem("k")).toBeNull();
    expect(data.size).toBe(0);
  });

  it("ignores a corrupted chunk count", async () => {
    const { store, data } = fakeSecureStore();
    data.set("k.n", "999999");
    expect(await createChunkedStorage(store).getItem("k")).toBeNull();
  });

  it("makes keys safe for SecureStore", () => {
    expect(safeKey("sb-abc-auth-token")).toBe("sb-abc-auth-token");
    expect(safeKey("a/b c:d")).toBe("a_b_c_d");
  });
});
