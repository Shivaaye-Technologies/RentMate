import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Chip, ChipRow, TopBar } from "../../src/components/kit";
import { PeopleGrid } from "../../src/components/PeopleGrid";
import { loadFeed } from "../../src/lib/feed";
import { distanceText, type Person } from "../../src/lib/people";
import { Body, Notice, Screen, usePalette } from "../../src/ui";

const RINGS = [
  { key: "2", label: "Within 2 km", max: 2 },
  { key: "5", label: "Within 5 km", max: 5 },
  { key: "10", label: "Within 10 km", max: 10 },
  { key: "all", label: "Everyone", max: Infinity },
] as const;

/**
 * Around you: people by approximate distance (the database's coarse buckets) and city. The Android app never asks
 * for your location; distance comes from the approximate location you can share on the web, and nobody's exact
 * position is ever shown.
 */
export default function Nearby() {
  const c = usePalette();
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [ring, setRing] = useState<(typeof RINGS)[number]["key"]>("10");
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (people !== null) return;
      void loadFeed()
        .then(setPeople)
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Could not load people around you.");
          setPeople([]);
        });
    }, [people]),
  );

  const max = RINGS.find((r) => r.key === ring)!.max;
  const shown = useMemo(
    () =>
      (people ?? [])
        .filter((p) => (max === Infinity ? true : p.distanceKm !== null && p.distanceKm <= max))
        .sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999)),
    [people, max],
  );
  const withDistance = (people ?? []).filter((p) => p.distanceKm !== null).length;

  return (
    <Screen>
      <TopBar title="Around you" />
      {people && withDistance === 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(app)/settings" as Href)}
          style={{
            backgroundColor: c.tabBar,
            borderRadius: 24,
            padding: 18,
            flexDirection: "row",
            gap: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 26 }}>🧭</Text>
          <Text style={{ color: "#FFFFFF", flex: 1, fontWeight: "600" }}>
            Distances appear once members share an approximate location. Exact locations are never shown.
          </Text>
        </Pressable>
      ) : null}
      <ChipRow>
        {RINGS.map((r) => (
          <Chip key={r.key} label={r.label} selected={ring === r.key} onPress={() => setRing(r.key)} />
        ))}
      </ChipRow>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {people === null ? (
        <ActivityIndicator accessibilityLabel="Finding people around you" color={c.text} size="large" />
      ) : null}
      {people && !error && shown.length === 0 ? (
        <Body muted>
          {people.length === 0
            ? "Nobody is in your Discover feed right now. Try wider preferences or check back later."
            : "Nobody in this range right now. Try a wider ring."}
        </Body>
      ) : null}
      <PeopleGrid people={shown} caption={(p) => distanceText(p.distanceKm) ?? p.details.city ?? undefined} />
      <View style={{ height: 8 }} />
    </Screen>
  );
}
