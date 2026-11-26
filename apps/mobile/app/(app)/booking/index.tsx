import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { Card } from "../../../src/components/Card";
import {
  bookingErrorMessage,
  formatWhen,
  roleIn,
  STATUS_LABEL,
  type Booking,
} from "../../../src/lib/bookings";
import { supabase } from "../../../src/lib/supabase";
import { Body, Button, Notice, Screen, usePalette } from "../../../src/ui";

export default function MyBookings() {
  const c = usePalette();
  const router = useRouter();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return setError("App configuration is missing.");
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Please sign in again.");
    setMe(auth.user.id);
    // Unanswered requests whose time has passed expire on the server and return their tokens.
    await supabase.rpc("booking_expire_stale");
    const { data, error: e } = await supabase
      .from("bookings")
      .select(
        "id, reference, member_id, companion_id, service_title, starts_at, ends_at, meeting_point, status",
      )
      .order("starts_at", { ascending: false })
      .limit(100);
    if (e) return setError(bookingErrorMessage(e));
    setRows((data ?? []) as Booking[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen>
      {error ? (
        <>
          <Notice kind="error">{error}</Notice>
          <Button label="Try again" onPress={() => void load()} />
        </>
      ) : null}
      {!rows && !error ? <ActivityIndicator accessibilityLabel="Loading bookings" color={c.accent} /> : null}
      {rows && rows.length === 0 ? (
        <>
          <Body muted>You have no bookings yet.</Body>
          <Button label="Find a companion" onPress={() => router.push("/companions")} />
        </>
      ) : null}
      {rows?.map((b) => (
        <Card
          key={b.id}
          label={`Open booking ${b.reference}`}
          onPress={() => router.push({ pathname: "/booking/[id]", params: { id: b.id } })}
        >
          <Text style={{ color: c.text, fontWeight: "700" }}>{b.service_title}</Text>
          <Text style={{ color: c.muted }}>
            {formatWhen(b.starts_at)} ·{" "}
            {me && roleIn(b, me) === "companion" ? "You are the companion" : "You booked"}
          </Text>
          <Text style={{ color: c.accent, fontWeight: "600" }}>{STATUS_LABEL[b.status] ?? b.status}</Text>
        </Card>
      ))}
    </Screen>
  );
}
