import { timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  interpretProduct,
  interpretSubscription,
  playAccountId,
  PlayPurchaseNotFound,
  tokenFingerprint,
  type PlayApi,
} from "./googlePlay.js";
import type { BillingStore, RecordResult } from "./store.js";

export interface BillingDeps {
  play: PlayApi;
  store: BillingStore;
  packageName: string;
  /** Shared token Google Cloud Pub/Sub presents on the push endpoint (?token=...). */
  rtdnToken: string;
}

export const PurchaseInput = z.object({
  kind: z.enum(["token_package", "subscription"]),
  productId: z.string().regex(/^[a-z0-9][a-z0-9_.]{2,98}$/),
  purchaseToken: z.string().min(10).max(4096),
});
export type PurchaseInput = z.infer<typeof PurchaseInput>;

const MESSAGES: Record<string, string> = {
  credited: "Tokens added to your wallet.",
  already_recorded: "This purchase was already recorded.",
  entitled: "Subscription active.",
  subscription_updated: "Subscription updated.",
  not_purchased: "The purchase is not complete yet. Tokens are added once Google Play confirms payment.",
  not_entitled: "This subscription is not active.",
  product_not_enabled: "This product is not available yet.",
  billing_disabled: "Purchases are not available yet.",
  live_purchases_disabled:
    "Only test purchases are accepted during testing. You have not been charged by RentMate.",
  not_a_tester: "Purchases are limited to test accounts during testing.",
  token_reused: "This purchase belongs to another account.",
  not_applied: "This subscription can no longer be renewed here.",
};

const publicResult = (r: RecordResult) => ({
  outcome: r.outcome,
  tokens: r.tokens,
  ...(r.balance === undefined ? {} : { balance: r.balance }),
  message: MESSAGES[r.outcome] ?? "Purchase processed.",
});

/**
 * Verifies a purchase with Google Play and records it. Order matters: Google first (the only source of truth), then
 * the database (which decides whether to credit), then acknowledge/consume with Google only when the database
 * recorded the purchase. Refused purchases stay unacknowledged, so Google refunds them automatically after 3 days.
 */
export async function verifyAndRecord(deps: BillingDeps, userId: string, input: PurchaseInput) {
  const fingerprint = tokenFingerprint(input.purchaseToken);
  if (input.kind === "token_package") {
    const p = interpretProduct(await deps.play.getProduct(input.productId, input.purchaseToken));
    if (p.accountId !== playAccountId(userId)) return { status: 403 as const, outcome: "account_mismatch" };
    const result = await deps.store.record({
      userId,
      productId: input.productId,
      fingerprint,
      orderId: p.orderId,
      state: p.state,
      test: p.test,
      quantity: p.quantity,
      purchasedAt: p.purchasedAt,
      periodEnd: null,
    });
    const recorded =
      result.outcome === "credited" ||
      (result.outcome === "already_recorded" && result.status === "credited");
    if (recorded && !p.consumed) {
      // Consuming also acknowledges, and lets the member buy the same pack again.
      await deps.play.consumeProduct(input.productId, input.purchaseToken);
      await deps.store.markCompleted(fingerprint, true);
    }
    return { status: 200 as const, result };
  }
  const s = interpretSubscription(await deps.play.getSubscription(input.purchaseToken));
  if (s.productId !== input.productId) return { status: 400 as const, outcome: "product_mismatch" };
  if (s.accountId !== playAccountId(userId)) return { status: 403 as const, outcome: "account_mismatch" };
  const result = await deps.store.record({
    userId,
    productId: input.productId,
    fingerprint,
    orderId: s.orderId,
    state: s.state,
    test: s.test,
    quantity: 1,
    purchasedAt: s.startedAt,
    periodEnd: s.periodEnd,
  });
  if ((result.outcome === "entitled" || result.outcome === "subscription_updated") && !s.acknowledged) {
    await deps.play.acknowledgeSubscription(input.productId, input.purchaseToken);
    await deps.store.markCompleted(fingerprint, false);
  }
  return { status: 200 as const, result };
}

/** POST /api/v1/billing/google/purchases (behind requireAuth). */
export function billingRouter(deps: BillingDeps | null) {
  const r = express.Router();
  r.post(
    "/google/purchases",
    rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false }),
    async (req: Request, res: Response) => {
      if (!deps) {
        res.status(503).json({ error: "Purchases are not set up on this server." });
        return;
      }
      const parsed = PurchaseInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid purchase" });
        return;
      }
      try {
        const out = await verifyAndRecord(deps, req.user!.id, parsed.data);
        if (out.status !== 200) {
          res.status(out.status).json({
            error:
              out.outcome === "account_mismatch"
                ? "This purchase belongs to another account."
                : "The purchase does not match the product.",
            outcome: out.outcome,
          });
          return;
        }
        res.json(publicResult(out.result));
      } catch (err) {
        if (err instanceof PlayPurchaseNotFound) {
          res
            .status(400)
            .json({ error: "Google Play does not recognise this purchase.", outcome: "invalid_purchase" });
          return;
        }
        console.error("[api] purchase verification failed:", err instanceof Error ? err.message : err);
        // Nothing was acknowledged; the app can retry with the same token safely.
        res.status(502).json({ error: "Could not verify the purchase. Please try again." });
      }
    },
  );
  return r;
}

const RtdnBody = z.object({
  message: z.object({ data: z.string().max(65_536), messageId: z.string().min(1).max(200) }),
});

interface Notification {
  packageName?: string;
  oneTimeProductNotification?: { notificationType?: number; purchaseToken?: string; sku?: string };
  subscriptionNotification?: { notificationType?: number; purchaseToken?: string; subscriptionId?: string };
  voidedPurchaseNotification?: { purchaseToken?: string; refundType?: number };
  testNotification?: unknown;
}

const SUBSCRIPTION_REVOKED = 12;

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Applies one decoded notification. Every step is idempotent, so Pub/Sub redelivery is safe. */
export async function handleNotification(deps: BillingDeps, n: Notification): Promise<string> {
  if (n.testNotification !== undefined) return "test";
  if (n.voidedPurchaseNotification?.purchaseToken) {
    const r = await deps.store.revoke(tokenFingerprint(n.voidedPurchaseNotification.purchaseToken), "voided");
    return r.outcome;
  }
  const token = n.subscriptionNotification?.purchaseToken ?? n.oneTimeProductNotification?.purchaseToken;
  if (!token) return "ignored";
  const fingerprint = tokenFingerprint(token);
  // Credit only ever happens when the member's own app presents the purchase (account binding). Notifications only
  // update purchases the database already knows.
  const known = await deps.store.byFingerprint(fingerprint);
  if (!known) return "unknown_purchase";
  if (known.kind === "subscription") {
    if (n.subscriptionNotification?.notificationType === SUBSCRIPTION_REVOKED) {
      return (await deps.store.revoke(fingerprint, "subscription revoked")).outcome;
    }
    const s = interpretSubscription(await deps.play.getSubscription(token));
    const r = await deps.store.record({
      userId: known.userId,
      productId: known.productId,
      fingerprint,
      orderId: s.orderId,
      state: s.state,
      test: s.test,
      quantity: 1,
      purchasedAt: s.startedAt,
      periodEnd: s.periodEnd,
    });
    return r.outcome;
  }
  const p = interpretProduct(await deps.play.getProduct(known.productId, token));
  if (p.state === "cancelled") return (await deps.store.revoke(fingerprint, "cancelled")).outcome;
  return "no_change";
}

/** POST /api/v1/billing/google/rtdn: Google Play Real-time Developer Notifications via Pub/Sub push. */
export function rtdnRouter(deps: BillingDeps | null) {
  const r = express.Router();
  r.post(
    "/",
    rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false }),
    async (req: Request, res: Response) => {
      if (!deps) {
        res.status(503).json({ error: "Notifications are not set up on this server." });
        return;
      }
      const presented = typeof req.query.token === "string" ? req.query.token : "";
      if (!sameSecret(presented, deps.rtdnToken)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const parsed = RtdnBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid notification" }); // Not retried usefully; acknowledge-equivalent.
        return;
      }
      let n: Notification;
      try {
        n = JSON.parse(Buffer.from(parsed.data.message.data, "base64").toString("utf8")) as Notification;
      } catch {
        res.status(400).json({ error: "Invalid notification" });
        return;
      }
      if (n.packageName !== deps.packageName) {
        res.status(400).json({ error: "Wrong package" });
        return;
      }
      try {
        const outcome = await handleNotification(deps, n);
        const first = await deps.store.rtdnFirstSeen(parsed.data.message.messageId);
        res.json({ ok: true, outcome, duplicate: !first });
      } catch (err) {
        console.error("[api] notification failed:", err instanceof Error ? err.message : err);
        res.status(500).json({ error: "Could not process the notification" }); // Pub/Sub retries.
      }
    },
  );
  return r;
}
