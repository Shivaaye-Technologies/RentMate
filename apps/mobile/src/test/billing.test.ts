import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { availableProducts, BILLING_ROUTE, playAccountId, sha256Hex, verifyWithServer } from "../lib/billing";

describe("sha256Hex", () => {
  it("matches the standard test vectors and node:crypto", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const s of ["a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "नमस्ते RentMate ✓"]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });
});

describe("playAccountId", () => {
  it("is the same hash the API checks (apps/api/src/billing/googlePlay.ts)", () => {
    const id = "6f1c7c1e-2b5e-4c5a-9f0e-0a7c2d1b3e4f";
    expect(playAccountId(id)).toBe(createHash("sha256").update(`rentmate:${id}`, "utf8").digest("hex"));
    expect(playAccountId(id)).toHaveLength(64); // Play limits obfuscatedAccountId to 64 characters.
    expect(playAccountId(id)).not.toContain(id);
  });
});

describe("availableProducts", () => {
  it("lists only enabled products, token packs first by size, with catalog quantities", () => {
    const list = availableProducts(
      [
        { product_id: "rentmate_monthly", kind: "subscription", enabled: true, catalog_sku: null },
        {
          product_id: "rentmate_tokens_250",
          kind: "token_package",
          enabled: true,
          catalog_sku: "planning_250",
        },
        {
          product_id: "rentmate_tokens_50",
          kind: "token_package",
          enabled: true,
          catalog_sku: "planning_50",
        },
        {
          product_id: "rentmate_tokens_500",
          kind: "token_package",
          enabled: false,
          catalog_sku: "planning_500",
        },
      ],
      [
        { sku: "planning_50", token_quantity: 50 },
        { sku: "planning_250", token_quantity: 250 },
        { sku: "planning_500", token_quantity: 500 },
      ],
    );
    expect(list.map((p) => [p.productId, p.tokens])).toEqual([
      ["rentmate_tokens_50", 50],
      ["rentmate_tokens_250", 250],
      ["rentmate_monthly", null],
    ]);
  });
});

describe("verifyWithServer", () => {
  it("posts the purchase token to the billing route with the member's session", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({ outcome: "credited", tokens: 50, message: "Tokens added to your wallet." }),
      );
    }) as unknown as typeof fetch;
    const res = await verifyWithServer({
      base: "https://api.test",
      token: "session-token",
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: "purchase-token-123",
      fetchFn,
    });
    expect(res.outcome).toBe("credited");
    expect(seen!.url).toBe(`https://api.test${BILLING_ROUTE}`);
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
    expect(JSON.parse(String(seen!.init.body))).toEqual({
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: "purchase-token-123",
    });
  });

  it("surfaces the server's refusal message", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: "This purchase belongs to another account." }), {
        status: 403,
      })) as unknown as typeof fetch;
    await expect(
      verifyWithServer({
        base: "https://api.test",
        token: "t",
        kind: "token_package",
        productId: "p_x",
        purchaseToken: "t",
        fetchFn,
      }),
    ).rejects.toThrow(ApiError);
  });
});
