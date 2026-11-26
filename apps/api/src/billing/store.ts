import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface RecordInput {
  userId: string;
  productId: string;
  fingerprint: string;
  orderId: string | null;
  /** purchased | pending | cancelled | unknown (products) or active | grace | expired | revoked | pending (subscriptions). */
  state: string;
  test: boolean;
  quantity: number;
  purchasedAt: string | null;
  periodEnd: string | null;
}

export interface RecordResult {
  outcome: string;
  tokens: number;
  status?: string;
  balance?: number;
}

export interface KnownPurchase {
  userId: string;
  productId: string;
  kind: "token_package" | "subscription";
  status: string;
}

/**
 * Database side of billing. Every call presents the 'play_billing' integration secret to a security-definer function;
 * the API holds only the publishable key. The database decides whether anything is credited (sandbox gates, tester
 * accounts, enabled products) and keeps the purchase idempotent per token fingerprint.
 */
export interface BillingStore {
  record(input: RecordInput): Promise<RecordResult>;
  markCompleted(fingerprint: string, consumed: boolean): Promise<void>;
  revoke(fingerprint: string, reason: string): Promise<{ outcome: string; reversed?: number }>;
  rtdnFirstSeen(messageId: string): Promise<boolean>;
  byFingerprint(fingerprint: string): Promise<KnownPurchase | null>;
}

export class BillingStoreError extends Error {}

const fail = (error: { message?: string }): never => {
  throw new BillingStoreError(error.message ?? "Database error");
};

export class SupabaseBillingStore implements BillingStore {
  private db: SupabaseClient;

  constructor(
    url: string,
    publishableKey: string,
    private readonly secret: string,
  ) {
    this.db = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async record(i: RecordInput) {
    const { data, error } = await this.db.rpc("billing_record_play_purchase", {
      p_secret: this.secret,
      p_user: i.userId,
      p_product: i.productId,
      p_fingerprint: i.fingerprint,
      p_order: i.orderId,
      p_state: i.state,
      p_test: i.test,
      p_quantity: i.quantity,
      p_purchased_at: i.purchasedAt,
      p_period_end: i.periodEnd,
    });
    if (error) fail(error);
    const r = (data ?? {}) as Record<string, unknown>;
    return {
      outcome: String(r.outcome ?? "unknown"),
      tokens: Number(r.tokens ?? 0),
      status: typeof r.status === "string" ? r.status : undefined,
      balance: r.balance === undefined || r.balance === null ? undefined : Number(r.balance),
    };
  }

  async markCompleted(fingerprint: string, consumed: boolean) {
    const { error } = await this.db.rpc("billing_mark_completed", {
      p_secret: this.secret,
      p_fingerprint: fingerprint,
      p_consumed: consumed,
    });
    if (error) fail(error);
  }

  async revoke(fingerprint: string, reason: string) {
    const { data, error } = await this.db.rpc("billing_revoke_play_purchase", {
      p_secret: this.secret,
      p_fingerprint: fingerprint,
      p_reason: reason,
    });
    if (error) fail(error);
    const r = (data ?? {}) as Record<string, unknown>;
    return {
      outcome: String(r.outcome ?? "unknown"),
      reversed: r.reversed === undefined ? undefined : Number(r.reversed),
    };
  }

  async rtdnFirstSeen(messageId: string) {
    const { data, error } = await this.db.rpc("billing_rtdn_first_seen", {
      p_secret: this.secret,
      p_message_id: messageId,
    });
    if (error) fail(error);
    return data === true;
  }

  async byFingerprint(fingerprint: string) {
    const { data, error } = await this.db.rpc("billing_purchase_by_fingerprint", {
      p_secret: this.secret,
      p_fingerprint: fingerprint,
    });
    if (error) fail(error);
    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      userId: String(row.user_id),
      productId: String(row.product_id),
      kind: row.kind === "subscription" ? "subscription" : "token_package",
      status: String(row.status),
    } satisfies KnownPurchase;
  }
}
