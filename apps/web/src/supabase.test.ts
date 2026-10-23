import { describe, expect, it, vi } from "vitest";

const createSignedUrl = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
}));

const { signedPhotoUrl, clearPhotoCache } = await import("./supabase");

describe("signedPhotoUrl", () => {
  it("returns null without a path", async () => {
    expect(await signedPhotoUrl(null)).toBeNull();
  });

  it("caches a signed link until shortly before it expires", async () => {
    clearPhotoCache();
    createSignedUrl.mockReset();
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/signed" }, error: null });
    let now = 0;
    const clock = () => now;

    expect(await signedPhotoUrl("u/a.jpg", clock)).toBe("https://x/signed");
    expect(await signedPhotoUrl("u/a.jpg", clock)).toBe("https://x/signed");
    expect(createSignedUrl).toHaveBeenCalledTimes(1);

    now = 56 * 60 * 1000; // inside the 5-minute refresh margin
    await signedPhotoUrl("u/a.jpg", clock);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("shares one request between simultaneous callers and does not cache failures", async () => {
    clearPhotoCache();
    createSignedUrl.mockReset();
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "not allowed" } });
    const [a, b] = await Promise.all([signedPhotoUrl("u/b.jpg"), signedPhotoUrl("u/b.jpg")]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    await signedPhotoUrl("u/b.jpg");
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });
});
