import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Text } from "react-native";
import { Card } from "../../../src/components/Card";
import {
  allowedActions,
  bookingErrorMessage,
  checkInStep,
  formatWhen,
  HOLD_LABEL,
  normaliseCheckInCode,
  roleIn,
  STATUS_LABEL,
  type Booking,
  type BookingAction,
} from "../../../src/lib/bookings";
import { formatIndianNumber } from "../../../src/lib/shared";
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
  const [code, setCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");

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
          "id, reference, member_id, companion_id, service_title, starts_at, ends_at, meeting_point, status, checked_in_at",
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
    setInfo(a === "complete" ? "Thanks, your confirmation is recorded." : "Done.");
    await load();
  }

  async function showCode() {
    if (!supabase || !b || busy) return;
    setBusy("code");
    setError(null);
    setInfo(null);
    const { data, error: e } = await supabase.rpc("booking_checkin_code", { p_booking: b.id });
    setBusy(null);
    if (e) return setError(bookingErrorMessage(e));
    setCode(typeof data === "string" ? data : null);
  }

  async function checkIn() {
    if (!supabase || !b || busy) return;
    const digits = normaliseCheckInCode(codeInput);
    if (!digits) return setError("Enter the 6-digit code shown in the member's app.");
    setBusy("checkin");
    setError(null);
    setInfo(null);
    const { data, error: e } = await supabase.rpc("booking_check_in", { p_booking: b.id, p_code: digits });
    setBusy(null);
    if (e) return setError(bookingErrorMessage(e));
    if (data !== true) return setError("That code is not right. Check it with the member and try again.");
    setCodeInput("");
    setInfo("Checked in. Enjoy the meetup.");
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
  const step = me ? checkInStep(b, me) : null;
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
            {formatIndianNumber(tokens.gross_tokens)} tokens
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
      {step ? (
        <Card>
          <Text style={{ color: c.text, fontWeight: "700" }}>Meetup check-in</Text>
          {step === "not_yet" ? (
            <Text style={{ color: c.muted }}>
              Check-in opens 30 minutes before the start, at the meeting place.
            </Text>
          ) : null}
          {step === "checked_in" ? <Text style={{ color: c.muted }}>Checked in at the meetup.</Text> : null}
          {step === "show_code" ? (
            <>
              <Text style={{ color: c.muted }}>
                When you meet, show this code to your companion. Never share it before you are together.
              </Text>
              {code ? (
                <Text
                  accessibilityLabel={`Check-in code ${code.split("").join(" ")}`}
                  style={{
                    color: c.text,
                    fontSize: 32,
                    fontWeight: "700",
                    letterSpacing: 6,
                    textAlign: "center",
                  }}
                >
                  {code.slice(0, 3)} {code.slice(3)}
                </Text>
              ) : null}
              <Button
                label={code ? "Get a new code" : "Show my check-in code"}
                kind={code ? "plain" : "primary"}
                busy={busy === "code"}
                onPress={() => void showCode()}
              />
            </>
          ) : null}
          {step === "enter_code" ? (
            <>
              <Text style={{ color: c.muted }}>Ask the member for the code in their app when you meet.</Text>
              <Field
                label="Check-in code"
                value={codeInput}
                onChangeText={setCodeInput}
                keyboardType="number-pad"
                maxLength={7}
              />
              <Button label="Check in" busy={busy === "checkin"} onPress={() => void checkIn()} />
            </>
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
        Meet only at the public place above. Check in with the code when you meet. A day after the booking
        ends, it completes automatically if you checked in or the member confirmed; otherwise RentMate reviews
        it before any tokens move. Reporting freezes any reserved tokens until RentMate reviews.
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
