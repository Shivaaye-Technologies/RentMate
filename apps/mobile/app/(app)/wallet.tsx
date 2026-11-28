import { useCallback, useEffect, useState } from "react";
import { View, Text } from "react-native";
import { TokenStore } from "../../src/components/TokenStore";
import { LEDGER_LABEL } from "../../src/lib/bookings";
import { formatIndianNumber } from "../../src/lib/shared";
import { supabase } from "../../src/lib/supabase";
import { Body, Notice, Screen, Title, usePalette } from "../../src/ui";

type SubscriptionRow = {
  is_subscriber: boolean;
  plan_key: string | null;
  status: string | null;
  current_period_end: string | null;
};

type LedgerEntry = {
  id: number;
  delta: number;
  balance_after: number;
  reason: string;
  created_at: string;
};

function formatDelta(value: number) {
  const amount = formatIndianNumber(Math.abs(value));
  return value > 0 ? `+${amount}` : `−${amount}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function Wallet() {
  const c = usePalette();
  const [balance, setBalance] = useState<number | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);

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

        const [wallet, entitlement, ledger] = await Promise.all([
          supabase.from("token_wallets").select("balance").eq("user_id", auth.user.id).maybeSingle(),
          supabase.rpc("my_subscription_entitlement"),
          supabase
            .from("token_ledger")
            .select("id, delta, balance_after, reason, created_at")
            .eq("user_id", auth.user.id)
            .order("id", { ascending: false })
            .limit(20),
        ]);
        if (wallet.error) throw wallet.error;
        if (entitlement.error) throw entitlement.error;
        if (ledger.error) throw ledger.error;
        if (!active) return;
        setBalance(Number(wallet.data?.balance ?? 0));
        setEntries((ledger.data ?? []) as LedgerEntry[]);
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
  }, [refresh]);

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
          {loading ? "…" : balance === null ? "—" : formatIndianNumber(balance)}
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
            : "Subscribe below when the monthly plan is available. Only Google Play can activate it."}
        </Body>
      </View>
      <Title>Recent activity</Title>
      {loading ? (
        <Body muted>Loading your ledger…</Body>
      ) : entries.length ? (
        entries.map((entry) => (
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
                {LEDGER_LABEL[entry.reason] ?? entry.reason.replaceAll("_", " ")}
              </Text>
              <Text style={{ color: entry.delta > 0 ? c.accent : c.text, fontWeight: "800" }}>
                {formatDelta(entry.delta)}
              </Text>
            </View>
            <Text style={{ color: c.muted, fontSize: 12 }}>{formatDate(entry.created_at)}</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>
              Balance after: {formatIndianNumber(entry.balance_after)}
            </Text>
          </View>
        ))
      ) : (
        <Body muted>No wallet activity is available yet.</Body>
      )}
      <Title>Token packs</Title>
      <TokenStore onChanged={reload} />
      <Body muted>
        Up to 500 tokens per pack. Transfers, cash withdrawal and redemption are not available: tokens have no
        cash value.
      </Body>
    </Screen>
  );
}
