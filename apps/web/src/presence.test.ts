import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { touchLastSeen } from "./presence";

function clientWith(status: number, body: unknown) {
  const calls: string[] = [];
  const fetchSpy = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${new URL(url).pathname}${new URL(url).search} ${String(init?.body)}`);
    const payload = status === 204 ? null : JSON.stringify(body);
    return new Response(payload, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = createClient("http://localhost:54321", "key", {
    global: { fetch: fetchSpy },
    auth: { persistSession: false },
  });
  return { client, calls };
}

describe("touchLastSeen", () => {
  // Regression: the heartbeat was `void supabase.from(...)`, which never sends a request.
  it("actually sends the update for the signed-in user", async () => {
    const { client, calls } = clientWith(204, null);
    const result = await touchLastSeen(client, "user-1", new Date("2026-10-23T12:00:00Z"));
    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^PATCH \/rest\/v1\/profiles\?id=eq\.user-1 /);
    expect(calls[0]).toContain('"last_seen_at":"2026-10-23T12:00:00.000Z"');
  });

  it("reports and logs failures instead of hiding them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = clientWith(403, { message: "permission denied", code: "42501" });
    expect(await touchLastSeen(client, "user-1")).toBe("permission denied");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
