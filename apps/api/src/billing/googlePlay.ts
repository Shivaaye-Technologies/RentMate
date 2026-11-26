import { createHash, createSign } from "node:crypto";

/**
 * Google Play Developer API (androidpublisher v3), server-side only. The service-account key comes from the
 * GOOGLE_PLAY_SERVICE_ACCOUNT_JSON environment variable and never leaves this process. Every purchase is verified
 * here before any database write: tokens are never granted from a client callback, screenshot or redirect.
 */

/** One-time product purchase (purchases.products.get). Only the fields used are typed. */
export interface PlayProductPurchase {
  purchaseState?: number; // 0 purchased, 1 cancelled, 2 pending
  consumptionState?: number; // 0 yet to be consumed, 1 consumed
  acknowledgementState?: number; // 0 yet to be acknowledged, 1 acknowledged
  purchaseType?: number; // 0 test (license tester), 1 promo, 2 rewarded; absent for real purchases
  orderId?: string;
  purchaseTimeMillis?: string;
  quantity?: number;
  obfuscatedExternalAccountId?: string;
}

/** Subscription purchase (purchases.subscriptionsv2.get). */
export interface PlaySubscriptionPurchase {
  subscriptionState?: string;
  acknowledgementState?: string;
  testPurchase?: Record<string, never>;
  latestOrderId?: string;
  startTime?: string;
  lineItems?: { productId?: string; expiryTime?: string }[];
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
}

export interface PlayApi {
  getProduct(productId: string, token: string): Promise<PlayProductPurchase>;
  getSubscription(token: string): Promise<PlaySubscriptionPurchase>;
  acknowledgeProduct(productId: string, token: string): Promise<void>;
  consumeProduct(productId: string, token: string): Promise<void>;
  acknowledgeSubscription(productId: string, token: string): Promise<void>;
}

/** Google answered that the token is not a purchase of this app (invalid, wrong product or wrong package). */
export class PlayPurchaseNotFound extends Error {}

export type ProductState = "purchased" | "cancelled" | "pending" | "unknown";
export type SubscriptionState = "active" | "grace" | "expired" | "revoked" | "pending";

export interface VerifiedProduct {
  state: ProductState;
  test: boolean;
  quantity: number;
  orderId: string | null;
  purchasedAt: string | null;
  accountId: string | null;
  acknowledged: boolean;
  consumed: boolean;
}

export interface VerifiedSubscription {
  state: SubscriptionState;
  test: boolean;
  productId: string | null;
  periodEnd: string | null;
  orderId: string | null;
  startedAt: string | null;
  accountId: string | null;
  acknowledged: boolean;
}

/** One-way fingerprint of a purchase token: the only form the database stores. */
export const tokenFingerprint = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/**
 * The value the app passes to Play Billing as obfuscatedAccountId when it starts a purchase, so the server can refuse
 * a purchase token presented by any other account. A hash: Google never sees the member id.
 */
export const playAccountId = (userId: string) =>
  createHash("sha256").update(`rentmate:${userId}`, "utf8").digest("hex");

export function interpretProduct(p: PlayProductPurchase): VerifiedProduct {
  const state: ProductState =
    p.purchaseState === 0
      ? "purchased"
      : p.purchaseState === 1
        ? "cancelled"
        : p.purchaseState === 2
          ? "pending"
          : "unknown";
  const ms = Number(p.purchaseTimeMillis);
  return {
    state,
    // Only purchaseType 0 is a license-tester purchase. Promo and rewarded purchases are not test purchases.
    test: p.purchaseType === 0,
    quantity: Number.isInteger(p.quantity) && (p.quantity as number) > 0 ? (p.quantity as number) : 1,
    orderId: p.orderId ?? null,
    purchasedAt: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
    accountId: p.obfuscatedExternalAccountId ?? null,
    acknowledged: p.acknowledgementState === 1,
    consumed: p.consumptionState === 1,
  };
}

export function interpretSubscription(s: PlaySubscriptionPurchase): VerifiedSubscription {
  const map: Record<string, SubscriptionState> = {
    SUBSCRIPTION_STATE_ACTIVE: "active",
    SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace",
    // Cancelled by the member but paid to the end of the period: still entitled until expiry.
    SUBSCRIPTION_STATE_CANCELED: "active",
    SUBSCRIPTION_STATE_ON_HOLD: "expired",
    SUBSCRIPTION_STATE_PAUSED: "expired",
    SUBSCRIPTION_STATE_EXPIRED: "expired",
    SUBSCRIPTION_STATE_PENDING: "pending",
    SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: "expired",
  };
  const item = s.lineItems?.[0];
  let state: SubscriptionState = map[s.subscriptionState ?? ""] ?? "pending";
  const periodEnd = item?.expiryTime ?? null;
  if ((state === "active" || state === "grace") && (!periodEnd || Date.parse(periodEnd) <= Date.now())) {
    state = "expired";
  }
  return {
    state,
    test: s.testPurchase !== undefined,
    productId: item?.productId ?? null,
    periodEnd,
    orderId: s.latestOrderId ?? null,
    startedAt: s.startTime ?? null,
    accountId: s.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    acknowledged: s.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
  };
}

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** Parses the service-account JSON. Throws without echoing any part of it. */
export function parseServiceAccount(json: string): ServiceAccount {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  const o = v as Partial<ServiceAccount>;
  if (
    typeof o.client_email !== "string" ||
    typeof o.private_key !== "string" ||
    !o.private_key.includes("PRIVATE KEY")
  ) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must contain client_email and private_key");
  }
  return { client_email: o.client_email, private_key: o.private_key, token_uri: o.token_uri };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

type Fetch = typeof fetch;

/** Service-account OAuth (JWT bearer grant) plus the purchase endpoints. */
export class GooglePlayClient implements PlayApi {
  private cached: { token: string; expires: number } | null = null;

  constructor(
    private readonly packageName: string,
    private readonly account: ServiceAccount,
    private readonly http: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.expires > this.now() + 60_000) return this.cached.token;
    const iat = Math.floor(this.now() / 1000);
    const aud = this.account.token_uri ?? "https://oauth2.googleapis.com/token";
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
      JSON.stringify({ iss: this.account.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 }),
    )}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(this.account.private_key);
    const res = await this.http(aud, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${b64url(signature)}`,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Google OAuth failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Google OAuth returned no token");
    this.cached = { token: body.access_token, expires: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private async call<T>(path: string, method: "GET" | "POST"): Promise<T> {
    const res = await this.http(`${API}/${encodeURIComponent(this.packageName)}/${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    // 400/404/410: not a purchase of this app (or expired long ago). Anything else is a transient failure.
    if (res.status === 400 || res.status === 404 || res.status === 410) {
      throw new PlayPurchaseNotFound("Google Play does not recognise this purchase");
    }
    if (!res.ok) throw new Error(`Google Play API failed (${res.status})`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  getProduct(productId: string, token: string) {
    return this.call<PlayProductPurchase>(
      `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`,
      "GET",
    );
  }
  getSubscription(token: string) {
    return this.call<PlaySubscriptionPurchase>(
      `purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`,
      "GET",
    );
  }
  async acknowledgeProduct(productId: string, token: string) {
    await this.call(
      `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`,
      "POST",
    );
  }
  async consumeProduct(productId: string, token: string) {
    await this.call(
      `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`,
      "POST",
    );
  }
  async acknowledgeSubscription(productId: string, token: string) {
    await this.call(
      `purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`,
      "POST",
    );
  }
}
