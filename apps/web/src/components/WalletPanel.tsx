import { useEffect, useState } from "react";
import { formatIndianNumber } from "../market/marketText";
import { supabase } from "../supabase";

type Entry = { id: number; delta: number; balance_after: number; reason: string; created_at: string };
type Rates = {
  voice_tokens_per_minute: number;
  video_tokens_per_second: number;
  free_likes_per_24h: number;
  free_messages_per_24h: number;
  allowances_enforced: boolean;
  call_metering_enabled: boolean;
};

const REASON: Record<string, string> = {
  registration_bonus: "Welcome bonus",
  like: "Like",
  message: "Message",
  voice_call: "Voice call",
  video_call: "Video call",
  admin_adjustment: "Adjustment by RentMate",
  refund: "Refund",
};

/**
 * Read-only token wallet. Balances and entries come from the server (RLS: own rows only); nothing here can change
 * them. There is deliberately no buy, send or withdraw control: those do not exist (locked in the database).
 */
export function WalletPanel({ me }: { me: string }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [w, l, r] = await Promise.all([
        supabase.from("token_wallets").select("balance").eq("user_id", me).maybeSingle(),
        supabase
          .from("token_ledger")
          .select("id, delta, balance_after, reason, created_at")
          .order("id", { ascending: false })
          .limit(10),
        supabase.from("metering_rates").select("*").maybeSingle(),
      ]);
      if (!live) return;
      if (w.error || l.error) {
        setError("Your token balance isn't available right now.");
        return;
      }
      setBalance(Number((w.data as { balance?: number } | null)?.balance ?? 0));
      setEntries((l.data as Entry[] | null) ?? []);
      setRates((r.data as Rates | null) ?? null);
    })();
    return () => {
      live = false;
    };
  }, [me]);

  return (
    <div className="panel wallet-panel">
      <h2 className="display-sm">Tokens</h2>
      {error ? (
        <p className="muted">{error}</p>
      ) : balance === null ? (
        <div className="spinner" aria-hidden="true" />
      ) : (
        <>
          <p className="wallet-balance">
            <strong>{formatIndianNumber(balance)}</strong> tokens
          </p>
          <p className="muted small">
            Tokens are an in-app allowance with no cash value. They can&apos;t be bought, sent to other
            members, withdrawn or exchanged for money.
            {rates && !rates.call_metering_enabled && !rates.allowances_enforced
              ? " Nothing is charged yet."
              : ""}
          </p>
          {rates && (
            <p className="muted small">
              Planned rates: voice calls {rates.voice_tokens_per_minute} per minute, video calls{" "}
              {rates.video_tokens_per_second} per second; {rates.free_likes_per_24h} likes and{" "}
              {rates.free_messages_per_24h} messages free every 24 hours.
            </p>
          )}
          {entries.length > 0 && (
            <ul className="plain-list wallet-ledger" aria-label="Recent token activity">
              {entries.map((e) => (
                <li key={e.id}>
                  <span>{REASON[e.reason] ?? e.reason}</span>
                  <span className="muted small">{new Date(e.created_at).toLocaleDateString()}</span>
                  <strong>{e.delta > 0 ? `+${e.delta}` : e.delta}</strong>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
