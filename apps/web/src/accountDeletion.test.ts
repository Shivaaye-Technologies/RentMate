import { describe, expect, it } from "vitest";
import { deleteAccountViaServer } from "./accountDeletion";

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

  it("reports an unreachable or older server so the browser can fall back", async () => {
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(deleteAccountViaServer("tok", "https://api", down)).resolves.toBe("unreachable");
    await expect(deleteAccountViaServer("tok", "https://api", reply(404))).resolves.toBe("unreachable");
    await expect(deleteAccountViaServer("tok", "https://api", reply(503))).resolves.toBe("unreachable");
  });

  it("surfaces the server's message on a real failure instead of falling back", async () => {
    const failed = reply(502, {
      error: "Couldn't delete your photos. Your account was not deleted; please try again.",
    });
    await expect(deleteAccountViaServer("tok", "https://api", failed)).rejects.toThrow(/not deleted/);
    await expect(deleteAccountViaServer("tok", "https://api", reply(401))).rejects.toThrow(/401/);
  });
});
