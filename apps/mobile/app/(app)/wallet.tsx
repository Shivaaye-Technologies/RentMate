import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { Body, Notice, Screen, Title, usePalette } from "../../src/ui";

type SubscriptionRow = {
  is_subscriber: boolean;
  plan_key: string | null;
  status: string | null;
  current_period_end: string | null;
};

export default function Wallet() {
  const c = usePalette();
  const [balance, setBalance] = useState<number | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) {
        setError("App configuration is missing.");
        setLoading(false);
        return;
      }
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!auth.user) throw new Error("Please sign in again.");

        const [wallet, entitlement] = await Promise.all([
          supabase.from("token_wallets").select("balance").eq("user_id", auth.user.id).maybeSingle(),
          supabase.rpc("my_subscription_entitlement"),
        ]);
        if (wallet.error) throw wallet.error;
        if (entitlement.error) throw entitlement.error;
        if (!active) return;
        setBalance(Number(wallet.data?.balance ?? 0));
        const row = Array.isArray(entitlement.data) ? entitlement.data[0] : null;
        setSubscription((row as SubscriptionRow | null) ?? null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load your wallet.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Screen>
      <Text
        style={{
          color: c.accent,
          fontWeight: "800",
          letterSpacing: 2,
        }}
      >
        RENTMATE TOKENS
      </Text>
      <Title>Wallet</Title>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: 24,
          padding: 22,
          borderWidth: 1,
          borderColor: c.border,
          gap: 8,
        }}
      >
        <Text style={{ color: c.muted }}>Your token balance</Text>
        <Text style={{ color: c.text, fontSize: 34, fontWeight: "800" }}>
          {loading ? "…" : balance === null ? "—" : balance.toLocaleString("en-IN")}
        </Text>
        <Text style={{ color: c.muted }}>
          {loading ? "Loading your wallet…" : "Tokens are internal app credits with no cash value."}
        </Text>
      </View>
      <Title>Subscription</Title>
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: 18,
          padding: 16,
          borderWidth: 1,
          borderColor: c.border,
          gap: 6,
        }}
      >
        <Text style={{ color: c.text, fontWeight: "700" }}>
          {loading
            ? "Checking subscription…"
            : subscription?.is_subscriber
              ? "Monthly subscriber"
              : "Free membership"}
        </Text>
        <Body muted>
          {subscription?.is_subscriber && subscription.current_period_end
            ? `Active until ${new Date(subscription.current_period_end).toLocaleDateString("en-IN")}`
            : "Subscription purchase and activation are not available in this build."}
        </Body>
      </View>
      <Title>Gifts & token packages</Title>
      <Body>
        Token purchases and gift sending are currently disabled. No package can be purchased and no gift
        transaction is simulated.
      </Body>
      <Body muted>
        The maximum planned purchase is 500 tokens per transaction. Purchases, transfers, cash withdrawal and
        redemption remain unavailable until the required approvals and verified billing integration ship.
      </Body>
    </Screen>
  );
}
