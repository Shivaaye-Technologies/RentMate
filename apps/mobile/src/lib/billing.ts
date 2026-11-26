/**
 * Google Play Billing, the parts that do not touch the native module (unit-tested). The device never decides whether
 * tokens are granted: it sends the purchase token to the RentMate API, which verifies it with Google, records it in
 * the database (sandbox and tester accounts only) and consumes or acknowledges it with Google.
 */
import { apiRequest, ApiError } from "./api";

export const BILLING_ROUTE = "/api/v1/billing/google/purchases" as const;

export type StoreKind = "token_package" | "subscription";

/** A product the server lists in public.store_products, joined with its token quantity. */
export type StoreProduct = {
  productId: string;
  kind: StoreKind;
  tokens: number | null;
};

/** Small, dependency-free SHA-256 (FIPS 180-4) for the account binding below. Returns lower-case hex. */
export function sha256Hex(text: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = Array.from(new TextEncoder().encode(text));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  for (const word of [high, bitLength >>> 0]) {
    bytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + next[i]) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

/**
 * Value passed to Play Billing as obfuscatedAccountId. Must equal playAccountId() in apps/api/src/billing/googlePlay.ts:
 * the server refuses any purchase whose account id does not match the signed-in member.
 */
export const playAccountId = (userId: string) => sha256Hex(`rentmate:${userId}`);

export type VerifyResponse = { outcome: string; tokens: number; balance?: number; message: string };

/** Sends one purchase token to the server. Retry-safe: the server is idempotent per purchase token. */
export async function verifyWithServer(args: {
  base: string;
  token: string;
  kind: StoreKind;
  productId: string;
  purchaseToken: string;
  fetchFn?: typeof fetch;
}): Promise<VerifyResponse> {
  const body = { kind: args.kind, productId: args.productId, purchaseToken: args.purchaseToken };
  const res = await apiRequest<VerifyResponse>({
    base: args.base,
    token: args.token,
    method: "POST",
    path: BILLING_ROUTE,
    body,
    fetchFn: args.fetchFn,
  });
  if (!res) throw new ApiError({ kind: "http", status: 502, message: "No answer from the server." });
  return res;
}

/** True when the server has finished with this purchase (credited, recorded, or refused for good). */
export function isFinalOutcome(outcome: string) {
  return !["not_purchased"].includes(outcome);
}

/** What the member sees while a purchase is pending in Google Play (cash, UPI collect, etc.). */
export const PENDING_MESSAGE =
  "Your purchase is waiting for payment confirmation from Google Play. No tokens are added until it completes.";

export const BILLING_UNAVAILABLE =
  "Purchases are not available yet. Token packs open for test accounts during testing only.";

/** Joins server product rows with the token catalog. Disabled products are never shown. */
export function availableProducts(
  rows: { product_id: string; kind: string; enabled: boolean; catalog_sku: string | null }[],
  catalog: { sku: string; token_quantity: number }[],
): StoreProduct[] {
  const tokens = new Map(catalog.map((c) => [c.sku, c.token_quantity]));
  return rows
    .filter((r) => r.enabled && (r.kind === "token_package" || r.kind === "subscription"))
    .map((r) => ({
      productId: r.product_id,
      kind: r.kind as StoreKind,
      tokens: r.catalog_sku ? (tokens.get(r.catalog_sku) ?? null) : null,
    }))
    .sort((a, b) =>
      a.kind === b.kind ? (a.tokens ?? 0) - (b.tokens ?? 0) : a.kind === "token_package" ? -1 : 1,
    );
}
