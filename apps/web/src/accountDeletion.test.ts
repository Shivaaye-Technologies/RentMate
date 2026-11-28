import { describe, expect, it } from "vitest";
import { AccountDeletionError, DELETION_RETRY_MESSAGE, deleteAccountViaServer } from "./accountDeletion";

const reply = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("deleteAccountViaServer", () => {
  it("sends the confirmation with the member's token to DELETE /api/v1/account", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ deleted: true, photosRemoved: 3 }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(deleteAccountViaServer("tok", "https://api.example", fetchFn)).resolves.toBe("deleted");
    expect(seen!.url).toBe("https://api.example/api/v1/account");
    expect(seen!.init.method).toBe("DELETE");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(seen!.init.body))).toEqual({ confirm: "DELETE" });
  });

  it("fails with the retry message when the server is unreachable, missing (404) or not configured (503)", async () => {
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    for (const fetchFn of [down, reply(404), reply(503)]) {
      const attempt = deleteAccountViaServer("tok", "https://api", fetchFn);
      await expect(attempt).rejects.toBeInstanceOf(AccountDeletionError);
      await expect(deleteAccountViaServer("tok", "https://api", fetchFn)).rejects.toThrow(
        DELETION_RETRY_MESSAGE,
      );
    }
  });

  it("gives up after the timeout instead of waiting forever", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    await expect(deleteAccountViaServer("tok", "https://api", hang, 20)).rejects.toThrow(
      DELETION_RETRY_MESSAGE,
    );
  });

  it("only reports success when the server confirms the deletion", async () => {
    await expect(deleteAccountViaServer("tok", "https://api", reply(200, {}))).rejects.toThrow(
      DELETION_RETRY_MESSAGE,
    );
  });

  it("surfaces the server's message on a real failure", async () => {
    const failed = reply(502, {
      error: "Couldn't delete your photos. Your account was not deleted; please try again.",
    });
    await expect(deleteAccountViaServer("tok", "https://api", failed)).rejects.toThrow(/not deleted/);
    await expect(deleteAccountViaServer("tok", "https://api", reply(401))).rejects.toThrow(/401/);
  });
});
