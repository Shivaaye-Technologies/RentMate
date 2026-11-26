import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { Card } from "../../src/components/Card";
import { bookingErrorMessage } from "../../src/lib/bookings";
import { supabase } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

type Companion = {
  user_id: string;
  display_name: string;
  headline: string;
  city: string;
  area: string;
  verified: boolean;
  categories: string[] | null;
  rating: number | null;
  review_count: number;
};

export default function Companions() {
  const c = usePalette();
  const router = useRouter();
  const [rows, setRows] = useState<Companion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return setError("App configuration is missing.");
    setError(null);
    setRows(null);
    const { data, error: e } = await supabase.rpc("companions_search", { p_limit: 50 });
    if (e) return setError(bookingErrorMessage(e));
    setRows((data ?? []) as Companion[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>MEET WITH PURPOSE</Text>
      <Title>Companionship</Title>
      <Body>
        Book an approved companion for a friendly, non-sexual activity in a public place: coffee, a walk, an
        event.
      </Body>
      <Button label="My bookings" kind="plain" onPress={() => router.push("/booking")} />
      {error ? (
        <>
          <Notice kind="error">{error}</Notice>
          <Button label="Try again" onPress={() => void load()} />
        </>
      ) : null}
      {!rows && !error ? (
        <ActivityIndicator accessibilityLabel="Loading companions" color={c.accent} />
      ) : null}
      {rows && rows.length === 0 ? (
        <Body muted>No approved companions are listed yet. Please check back later.</Body>
      ) : null}
      {rows?.map((p) => (
        <Card
          key={p.user_id}
          label={`Book ${p.display_name}`}
          onPress={() =>
            router.push({ pathname: "/booking/new/[companion]", params: { companion: p.user_id } })
          }
        >
          <Text style={{ color: c.text, fontSize: 17, fontWeight: "700" }}>
            {p.display_name}
            {p.verified ? "  ✓ verified" : ""}
          </Text>
          <Text style={{ color: c.text }}>{p.headline}</Text>
          <Text style={{ color: c.muted }}>
            {p.area ? `${p.area}, ` : ""}
            {p.city}
            {p.rating ? ` · ${p.rating}★ (${p.review_count})` : ""}
          </Text>
        </Card>
      ))}
      <Body muted>
        Strictly non-sexual companionship in public places. No escorting, sexual services, hotels or private
        addresses. Report, block and SOS are always free.
      </Body>
    </Screen>
  );
}
