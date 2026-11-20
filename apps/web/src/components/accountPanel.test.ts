// The account-deletion flow the Account panel runs (deleteMyAccount), with the Supabase client replaced by spies.
// Proves the browser never removes photos or calls delete_my_account itself, whatever the server answers.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  clearPhotoCache: vi.fn(),
}));

vi.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: spies.getSession, signOut: spies.signOut },
    rpc: spies.rpc,
    storage: { from: spies.storageFrom },
  },
  clearPhotoCache: spies.clearPhotoCache,
}));

import { DELETION_RETRY_MESSAGE } from "../accountDeletion";
import { deleteMyAccount } from "./AccountPanel";

const reply = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const networkDown = vi.fn(async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;

function expectNoBrowserDeletion() {
  expect(spies.rpc).not.toHaveBeenCalled(); // no delete_my_account (or any RPC) from the browser
  expect(spies.storageFrom).not.toHaveBeenCalled(); // no Storage access at all
  expect(spies.list).not.toHaveBeenCalled();
  expect(spies.remove).not.toHaveBeenCalled();
}

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockReset();
  spies.getSession.mockResolvedValue({ data: { session: { access_token: "member-token" } } });
  spies.signOut.mockResolvedValue({ error: null });
  spies.storageFrom.mockReturnValue({ list: spies.list, remove: spies.remove });
});

describe("deleteMyAccount (Account panel)", () => {
  it("reports success only after the server confirms, then signs out and reloads", async () => {
    const reload = vi.fn();
    const fetchFn = reply(200, { deleted: true, photosRemoved: 2 });
    await expect(deleteMyAccount({ fetchFn, base: "https://api", reload })).resolves.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(spies.signOut).toHaveBeenCalledTimes(1);
    expect(spies.clearPhotoCache).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expectNoBrowserDeletion();
  });

  for (const [label, fetchFn] of [
    ["API 404", reply(404)],
    ["API 503", reply(503)],
    ["a network failure", networkDown],
  ] as const) {
    it(`${label}: no browser-side deletion, account untouched, retry message shown`, async () => {
      const reload = vi.fn();
      await expect(deleteMyAccount({ fetchFn, base: "https://api", reload })).resolves.toBe(
        DELETION_RETRY_MESSAGE,
      );
      expectNoBrowserDeletion();
      expect(spies.signOut).not.toHaveBeenCalled();
      expect(spies.clearPhotoCache).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });
  }

  it("a server-side failure shows the server's retry message and deletes nothing from the browser", async () => {
    const reload = vi.fn();
    const fetchFn = reply(502, {
      error: "Couldn't delete your photos. Your account was not deleted; please try again.",
    });
    await expect(deleteMyAccount({ fetchFn, base: "https://api", reload })).resolves.toMatch(/try again/);
    expectNoBrowserDeletion();
    expect(reload).not.toHaveBeenCalled();
  });

  it("without a session it asks the member to sign in again and calls nothing", async () => {
    spies.getSession.mockResolvedValue({ data: { session: null } });
    const fetchFn = reply(200, { deleted: true });
    await expect(deleteMyAccount({ fetchFn, base: "https://api", reload: vi.fn() })).resolves.toMatch(
      /sign in/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expectNoBrowserDeletion();
  });

  it("the Account panel source has no browser-side deletion path left", () => {
    const src = readFileSync(new URL("./AccountPanel.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/ownPhotoFiles|delete_my_account|\.rpc\(|storage\./);
  });
});
