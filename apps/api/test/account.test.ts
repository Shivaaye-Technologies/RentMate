import request from "supertest";
import { describe, expect, it } from "vitest";
import { AccountDeletionError, SupabaseAccountDeleter, type AccountDeleter } from "../src/account.js";
import { createApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { MemoryProfileStore } from "../src/store.js";

const config = loadConfig({ NODE_ENV: "test" });
const verifier: TokenVerifier = async (t) => (t === "member-token" ? { id: "u-1" } : null);
const SB = "https://project.supabase.co";
const USER = "6f1c2a3b-0000-4000-8000-000000000001";
const OTHER = "6f1c2a3b-0000-4000-8000-000000000002";

const makeApp = (accountFor?: () => AccountDeleter) =>
  createApp({ config, verifyToken: verifier, storeFor: () => new MemoryProfileStore(), accountFor });

/**
 * A fake Supabase speaking the real wire format of storage-js and PostgREST:
 *   POST   /storage/v1/object/list/photos   {prefix, limit, offset}
 *   DELETE /storage/v1/object/photos        {prefixes}
 *   POST   /rest/v1/rpc/delete_my_account   (refuses with P0001 while the folder has files, like the migration)
 */
function fakeSupabase(files: string[], opts: { failRemoveTimes?: number; uploadBeforeRpc?: string } = {}) {
  const state = {
    files: new Set(files),
    deleted: false,
    calls: [] as string[],
    auth: new Set<string>(),
    failRemove: opts.failRemoveTimes ?? 0,
  };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    state.auth.add(headers.get("authorization") ?? "none");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (method === "POST" && url.pathname === "/storage/v1/object/list/photos") {
      state.calls.push(`list ${body.prefix}`);
      const prefix = `${body.prefix}/`;
      const names = [...state.files].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
      const page = names.slice(body.offset ?? 0, (body.offset ?? 0) + (body.limit ?? 100));
      return json(
        200,
        page.map((name) => ({ name, id: `id-${name}` })),
      );
    }
    if (method === "DELETE" && url.pathname === "/storage/v1/object/photos") {
      state.calls.push(`remove ${body.prefixes.length}`);
      if (state.failRemove > 0) {
        state.failRemove--;
        return json(500, { statusCode: "500", error: "internal", message: "storage unavailable" });
      }
      for (const p of body.prefixes) state.files.delete(p);
      return json(
        200,
        body.prefixes.map((name: string) => ({ name })),
      );
    }
    if (method === "POST" && url.pathname === "/rest/v1/rpc/delete_my_account") {
      state.calls.push("rpc");
      if (opts.uploadBeforeRpc && state.calls.filter((c) => c === "rpc").length === 1)
        state.files.add(opts.uploadBeforeRpc);
      if ([...state.files].some((f) => f.startsWith(`${USER}/`)))
        return json(400, {
          code: "P0001",
          message: "Your photos must be deleted before your account (1 left).",
        });
      state.deleted = true;
      return new Response(null, { status: 204 });
    }
    return json(404, { message: `unexpected ${method} ${url.pathname}` });
  }) as typeof fetch;
  return { state, deleter: new SupabaseAccountDeleter(SB, "publishable-key", "member-token", fetchFn) };
}

describe("DELETE /api/v1/account", () => {
  const ok: AccountDeleter = { deleteAccount: async () => ({ photosRemoved: 2 }) };

  it("requires sign-in", async () => {
    const res = await request(makeApp(() => ok))
      .delete("/api/v1/account")
      .send({ confirm: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("returns 503 when deletion is not configured", async () => {
    const res = await request(makeApp())
      .delete("/api/v1/account")
      .set("Authorization", "Bearer member-token")
      .send({ confirm: "DELETE" });
    expect(res.status).toBe(503);
  });

  it("requires the typed confirmation", async () => {
    let called = false;
    const app = makeApp(() => ({ deleteAccount: async () => ((called = true), { photosRemoved: 0 }) }));
    for (const body of [{}, { confirm: "delete me" }, { confirm: "" }]) {
      const res = await request(app)
        .delete("/api/v1/account")
        .set("Authorization", "Bearer member-token")
        .send(body);
      expect(res.status).toBe(400);
    }
    expect(called).toBe(false);
  });

  it("deletes only the signed-in member, and reports how many photos went", async () => {
    let who = "";
    const app = makeApp(() => ({ deleteAccount: async (id) => ((who = id), { photosRemoved: 2 }) }));
    const res = await request(app)
      .delete("/api/v1/account")
      .set("Authorization", "Bearer member-token")
      .send({ confirm: "DELETE", userId: "someone-else" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, photosRemoved: 2 });
    expect(who).toBe("u-1");
  });

  it("answers 502 with the failed stage and says the account was not deleted", async () => {
    const app = makeApp(() => ({
      deleteAccount: async () => {
        throw new AccountDeletionError("photos", "Couldn't delete your photos.");
      },
    }));
    const res = await request(app)
      .delete("/api/v1/account")
      .set("Authorization", "Bearer member-token")
      .send({ confirm: "DELETE" });
    expect(res.status).toBe(502);
    expect(res.body.stage).toBe("photos");
    expect(res.body.error).toMatch(/not deleted/);
  });
});

describe("SupabaseAccountDeleter (server-side photo removal, then the account)", () => {
  it("removes every photo, then deletes the account, using only the member's own session", async () => {
    const { state, deleter } = fakeSupabase([
      `${USER}/a.jpg`,
      `${USER}/b.jpg`,
      `${USER}/c.jpg`,
      `${OTHER}/x.jpg`,
    ]);
    await expect(deleter.deleteAccount(USER)).resolves.toEqual({ photosRemoved: 3 });
    expect(state.deleted).toBe(true);
    expect([...state.files]).toEqual([`${OTHER}/x.jpg`]); // nobody else's files
    expect(state.calls).toEqual([`list ${USER}`, "remove 3", `list ${USER}`, "rpc"]);
    expect([...state.auth]).toEqual(["Bearer member-token"]); // never a privileged key
  });

  it("pages through large folders", async () => {
    const files = Array.from({ length: 150 }, (_, i) => `${USER}/p${i}.jpg`);
    const { state, deleter } = fakeSupabase(files);
    await expect(deleter.deleteAccount(USER)).resolves.toEqual({ photosRemoved: 150 });
    expect(state.calls.filter((c) => c.startsWith("remove"))).toEqual(["remove 100", "remove 50"]);
    expect(state.deleted).toBe(true);
  });

  it("a storage failure stops before the account step; a retry finishes the job", async () => {
    const { state, deleter } = fakeSupabase([`${USER}/a.jpg`, `${USER}/b.jpg`], { failRemoveTimes: 1 });
    const err = await deleter.deleteAccount(USER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountDeletionError);
    expect((err as AccountDeletionError).stage).toBe("photos");
    expect(state.calls).not.toContain("rpc");
    expect(state.deleted).toBe(false);
    expect(state.files.size).toBe(2);
    await expect(deleter.deleteAccount(USER)).resolves.toEqual({ photosRemoved: 2 });
    expect(state.deleted).toBe(true);
    expect(state.files.size).toBe(0);
  });

  it("a photo added after the folder was emptied blocks the account step (database guard); a retry succeeds", async () => {
    const { state, deleter } = fakeSupabase([`${USER}/a.jpg`], { uploadBeforeRpc: `${USER}/late.jpg` });
    const err = await deleter.deleteAccount(USER).catch((e: unknown) => e);
    expect((err as AccountDeletionError).stage).toBe("account");
    expect(state.deleted).toBe(false);
    await expect(deleter.deleteAccount(USER)).resolves.toEqual({ photosRemoved: 1 });
    expect(state.deleted).toBe(true);
  });

  it("repeating a completed deletion is harmless", async () => {
    const { state, deleter } = fakeSupabase([]);
    await expect(deleter.deleteAccount(USER)).resolves.toEqual({ photosRemoved: 0 });
    await expect(deleter.deleteAccount(USER)).resolves.toEqual({ photosRemoved: 0 });
    expect(state.calls).toEqual([`list ${USER}`, "rpc", `list ${USER}`, "rpc"]);
  });
});
