import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Text } from "react-native";
import { Card } from "../../../src/components/Card";
import {
  allowedActions,
  bookingErrorMessage,
  formatWhen,
  HOLD_LABEL,
  roleIn,
  STATUS_LABEL,
  type Booking,
  type BookingAction,
} from "../../../src/lib/bookings";
import { supabase } from "../../../src/lib/supabase";
import { Body, Button, Field, Notice, Screen, Title, usePalette } from "../../../src/ui";

type Tokens = {
  gross_tokens: number;
  hold_status: string;
  confirmed_by_me: boolean;
  confirmations: number;
};

const ACTION_LABEL: Record<BookingAction, string> = {
  accept: "Accept",
  reject: "Decline",
  cancel: "Cancel booking",
  complete: "Confirm the meeting happened",
  dispute: "Report a problem with this booking",
};

export default function BookingDetail() {
  const c = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<Booking | null>(null);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!supabase || !id) return;
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Please sign in again.");
    setMe(auth.user.id);
    const [row, tk] = await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id, reference, member_id, companion_id, service_title, starts_at, ends_at, meeting_point, status",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.rpc("my_booking_tokens", { p_booking: id }).maybeSingle(),
    ]);
    if (row.error) return setError(bookingErrorMessage(row.error));
    if (!row.data) return setError("Booking not found.");
    setB(row.data as Booking);
    setTokens(tk.error ? null : ((tk.data as Tokens | null) ?? null));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function act(a: BookingAction) {
    if (!supabase || !b || busy) return;
    if (a === "dispute" && reason.trim().length < 10) {
      return setError("Describe what happened (at least 10 characters) in the box below first.");
    }
    setBusy(a);
    setError(null);
    setInfo(null);
    const call =
      a === "accept" || a === "reject"
        ? supabase.rpc("booking_respond", { p_booking: b.id, p_action: a, p_note: null })
        : a === "cancel"
          ? supabase.rpc("booking_cancel", { p_booking: b.id, p_reason: reason.trim() || null })
          : a === "complete"
            ? supabase.rpc("booking_complete", { p_booking: b.id })
            : supabase.rpc("booking_dispute", { p_booking: b.id, p_reason: reason.trim() });
    const { error: e } = await call;
    setBusy(null);
    if (e) return setError(bookingErrorMessage(e));
    setInfo(a === "complete" ? "Thanks. If you both confirmed, the booking is complete." : "Done.");
    await load();
  }

  async function report() {
    if (!supabase || !b || !me || busy) return;
    const other = roleIn(b, me) === "member" ? b.companion_id : b.member_id;
    if (!other) return;
    setBusy("report");
    const { error: e } = await supabase.from("reports").insert({
      reporter_id: me,
      reported_id: other,
      booking_id: b.id,
      reason: "unsafe_behaviour",
      details: reason.trim().slice(0, 1000),
    });
    setBusy(null);
    if (e) return setError(bookingErrorMessage(e));
    setInfo("Report sent. RentMate's safety team will review it; any reserved tokens are frozen meanwhile.");
    await load();
  }

  async function block() {
    if (!supabase || !b || !me || busy) return;
    const other = roleIn(b, me) === "member" ? b.companion_id : b.member_id;
    if (!other) return;
    setBusy("block");
    const { error: e } = await supabase.from("blocks").insert({ blocker_id: me, blocked_id: other });
    setBusy(null);
    if (e) return setError(bookingErrorMessage(e));
    setInfo("Blocked. Open bookings with this person were cancelled and any reserved tokens returned.");
    await load();
  }

  if (!b) {
    return (
      <Screen>
        {error ? <Notice kind="error">{error}</Notice> : <ActivityIndicator color={c.accent} />}
        {error ? <Button label="Try again" onPress={() => void load()} /> : null}
      </Screen>
    );
  }
  const actions = me ? allowedActions(b, me) : [];
  return (
    <Screen>
      <Title>{b.service_title}</Title>
      <Text style={{ color: c.accent, fontWeight: "700" }}>{STATUS_LABEL[b.status] ?? b.status}</Text>
      <Body>
        {formatWhen(b.starts_at)} – {formatWhen(b.ends_at)}
      </Body>
      <Body>Meeting place: {b.meeting_point}</Body>
      <Body muted>Reference {b.reference}</Body>
      {tokens ? (
        <Card>
          <Text style={{ color: c.text, fontWeight: "700" }}>
            {tokens.gross_tokens.toLocaleString("en-IN")} tokens
          </Text>
          <Text style={{ color: c.muted }}>{HOLD_LABEL[tokens.hold_status] ?? tokens.hold_status}</Text>
          {b.status === "accepted" && tokens.confirmations > 0 ? (
            <Text style={{ color: c.muted }}>
              {tokens.confirmed_by_me
                ? "You confirmed. Waiting for the other person."
                : "The other person confirmed."}
            </Text>
          ) : null}
        </Card>
      ) : null}
      {info ? <Notice kind="info">{info}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button
        label="Open booking chat"
        kind="plain"
        onPress={() => router.push({ pathname: "/booking/chat/[id]", params: { id: b.id } })}
      />
      {actions
        .filter((a) => a !== "dispute")
        .map((a) => (
          <Button
            key={a}
            label={ACTION_LABEL[a]}
            kind={a === "cancel" || a === "reject" ? "plain" : "primary"}
            busy={busy === a}
            onPress={() => void act(a)}
          />
        ))}
      <Title>Safety</Title>
      <Body muted>
        Meet only at the public place above. Both of you confirm the meeting happened before it completes.
        Reporting freezes any reserved tokens until RentMate reviews.
      </Body>
      <Field
        label="What happened (for a report or dispute)"
        value={reason}
        onChangeText={setReason}
        multiline
      />
      {actions.includes("dispute") ? (
        <Button
          label={ACTION_LABEL.dispute}
          kind="danger"
          busy={busy === "dispute"}
          onPress={() => void act("dispute")}
        />
      ) : null}
      <Button
        label="Report this person"
        kind="danger"
        busy={busy === "report"}
        onPress={() => void report()}
      />
      <Button label="Block this person" kind="plain" busy={busy === "block"} onPress={() => void block()} />
      <Button label="Emergency: call 112" kind="danger" onPress={() => void Linking.openURL("tel:112")} />
    </Screen>
  );
}
