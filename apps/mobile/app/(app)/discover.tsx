import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View, useWindowDimensions } from "react-native";
import { ActionBar, ActivePill, FactRow, Panel, PhotoCard, TopBar } from "../../src/components/kit";
import { loadFeed, react, takeFeedStale } from "../../src/lib/feed";
import { activityText, distanceText, type Person } from "../../src/lib/people";
import { signedPhotoUrl } from "../../src/lib/photos";
import { Body, Button, Notice, Screen, usePalette } from "../../src/ui";

/** Home: one person at a time, photo first, with pass / like / special like. */
export default function Discover() {
  const c = usePalette();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const photoHeight = Math.round(Math.min(620, Math.max(360, height * 0.62)));
  const [people, setPeople] = useState<Person[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPeople(await loadFeed());
      setIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load profiles.");
      setPeople((p) => p ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (people === null || takeFeedStale()) void load();
    }, [load, people]),
  );

  const person = people?.[index] ?? null;

  useEffect(() => {
    let active = true;
    setPhoto(null);
    if (person?.photoPath) void signedPhotoUrl(person.photoPath).then((u) => active && setPhoto(u));
    return () => {
      active = false;
    };
  }, [person?.photoPath]);

  const act = async (kind: "like" | "super" | "pass") => {
    if (!person || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await react(person, kind);
      setNote(
        kind === "pass"
          ? null
          : kind === "super"
            ? `${person.displayName} will see your special like first.`
            : null,
      );
      setIndex((i) => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That action could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar filters />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {note ? <Notice kind="info">{note}</Notice> : null}
      {people === null ? (
        <View style={{ height: photoHeight, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator accessibilityLabel="Finding people" color={c.text} size="large" />
        </View>
      ) : null}
      {people !== null && !person ? (
        <Panel style={{ alignItems: "center", paddingVertical: 36 }}>
          <Text style={{ fontSize: 44 }}>🌙</Text>
          <Text style={{ color: c.text, fontSize: 22, fontWeight: "800", textAlign: "center" }}>
            You've seen everyone for now
          </Text>
          <Body muted>New people join every day. Widen your preferences or check back later.</Body>
          <Button label="Refresh" onPress={() => void load()} />
          <Button
            label="Preferences"
            kind="plain"
            onPress={() => router.push("/(app)/preferences" as Href)}
          />
        </Panel>
      ) : null}
      {person ? (
        <>
          <PhotoCard
            uri={photo}
            height={photoHeight}
            initials={person.displayName.slice(0, 1).toUpperCase()}
            accessibilityLabel={`Open ${person.displayName}'s profile`}
            onPress={() => router.push({ pathname: "/(app)/user/[id]", params: { id: person.id } } as never)}
          >
            {activityText(person) ? <ActivePill label={activityText(person)!} /> : null}
            <Text style={{ color: "#FFFFFF", fontSize: 38, fontWeight: "700", letterSpacing: -0.8 }}>
              {person.displayName}, {person.age}
              {person.verified ? "  ✓" : ""}
            </Text>
            {person.details.city ? (
              <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "700" }}>
                🏠 {person.details.city}
              </Text>
            ) : null}
          </PhotoCard>
          <ActionBar
            busy={busy}
            onPass={() => void act("pass")}
            onLike={() => void act("like")}
            onSuperLike={() => void act("super")}
          />
          {person.details.job || distanceText(person.distanceKm) ? (
            <Panel style={{ paddingVertical: 8 }}>
              {person.details.job ? (
                <FactRow glyph="💼" text={person.details.job} last={!distanceText(person.distanceKm)} />
              ) : null}
              {distanceText(person.distanceKm) ? (
                <FactRow glyph="📍" text={distanceText(person.distanceKm)!} last />
              ) : null}
            </Panel>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
