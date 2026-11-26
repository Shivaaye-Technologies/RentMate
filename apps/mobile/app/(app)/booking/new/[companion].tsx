import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { Card, Chips } from "../../../../src/components/Card";
import {
  bookingErrorMessage,
  durationOptions,
  newRequestKey,
  startOptions,
} from "../../../../src/lib/bookings";
import { supabase } from "../../../../src/lib/supabase";
import { Body, Button, Field, Notice, Screen, Title, usePalette } from "../../../../src/ui";

type Service = {
  id: string;
  title: string;
  description: string;
  pricing: "hourly" | "session";
  price_tokens: number | null;
  min_minutes: number;
  max_minutes: number;
};
type Quote = {
  gross_tokens: number;
  available_balance: number;
  enough_tokens: boolean;
  token_booking_available: boolean;
};

export default function NewBooking() {
  const c = usePalette();
  const router = useRouter();
  const { companion } = useLocalSearchParams<{ companion: string }>();
  const [headline, setHeadline] = useState<string | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt: kept across retries of the same choices, replaced when the choices change.
  const key = useRef<string>(newRequestKey());
  const service = services?.find((s) => s.id === serviceId) ?? null;
  const starts = useMemo(() => startOptions(new Date()), []);

  useEffect(() => {
    if (!supabase || !companion) return;
    void (async () => {
      const [p, s] = await Promise.all([
        supabase!.from("companion_profiles").select("headline").eq("user_id", companion).maybeSingle(),
        supabase!
          .from("companion_services")
          .select("id, title, description, pricing, price_tokens, min_minutes, max_minutes")
          .eq("companion_id", companion)
          .eq("active", true),
      ]);
      if (p.error || s.error) return setError(bookingErrorMessage(p.error ?? s.error));
      if (!p.data) return setError("This companion is not available.");
      setHeadline(p.data.headline as string);
      setServices((s.data ?? []) as Service[]);
    })();
  }, [companion]);

  useEffect(() => {
    key.current = newRequestKey();
    setQuote(null);
    if (!supabase || !service || !minutes || service.price_tokens == null) return;
    let live = true;
    void supabase
      .rpc("booking_token_quote", { p_service: service.id, p_minutes: minutes })
      .single()
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) setError(bookingErrorMessage(e));
        else setQuote(data as Quote);
      });
    return () => {
      live = false;
    };
  }, [service, minutes, start]);

  async function request() {
    if (!supabase || !service || !minutes || !start || busy) return;
    if (place.trim().length < 3) return setError("Name the public place where you will meet.");
    setBusy(true);
    setError(null);
    const tokens = quote?.token_booking_available === true;
    const { data, error: e } = tokens
      ? await supabase.rpc("booking_request_with_tokens", {
          p_service: service.id,
          p_starts_at: start,
          p_minutes: minutes,
          p_meeting_point: place.trim(),
          p_note: note.trim(),
          p_idempotency_key: key.current,
        })
      : await supabase.rpc("booking_request", {
          p_service: service.id,
          p_starts_at: start,
          p_minutes: minutes,
          p_meeting_point: place.trim(),
          p_note: note.trim(),
          p_idempotency_key: key.current,
        });
    setBusy(false);
    if (e) return setError(bookingErrorMessage(e));
    router.replace({ pathname: "/booking/[id]", params: { id: String(data) } });
  }

  if (error && !services) {
    return (
      <Screen>
        <Notice kind="error">{error}</Notice>
        <Button label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (!services) {
    return (
      <Screen>
        <ActivityIndicator accessibilityLabel="Loading services" color={c.accent} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{headline}</Title>
      <Body muted>Choose an activity. Prices are set by RentMate's server from the companion's listing.</Body>
      {services.length === 0 ? <Body muted>This companion has no active services.</Body> : null}
      {services.map((s) => (
        <Card
          key={s.id}
          label={`Choose ${s.title}`}
          onPress={() => (setServiceId(s.id), setMinutes(s.min_minutes))}
        >
          <Text style={{ color: s.id === serviceId ? c.accent : c.text, fontWeight: "700" }}>
            {s.id === serviceId ? "● " : ""}
            {s.title}
          </Text>
          {s.description ? <Text style={{ color: c.muted }}>{s.description}</Text> : null}
          <Text style={{ color: c.text }}>
            {s.price_tokens == null
              ? "Request only (no token price)"
              : `${s.price_tokens.toLocaleString("en-IN")} tokens ${s.pricing === "hourly" ? "per hour" : "per session"}`}
          </Text>
        </Card>
      ))}
      {service ? (
        <>
          <Text style={{ color: c.text, fontWeight: "700" }}>How long</Text>
          <Chips
            options={durationOptions(service.min_minutes, service.max_minutes).map((m) => ({
              value: m,
              label: `${m} min`,
            }))}
            value={minutes}
            onChange={setMinutes}
          />
          <Text style={{ color: c.text, fontWeight: "700" }}>When</Text>
          <Chips
            options={starts.map((d) => ({
              value: d.toISOString(),
              label: d.toLocaleString("en-IN", { weekday: "short", day: "numeric", hour: "numeric" }),
            }))}
            value={start}
            onChange={setStart}
          />
          <Field
            label="Public meeting place (café, museum, park entrance…)"
            value={place}
            onChangeText={setPlace}
            maxLength={120}
          />
          <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} multiline />
          {quote ? (
            <Card>
              <Text style={{ color: c.text, fontWeight: "700" }}>
                {quote.gross_tokens.toLocaleString("en-IN")} tokens will be reserved
              </Text>
              <Text style={{ color: c.muted }}>
                Your balance: {quote.available_balance.toLocaleString("en-IN")} tokens. Reserved tokens return
                to your wallet if the companion declines, the request expires or the booking is cancelled
                under the policy.
              </Text>
              {!quote.token_booking_available ? (
                <Notice kind="info">
                  Booking with tokens is not open yet (test accounts only). You can still send a request; no
                  tokens or money are taken.
                </Notice>
              ) : !quote.enough_tokens ? (
                <Notice kind="error">You do not have enough tokens for this booking.</Notice>
              ) : null}
            </Card>
          ) : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          <Button
            label={quote?.token_booking_available ? "Reserve tokens and send request" : "Send request"}
            onPress={() => void request()}
            busy={busy}
            disabled={!minutes || !start || (quote?.token_booking_available === true && !quote.enough_tokens)}
          />
          <Body muted>
            Meet only in public places. Never share your home address. Report or block at any time.
          </Body>
        </>
      ) : null}
    </Screen>
  );
}
