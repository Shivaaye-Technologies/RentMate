import { describe, expect, it } from "vitest";
import { SIGNED_URL_SECONDS } from "./supabase";

describe("signed photo links", () => {
  it("expire within 10 minutes, so a block or hide takes effect soon on links already handed out", () => {
    expect(SIGNED_URL_SECONDS).toBeLessThanOrEqual(10 * 60);
    expect(SIGNED_URL_SECONDS).toBeGreaterThanOrEqual(5 * 60);
  });
});
