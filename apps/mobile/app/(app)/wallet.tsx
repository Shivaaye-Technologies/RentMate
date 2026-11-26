import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { Body, Notice, Screen, Title, usePalette } from "../../src/ui";

type LedgerEntry = {
  id: number;
  delta: number;
  balance_after: number;
  reason: string;
  created_at: string;
};

type SubscriptionRow = {
  is_subscriber: boolean;
  plan_key: string | null;
  status: string | null;
  current_period_end: string | null;
};

type WalletState = {
  balance: number;
  entries: LedgerEntry[];
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function formatDelta(value: number) {
  const amount = Math.abs(value).toLocaleString("en-IN");
  return value > 0 ? `+${amount}` : `−${amount}`;
}

export default function Wallet() {
  const c = usePalette();
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWallet = useCallback(async () => {
    if (!supabase) {
      setError("RentMate is not configured. Please try again after the app configuration is restored.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Please sign in again to view your wallet.");

      const [walletResult, ledgerResult, entitlementResult] = await Promise.all([
        supabase.from("token_wallets").select("balance").eq("user_id", userId).maybeSingle(),
        supabase
          .from("token_ledger")
          .select("id, delta, balance_after, reason, created_at")
          .eq("user_id", userId)
          .order("id", { ascending: false })
          .limit(20),
        supabase.rpc("my_subscription_entitlement"),
      ]);

      if (walletResult.error) throw walletResult.error;
      if (ledgerResult.error) throw ledgerResult.error;
      if (entitlementResult.error) throw entitlementResult.error;

      const entitlementRow = Array.isArray(entitlementResult.data)
        ? entitlementResult.data[0]
        : null;
      setWallet({
        balance: Number(walletResult.data?.balance ?? 0),
        entries: (ledgerResult.data ?? []) as LedgerEntry[],
      });
      setSubscription((entitlementRow as SubscriptionRow | null) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load your wallet right now.");
      setWallet(null);
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  return (
    <Screen>
      <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>RENTMATE TOKENS</Text>
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
        <Text style={{ color: c.muted }}>Available token balance</Text>
        {loading ? (
          <ActivityIndicator accessibilityLabel="Loading wallet balance" color={c.accent} />
        ) : (
          <Text
            accessibilityLabel={`Token balance ${wallet?.balance ?? 0}`}
            style={{ color: c.text, fontSize: 34, fontWeight: "800" }}
          >
            {(wallet?.balance ?? 0).toLocaleString("en-IN")}
          </Text>
        )}
        <Text style={{ color: c.muted }}>
          RentMate tokens are internal app units. They are not cash, cannot be withdrawn or transferred, and have no cash redemption value.
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

      <Title>Recent activity</Title>
      {loading ? (
        <Body muted>Loading your ledger…</Body>
      ) : wallet?.entries.length ? (
        wallet.entries.map((entry) => (
          <View
            key={entry.id}
            style={{
              backgroundColor: c.card,
              borderColor: c.border,
              borderWidth: 1,
              borderRadius: 14,
              padding: 14,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Text style={{ color: c.text, fontWeight: "700", flex: 1 }}>
                {entry.reason.replaceAll("_", " ")}
              </Text>
              <Text style={{ color: entry.delta > 0 ? c.accent : c.text, fontWeight: "800" }}>
                {formatDelta(entry.delta)}
              </Text>
            </View>
            <Text style={{ color: c.muted, fontSize: 12 }}>{formatDate(entry.created_at)}</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>
              Balance after: {entry.balance_after.toLocaleString("en-IN")}
            </Text>
          </View>
        ))
      ) : (
        <Body muted>No wallet activity is available yet.</Body>
      )}

      <Title>Purchases and gifts</Title>
      <Body>
        Token purchases and member-to-member gifts are not enabled in this testing build. Purchases will be
        available only after the approved store billing flow and server verification are complete.
      </Body>
      <Body muted>
        Booking token holds and refunds will appear here only after their separate booking ledger integration
        is implemented and tested.
      </Body>
    </Screen>
  );
}
