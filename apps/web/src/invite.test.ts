import { describe, expect, it } from "vitest";
import { invite, INVITE_TEXT, inviteUrl } from "./invite";

describe("invite", () => {
  it("shares just the website address, with no tracking", async () => {
    let shared: ShareData | null = null;
    const r = await invite(inviteUrl("https://soulmate.example/"), {
      share: async (d) => {
        shared = d;
      },
    });
    expect(r).toBe("shared");
    expect(shared).toEqual({ title: "SOULMATE.AI", text: INVITE_TEXT, url: "https://soulmate.example/" });
    expect(inviteUrl("https://soulmate.example")).not.toMatch(/[?#]/);
  });

  it("treats closing the share sheet as cancelled", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    expect(
      await invite("u", { share: async () => Promise.reject(abort), writeText: async () => undefined }),
    ).toBe("cancelled");
  });

  it("copies the link when sharing is not available or fails", async () => {
    let copied = "";
    expect(await invite("https://x/", { writeText: async (t) => void (copied = t) })).toBe("copied");
    expect(copied).toBe("https://x/");
    expect(
      await invite("https://x/", {
        share: async () => Promise.reject(new Error("no")),
        writeText: async () => undefined,
      }),
    ).toBe("copied");
  });

  it("falls back to showing the link", async () => {
    expect(await invite("https://x/", {})).toBe("unavailable");
    expect(await invite("https://x/", { writeText: async () => Promise.reject(new Error("blocked")) })).toBe(
      "unavailable",
    );
  });
});
