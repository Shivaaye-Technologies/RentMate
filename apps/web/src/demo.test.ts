import { describe, expect, it, vi } from "vitest";
import { demoPhotoUrl } from "./profile";

const rpc = vi.fn();
const createSignedUrl = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc, storage: { from: () => ({ createSignedUrl }) } }),
}));

const { isDemoId, loadDemoIds, setDemoIds } = await import("./demo");
const { signedPhotoUrl } = await import("./supabase");

describe("demoPhotoUrl", () => {
  it("serves demo portraits from the website", () => {
    expect(demoPhotoUrl("demo/avatars/007.svg")).toBe("/demo/avatars/007.svg");
    expect(demoPhotoUrl("demo/avatars/007.svg", "/app")).toBe("/app/demo/avatars/007.svg");
  });

  it("ignores every other path", () => {
    for (const p of [
      null,
      undefined,
      "",
      "u1/photo.jpg",
      "demo/avatars/../../x.svg",
      "demo/avatars/7.svg",
      "demo/other/001.svg",
    ]) {
      expect(demoPhotoUrl(p)).toBeNull();
    }
  });
});

describe("signedPhotoUrl with demo portraits", () => {
  it("does not ask storage for a signed link", async () => {
    createSignedUrl.mockReset();
    expect(await signedPhotoUrl("demo/avatars/001.svg")).toBe("/demo/avatars/001.svg");
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("demo ids", () => {
  it("loads ids for testers", async () => {
    rpc.mockResolvedValueOnce({ data: ["a", "b"], error: null });
    await loadDemoIds();
    expect(rpc).toHaveBeenCalledWith("demo_profile_ids");
    expect(isDemoId("a")).toBe(true);
    expect(isDemoId("c")).toBe(false);
  });

  it("treats errors (for example before the database update) as no demo profiles", async () => {
    setDemoIds(["a"]);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "function not found" } });
    await loadDemoIds();
    expect(isDemoId("a")).toBe(false);

    setDemoIds(["a"]);
    rpc.mockRejectedValueOnce(new Error("offline"));
    await loadDemoIds();
    expect(isDemoId("a")).toBe(false);
  });
});
