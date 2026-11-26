import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ApiError } from "../lib/api";
import {
  availableProducts,
  BILLING_UNAVAILABLE,
  PENDING_MESSAGE,
  verifyWithServer,
  type StoreProduct,
} from "../lib/billing";
import { apiBaseUrl, supabase } from "../lib/supabase";
import { useSession } from "../session";
import { Body, Button, Notice, usePalette } from "../ui";

/**
 * Token packs and the monthly plan through Google Play (sandbox, tester accounts only). Hidden entirely unless the
 * server has the billing sandbox on and at least one product enabled. The server grants tokens; this screen only
 * starts the purchase and reports the server's answer.
 */
export function TokenStore({ onChanged }: { onChanged: () => void }) {
  const c = usePalette();
  const { session } = useSession();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [prices, setPrices] = useState<Record<string, { displayPrice: string; offerToken: string | null }>>(
    {},
  );
  const [state, setState] = useState<"loading" | "off" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const kinds = useRef(new Map<string, StoreProduct["kind"]>());
  const seen = useRef(new Set<string>());

  const verify = useCallback(
    async (productId: string, purchaseToken: string) => {
      const kind = kinds.current.get(productId);
      if (!session?.access_token || !kind || seen.current.has(purchaseToken)) return;
      seen.current.add(purchaseToken);
      try {
        const res = await verifyWithServer({
          base: apiBaseUrl,
          token: session.access_token,
          kind,
          productId,
          purchaseToken,
        });
        setMessage({
          kind: res.outcome === "credited" || res.outcome === "entitled" ? "info" : "error",
          text: res.message,
        });
        if (res.outcome === "not_purchased") seen.current.delete(purchaseToken);
        onChanged();
      } catch (e) {
        seen.current.delete(purchaseToken); // Safe to retry: the server is idempotent per purchase token.
        setMessage({
          kind: "error",
          text:
            e instanceof ApiError
              ? e.message
              : "Could not confirm the purchase. We will retry when you return.",
        });
      } finally {
        setBusy(null);
      }
    },
    [session?.access_token, onChanged],
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    async function load() {
      if (!supabase) return setState("off");
      const [settings, rows, catalog] = await Promise.all([
        supabase.from("billing_settings").select("sandbox_enabled").maybeSingle(),
        supabase.from("store_products").select("product_id, kind, enabled, catalog_sku"),
        supabase.from("token_package_catalog").select("sku, token_quantity"),
      ]);
      if (!active) return;
      if (settings.error || rows.error || catalog.error) return setState("off"); // Older database: no billing tables.
      const list = settings.data?.sandbox_enabled
        ? availableProducts(rows.data ?? [], catalog.data ?? [])
        : [];
      if (!list.length) return setState("off");
      kinds.current = new Map(list.map((p) => [p.productId, p.kind]));
      try {
        // Loaded only when billing is on, so builds without Google Play services never touch the native module.
        const billing = await import("../lib/playBilling");
        unsubscribe = await billing.connect({
          onPurchased: ({ productId, purchaseToken }) => void verify(productId, purchaseToken),
          onPending: () => {
            setBusy(null);
            setMessage({ kind: "info", text: PENDING_MESSAGE });
          },
          onError: (text) => {
            setBusy(null);
            setMessage({ kind: "error", text });
          },
        });
        const found = await billing.prices({
          tokenPacks: list.filter((p) => p.kind === "token_package").map((p) => p.productId),
          subscriptions: list.filter((p) => p.kind === "subscription").map((p) => p.productId),
        });
        if (!active) return;
        setPrices(Object.fromEntries(found.map((p) => [p.productId, p])));
        setProducts(list.filter((p) => found.some((f) => f.productId === p.productId)));
        setState("ready");
        // Purchases left unconfirmed by an earlier session (crash, no network) are sent again.
        for (const p of await billing.unfinished()) void verify(p.productId, p.purchaseToken);
      } catch {
        if (active) setState("error");
      }
    }
    void load();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [verify]);

  const start = async (p: StoreProduct) => {
    if (!session?.user.id) return;
    setBusy(p.productId);
    setMessage(null);
    try {
      const billing = await import("../lib/playBilling");
      await billing.buy(session.user.id, p.kind, p.productId, prices[p.productId]?.offerToken ?? null);
    } catch (e) {
      setBusy(null);
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not open Google Play." });
    }
  };

  if (state === "loading") return <Body muted>Checking token packs…</Body>;
  if (state === "off") return <Body muted>{BILLING_UNAVAILABLE}</Body>;
  if (state === "error")
    return (
      <Body muted>
        Google Play Billing is not available on this device. Sign in to Google Play and try again.
      </Body>
    );
  return (
    <View style={{ gap: 10 }}>
      {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
      <Body muted>
        Test purchases only during testing. Tokens are app credits with no cash value and cannot be
        transferred or withdrawn.
      </Body>
      {products.map((p) => (
        <View
          key={p.productId}
          style={{
            backgroundColor: c.card,
            borderColor: c.border,
            borderWidth: 1,
            borderRadius: 14,
            padding: 14,
            gap: 8,
          }}
        >
          <Text style={{ color: c.text, fontWeight: "700" }}>
            {p.kind === "subscription" ? "Monthly plan" : `${(p.tokens ?? 0).toLocaleString("en-IN")} tokens`}
          </Text>
          <Text style={{ color: c.muted }}>{prices[p.productId]?.displayPrice ?? ""}</Text>
          <Button
            label={p.kind === "subscription" ? "Subscribe with Google Play" : "Buy with Google Play"}
            busy={busy === p.productId}
            disabled={busy !== null}
            onPress={() => void start(p)}
          />
        </View>
      ))}
    </View>
  );
}
