import { createVerify, generateKeyPairSync } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import {
  GooglePlayClient,
  interpretProduct,
  interpretSubscription,
  parseServiceAccount,
  playAccountId,
  PlayPurchaseNotFound,
  tokenFingerprint,
  type PlayApi,
  type PlayProductPurchase,
  type PlaySubscriptionPurchase,
} from "../src/billing/googlePlay.js";
import type { BillingDeps } from "../src/billing/routes.js";
import type { BillingStore, KnownPurchase, RecordInput, RecordResult } from "../src/billing/store.js";
import { MemoryProfileStore } from "../src/store.js";

const config = loadConfig({ NODE_ENV: "test" });
const verifier: TokenVerifier = async (t) =>
  t === "token-alice" ? { id: "alice" } : t === "token-bob" ? { id: "bob" } : null;
const PKG = "com.shivaayetechnologies.rentmate";
const RTDN = "rtdn_token_0123456789_abcdefghijklmnopqrstuv";
const TOKEN = "play-purchase-token-aaaaaaaaaaaaaaaaaaaa";

/** Fake Google: a map of purchase tokens to purchases, plus a call log. */
class FakePlay implements PlayApi {
  products = new Map<string, PlayProductPurchase>();
  subs = new Map<string, PlaySubscriptionPurchase>();
  calls: string[] = [];
  failWith: Error | null = null;
  async getProduct(productId: string, token: string) {
    this.calls.push(`get ${productId}`);
    if (this.failWith) throw this.failWith;
    const p = this.products.get(token);
    if (!p) throw new PlayPurchaseNotFound("no");
    return p;
  }
  async getSubscription(token: string) {
    this.calls.push("getSub");
    const s = this.subs.get(token);
    if (!s) throw new PlayPurchaseNotFound("no");
    return s;
  }
  async acknowledgeProduct(productId: string) {
    this.calls.push(`ack ${productId}`);
  }
  async consumeProduct(productId: string) {
    this.calls.push(`consume ${productId}`);
  }
  async acknowledgeSubscription(productId: string) {
    this.calls.push(`ackSub ${productId}`);
  }
}

/** Mirrors the database contract closely enough for the routes (the SQL itself is tested in supabase/tests). */
class FakeStore implements BillingStore {
  rows = new Map<string, KnownPurchase & { tokens: number }>();
  recorded: RecordInput[] = [];
  completed: string[] = [];
  revoked: string[] = [];
  seen = new Set<string>();
  testerOnly = true;
  async record(i: RecordInput): Promise<RecordResult> {
    this.recorded.push(i);
    const prior = this.rows.get(i.fingerprint);
    if (prior) {
      if (prior.userId !== i.userId) return { outcome: "token_reused", tokens: 0 };
      if (prior.kind === "subscription")
        return { outcome: "subscription_updated", tokens: 0, status: i.state };
      return { outcome: "already_recorded", tokens: prior.tokens, status: prior.status };
    }
    if (!i.test) return { outcome: "live_purchases_disabled", tokens: 0 };
    if (i.productId.startsWith("rentmate_tokens_")) {
      if (i.state !== "purchased") return { outcome: "not_purchased", tokens: 0 };
      const tokens = Number(i.productId.split("_")[2]) * i.quantity;
      this.rows.set(i.fingerprint, {
        userId: i.userId,
        productId: i.productId,
        kind: "token_package",
        status: "credited",
        tokens,
      });
      return { outcome: "credited", tokens, balance: 1000 + tokens };
    }
    if (i.state !== "active" && i.state !== "grace") return { outcome: "not_entitled", tokens: 0 };
    this.rows.set(i.fingerprint, {
      userId: i.userId,
      productId: i.productId,
      kind: "subscription",
      status: "entitled",
      tokens: 0,
    });
    return { outcome: "entitled", tokens: 0, status: i.state };
  }
  async markCompleted(fp: string, consumed: boolean) {
    this.completed.push(`${fp}:${consumed}`);
  }
  async revoke(fp: string) {
    this.revoked.push(fp);
    return { outcome: this.rows.has(fp) ? "revoked" : "unknown_purchase" };
  }
  async rtdnFirstSeen(id: string) {
    const first = !this.seen.has(id);
    this.seen.add(id);
    return first;
  }
  async byFingerprint(fp: string) {
    return this.rows.get(fp) ?? null;
  }
}

const setup = () => {
  const play = new FakePlay();
  const store = new FakeStore();
  const billing: BillingDeps = { play, store, packageName: PKG, rtdnToken: RTDN };
  const app = createApp({ config, verifyToken: verifier, storeFor: () => new MemoryProfileStore(), billing });
  return { play, store, app };
};

const testProduct = (over: Partial<PlayProductPurchase> = {}): PlayProductPurchase => ({
  purchaseState: 0,
  consumptionState: 0,
  acknowledgementState: 0,
  purchaseType: 0,
  orderId: "GPA.3333-0000",
  purchaseTimeMillis: "1795000000000",
  quantity: 1,
  obfuscatedExternalAccountId: playAccountId("alice"),
  ...over,
});

const buy = (app: ReturnType<typeof setup>["app"], body: object, as = "token-alice") =>
  request(app).post("/api/v1/billing/google/purchases").set("Authorization", `Bearer ${as}`).send(body);

const push = (app: ReturnType<typeof setup>["app"], notification: object, id = "m1", token = RTDN) =>
  request(app)
    .post(`/api/v1/billing/google/rtdn?token=${token}`)
    .send({ message: { messageId: id, data: Buffer.from(JSON.stringify(notification)).toString("base64") } });

describe("Google Play response interpretation", () => {
  it("reads product purchase state, test flag and account binding", () => {
    expect(interpretProduct(testProduct())).toMatchObject({
      state: "purchased",
      test: true,
      quantity: 1,
      consumed: false,
    });
    expect(interpretProduct(testProduct({ purchaseState: 2 })).state).toBe("pending");
    expect(interpretProduct(testProduct({ purchaseState: 1 })).state).toBe("cancelled");
    // Real purchases have no purchaseType; promo (1) and rewarded (2) are not test purchases either.
    expect(interpretProduct(testProduct({ purchaseType: undefined })).test).toBe(false);
    expect(interpretProduct(testProduct({ purchaseType: 1 })).test).toBe(false);
    expect(interpretProduct(testProduct({ quantity: 0 })).quantity).toBe(1);
  });

  it("maps subscription states and treats a lapsed period as expired", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const base = { lineItems: [{ productId: "rentmate_monthly", expiryTime: future }], testPurchase: {} };
    expect(interpretSubscription({ ...base, subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" })).toMatchObject({
      state: "active",
      test: true,
      productId: "rentmate_monthly",
    });
    expect(
      interpretSubscription({ ...base, subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" }).state,
    ).toBe("grace");
    expect(interpretSubscription({ ...base, subscriptionState: "SUBSCRIPTION_STATE_ON_HOLD" }).state).toBe(
      "expired",
    );
    expect(
      interpretSubscription({
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        lineItems: [{ productId: "rentmate_monthly", expiryTime: "2020-01-01T00:00:00Z" }],
      }).state,
    ).toBe("expired");
    expect(interpretSubscription({ subscriptionState: "SOMETHING_NEW" }).state).toBe("pending");
  });

  it("fingerprints tokens one-way and hashes the account id", () => {
    expect(tokenFingerprint(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenFingerprint(TOKEN)).not.toContain(TOKEN);
    expect(playAccountId("alice")).toMatch(/^[0-9a-f]{64}$/);
    expect(playAccountId("alice")).not.toBe(playAccountId("bob"));
  });
});

describe("POST /api/v1/billing/google/purchases", () => {
  it("needs a signed-in member", async () => {
    const { app } = setup();
    expect((await request(app).post("/api/v1/billing/google/purchases").send({})).status).toBe(401);
  });

  it("answers 503 when billing is not configured", async () => {
    const app = createApp({ config, verifyToken: verifier, storeFor: () => new MemoryProfileStore() });
    const res = await buy(app, {
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: TOKEN,
    });
    expect(res.status).toBe(503);
  });

  it("rejects malformed input before calling Google", async () => {
    const { app, play } = setup();
    const res = await buy(app, { kind: "token_package", productId: "../x", purchaseToken: TOKEN });
    expect(res.status).toBe(400);
    expect(play.calls).toEqual([]);
  });

  it("verifies with Google, records, then consumes; never stores the raw token", async () => {
    const { app, play, store } = setup();
    play.products.set(TOKEN, testProduct());
    const res = await buy(app, {
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: TOKEN,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: "credited", tokens: 50, balance: 1050 });
    expect(play.calls).toEqual(["get rentmate_tokens_50", "consume rentmate_tokens_50"]);
    expect(store.recorded[0]).toMatchObject({
      userId: "alice",
      state: "purchased",
      test: true,
      fingerprint: tokenFingerprint(TOKEN),
    });
    expect(JSON.stringify(store.recorded)).not.toContain(TOKEN);
    expect(store.completed).toEqual([`${tokenFingerprint(TOKEN)}:true`]);
  });

  it("is idempotent: a retry credits nothing more and does not consume twice", async () => {
    const { app, play } = setup();
    play.products.set(TOKEN, testProduct());
    await buy(app, { kind: "token_package", productId: "rentmate_tokens_50", purchaseToken: TOKEN });
    play.products.set(TOKEN, testProduct({ consumptionState: 1, acknowledgementState: 1 }));
    const res = await buy(app, {
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: TOKEN,
    });
    expect(res.body.outcome).toBe("already_recorded");
    expect(play.calls.filter((c) => c.startsWith("consume"))).toHaveLength(1);
  });

  it("refuses a purchase bound to another account and records nothing", async () => {
    const { app, play, store } = setup();
    play.products.set(TOKEN, testProduct());
    const res = await buy(
      app,
      { kind: "token_package", productId: "rentmate_tokens_50", purchaseToken: TOKEN },
      "token-bob",
    );
    expect(res.status).toBe(403);
    expect(store.recorded).toEqual([]);
    expect(play.calls).not.toContain("consume rentmate_tokens_50");
  });

  it("refuses an unbound purchase (no obfuscated account id)", async () => {
    const { app, play, store } = setup();
    play.products.set(TOKEN, testProduct({ obfuscatedExternalAccountId: undefined }));
    const res = await buy(app, {
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: TOKEN,
    });
    expect(res.status).toBe(403);
    expect(store.recorded).toEqual([]);
  });

  it("does not consume pending or refused purchases (Google refunds unacknowledged ones)", async () => {
    const { app, play } = setup();
    play.products.set(TOKEN, testProduct({ purchaseState: 2 }));
    const pending = await buy(app, {
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: TOKEN,
    });
    expect(pending.body.outcome).toBe("not_purchased");
    play.products.set("real-token-bbbbbbbbbbbbbbb", testProduct({ purchaseType: undefined }));
    const real = await buy(app, {
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: "real-token-bbbbbbbbbbbbbbb",
    });
    expect(real.body.outcome).toBe("live_purchases_disabled");
    expect(play.calls.some((c) => c.startsWith("consume") || c.startsWith("ack"))).toBe(false);
  });

  it("answers 400 for a token Google does not recognise", async () => {
    const { app, store } = setup();
    const res = await buy(app, {
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: TOKEN,
    });
    expect(res.status).toBe(400);
    expect(res.body.outcome).toBe("invalid_purchase");
    expect(store.recorded).toEqual([]);
  });

  it("answers 502 on a Google outage without recording anything", async () => {
    const { app, play, store } = setup();
    play.failWith = new Error("Google Play API failed (503)");
    const res = await buy(app, {
      kind: "token_package",
      productId: "rentmate_tokens_50",
      purchaseToken: TOKEN,
    });
    expect(res.status).toBe(502);
    expect(store.recorded).toEqual([]);
  });

  it("activates a verified subscription and acknowledges it", async () => {
    const { app, play, store } = setup();
    play.subs.set(TOKEN, {
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      testPurchase: {},
      lineItems: [
        { productId: "rentmate_monthly", expiryTime: new Date(Date.now() + 30 * 86_400_000).toISOString() },
      ],
      externalAccountIdentifiers: { obfuscatedExternalAccountId: playAccountId("alice") },
    });
    const res = await buy(app, { kind: "subscription", productId: "rentmate_monthly", purchaseToken: TOKEN });
    expect(res.body.outcome).toBe("entitled");
    expect(play.calls).toEqual(["getSub", "ackSub rentmate_monthly"]);
    expect(store.completed).toEqual([`${tokenFingerprint(TOKEN)}:false`]);
  });

  it("refuses a subscription token for a different product", async () => {
    const { app, play, store } = setup();
    play.subs.set(TOKEN, {
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      lineItems: [{ productId: "other_plan", expiryTime: new Date(Date.now() + 86_400_000).toISOString() }],
      externalAccountIdentifiers: { obfuscatedExternalAccountId: playAccountId("alice") },
    });
    const res = await buy(app, { kind: "subscription", productId: "rentmate_monthly", purchaseToken: TOKEN });
    expect(res.status).toBe(400);
    expect(store.recorded).toEqual([]);
  });
});

describe("POST /api/v1/billing/google/rtdn", () => {
  it("answers 503 when billing is not configured", async () => {
    const app = createApp({ config, verifyToken: verifier, storeFor: () => new MemoryProfileStore() });
    expect((await push(app, { packageName: PKG })).status).toBe(503);
  });

  it("refuses a wrong or missing push token", async () => {
    const { app, store } = setup();
    expect((await push(app, { packageName: PKG }, "m1", "wrong")).status).toBe(401);
    expect((await request(app).post("/api/v1/billing/google/rtdn").send({})).status).toBe(401);
    expect(store.seen.size).toBe(0);
  });

  it("refuses notifications for another package", async () => {
    const { app } = setup();
    expect((await push(app, { packageName: "com.example.other", testNotification: {} })).status).toBe(400);
  });

  it("accepts test notifications and reports duplicates", async () => {
    const { app } = setup();
    expect((await push(app, { packageName: PKG, testNotification: {} })).body).toMatchObject({
      outcome: "test",
      duplicate: false,
    });
    expect((await push(app, { packageName: PKG, testNotification: {} })).body.duplicate).toBe(true);
  });

  it("reverses a voided purchase", async () => {
    const { app, play, store } = setup();
    play.products.set(TOKEN, testProduct());
    await buy(app, { kind: "token_package", productId: "rentmate_tokens_50", purchaseToken: TOKEN });
    const res = await push(app, {
      packageName: PKG,
      voidedPurchaseNotification: { purchaseToken: TOKEN, refundType: 1 },
    });
    expect(res.body.outcome).toBe("revoked");
    expect(store.revoked).toEqual([tokenFingerprint(TOKEN)]);
  });

  it("never credits from a notification about an unknown purchase", async () => {
    const { app, play, store } = setup();
    play.products.set(TOKEN, testProduct());
    const res = await push(app, {
      packageName: PKG,
      oneTimeProductNotification: { notificationType: 1, purchaseToken: TOKEN, sku: "rentmate_tokens_50" },
    });
    expect(res.body.outcome).toBe("unknown_purchase");
    expect(store.recorded).toEqual([]);
    expect(play.calls).toEqual([]);
  });

  it("re-fetches subscription state from Google and revokes on SUBSCRIPTION_REVOKED", async () => {
    const { app, play, store } = setup();
    const sub: PlaySubscriptionPurchase = {
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      testPurchase: {},
      lineItems: [
        { productId: "rentmate_monthly", expiryTime: new Date(Date.now() + 86_400_000).toISOString() },
      ],
      externalAccountIdentifiers: { obfuscatedExternalAccountId: playAccountId("alice") },
    };
    play.subs.set(TOKEN, sub);
    await buy(app, { kind: "subscription", productId: "rentmate_monthly", purchaseToken: TOKEN });
    play.subs.set(TOKEN, { ...sub, subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" });
    const grace = await push(app, {
      packageName: PKG,
      subscriptionNotification: {
        notificationType: 6,
        purchaseToken: TOKEN,
        subscriptionId: "rentmate_monthly",
      },
    });
    expect(grace.body.outcome).toBe("subscription_updated");
    expect(store.recorded.at(-1)).toMatchObject({ userId: "alice", state: "grace" });
    const revoked = await push(
      app,
      { packageName: PKG, subscriptionNotification: { notificationType: 12, purchaseToken: TOKEN } },
      "m2",
    );
    expect(revoked.body.outcome).toBe("revoked");
  });
});

describe("GooglePlayClient", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const account = parseServiceAccount(
    JSON.stringify({ client_email: "billing@test.iam.gserviceaccount.com", private_key: pem }),
  );

  it("signs an RS256 service-account assertion, caches the access token and calls androidpublisher", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const http = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url.includes("oauth2"))
        return new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600 }));
      return new Response(JSON.stringify({ purchaseState: 0, purchaseType: 0 }));
    }) as typeof fetch;
    const client = new GooglePlayClient(PKG, account, http);
    expect((await client.getProduct("rentmate_tokens_50", "tok/en")).purchaseState).toBe(0);
    await client.getProduct("rentmate_tokens_50", "tok/en");
    expect(seen.filter((s) => s.url.includes("oauth2"))).toHaveLength(1);
    const assertion = new URLSearchParams(String(seen[0].init?.body)).get("assertion")!;
    const [h, p, sig] = assertion.split(".");
    expect(
      createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url")),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({
      iss: "billing@test.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/androidpublisher",
    });
    expect(seen[1].url).toBe(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/purchases/products/rentmate_tokens_50/tokens/tok%2Fen`,
    );
    expect(seen[1].init?.headers).toMatchObject({ authorization: "Bearer at-1" });
  });

  it("maps 404 to PlayPurchaseNotFound and other failures to errors", async () => {
    let status = 404;
    const http = (async (url: string) =>
      url.includes("oauth2")
        ? new Response(JSON.stringify({ access_token: "at" }))
        : new Response("{}", { status })) as typeof fetch;
    const client = new GooglePlayClient(PKG, account, http);
    await expect(client.getSubscription("t")).rejects.toBeInstanceOf(PlayPurchaseNotFound);
    status = 500;
    await expect(client.getSubscription("t")).rejects.not.toBeInstanceOf(PlayPurchaseNotFound);
  });

  it("rejects bad service-account JSON without echoing it", () => {
    expect(() => parseServiceAccount("{not json SECRETVALUE")).toThrow(/not valid JSON/);
    try {
      parseServiceAccount('{"private_key":"SECRETVALUE"}');
    } catch (e) {
      expect(String(e)).not.toContain("SECRETVALUE");
    }
  });
});

describe("billing configuration", () => {
  it("redacts billing secrets when printed", () => {
    const c = loadConfig({
      NODE_ENV: "test",
      GOOGLE_PLAY_PACKAGE_NAME: PKG,
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '{"private_key":"PK-SECRET"}',
      BILLING_DB_SECRET: "db-secret-0123456789-0123456789-xyz",
      GOOGLE_PLAY_RTDN_TOKEN: RTDN,
    });
    const printed = JSON.stringify(c);
    expect(printed).not.toContain("PK-SECRET");
    expect(printed).not.toContain("db-secret-0123456789");
    expect(printed).not.toContain(RTDN);
  });

  it("rejects a weak or URL-unsafe RTDN token and a bad package name", () => {
    expect(() => loadConfig({ NODE_ENV: "test", GOOGLE_PLAY_RTDN_TOKEN: "short" })).toThrow();
    expect(() => loadConfig({ NODE_ENV: "test", GOOGLE_PLAY_RTDN_TOKEN: "a&b".repeat(20) })).toThrow();
    expect(() => loadConfig({ NODE_ENV: "test", GOOGLE_PLAY_PACKAGE_NAME: "Not A Package" })).toThrow();
  });
});
