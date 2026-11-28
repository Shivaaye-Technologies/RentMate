import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SafetyActions } from "../../../src/components/SafetyActions";
import {
  ActionBar,
  ActivePill,
  BackBar,
  Chip,
  ChipRow,
  FactRow,
  Panel,
  PhotoCard,
} from "../../../src/components/kit";
import { react } from "../../../src/lib/feed";
import {
  activityText,
  cachedPerson,
  factsFor,
  lookingForText,
  personFromRow,
  photoList,
  type Person,
} from "../../../src/lib/people";
import { signedPhotoUrl } from "../../../src/lib/photos";
import type { PersonRow } from "../../../src/lib/shared";
import { supabase } from "../../../src/lib/supabase";
import { Body, Button, Notice, usePalette } from "../../../src/ui";
import { loadMyProfile } from "../../../src/lib/me";

/**
 * Someone's profile, photo first: photos alternate with cards for what they're looking for, their facts, hobbies,
 * prompts and favourite neighbourhood. `self=1` previews your own profile as others see it (no actions).
 */
export default function UserProfile() {
  const c = usePalette();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string; self?: string; actions?: string }>();
  const id = String(params.id);
  const self = params.self === "1";
  const showActions = !self && params.actions !== "0";
  const [person, setPerson] = useState<Person | null>(cachedPerson(id));
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [companion, setCompanion] = useState(false);
  const photoHeight = Math.round(Math.min(640, Math.max(360, height * 0.6)));

  const load = useCallback(async () => {
    if (!supabase) return setError("App configuration is missing.");
    setError(null);
    try {
      if (self) {
        const data = await loadMyProfile<PersonRow>(supabase).catch(() => null);
        if (!data) throw new Error("Could not load your profile.");
        setPerson(personFromRow({ ...(data as PersonRow), distance_km: null, online: true } as PersonRow));
      } else if (!cachedPerson(id)) {
        const { data, error: e } = await supabase.rpc("profiles_by_ids", { p_ids: [id] });
        const row = ((data ?? []) as PersonRow[])[0];
        if (e || !row) throw new Error("This profile isn't available.");
        setPerson(personFromRow(row));
      }
      if (!self) {
        const comp = await supabase
          .from("companion_profiles")
          .select("user_id")
          .eq("user_id", id)
          .maybeSingle();
        setCompanion(!!comp.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "This profile isn't available.");
    }
  }, [id, self]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!person) return;
    let active = true;
    void Promise.all(photoList(person).map(async (p) => [p, await signedPhotoUrl(p)] as const)).then(
      (pairs) => {
        if (active) setUrls(Object.fromEntries(pairs.filter(([, u]) => !!u)) as Record<string, string>);
      },
    );
    return () => {
      active = false;
    };
  }, [person]);

  const act = async (kind: "like" | "super" | "pass") => {
    if (!person || busy) return;
    setBusy(true);
    setError(null);
    try {
      await react(person, kind);
      setDone(kind === "pass" ? "Passed." : kind === "super" ? "Special like sent." : "Like sent.");
      setTimeout(() => (router.canGoBack() ? router.back() : router.replace("/(app)/discover")), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That action could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const photos = person ? photoList(person) : [];
  const facts = person ? factsFor(person) : [];
  const d = person?.details;
  const photoCard = (i: number) =>
    photos[i] ? (
      <PhotoCard
        key={photos[i]}
        uri={urls[photos[i]] ?? null}
        height={photoHeight}
        accessibilityLabel={`Photo ${i + 1}`}
      />
    ) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      <View style={{ paddingHorizontal: 16 }}>
        <BackBar title={self ? "Your profile" : person?.displayName} />
      </View>
      {!person && !error ? (
        <ActivityIndicator
          style={{ marginTop: 40 }}
          accessibilityLabel="Loading profile"
          color={c.text}
          size="large"
        />
      ) : null}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: showActions ? 140 : 40,
          gap: 14,
          width: "100%",
          maxWidth: 600,
          alignSelf: "center",
        }}
      >
        {error ? <Notice kind="error">{error}</Notice> : null}
        {done ? <Notice kind="info">{done}</Notice> : null}
        {person && d ? (
          <>
            <PhotoCard
              uri={photos[0] ? (urls[photos[0]] ?? null) : null}
              height={photoHeight}
              initials={person.displayName.slice(0, 1).toUpperCase()}
              accessibilityLabel="Main photo"
            >
              {!self && activityText(person) ? <ActivePill label={activityText(person)!} /> : null}
              <Text style={{ color: "#FFFFFF", fontSize: 36, fontWeight: "700" }}>
                {person.displayName}, {person.age}
                {person.verified ? "  ✓" : ""}
              </Text>
              {d.city ? (
                <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "700" }}>🏠 {d.city}</Text>
              ) : null}
              <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "700" }}>
                🔍 {lookingForText(person)}
              </Text>
            </PhotoCard>

            <Panel style={{ gap: 4 }}>
              <ChipRow>
                <Chip label={lookingForText(person)} light />
              </ChipRow>
              {facts.map((f, i) => (
                <FactRow key={f.glyph + f.text} glyph={f.glyph} text={f.text} last={i === facts.length - 1} />
              ))}
            </Panel>

            {person.bio ? (
              <Panel>
                <Text style={{ color: c.text, fontWeight: "800", fontSize: 17 }}>About</Text>
                <Body>{person.bio}</Body>
              </Panel>
            ) : null}

            {photoCard(1)}

            {person.interests.length ? (
              <Panel>
                <Text style={{ color: c.text, fontWeight: "800", fontSize: 17 }}>Hobbies</Text>
                <ChipRow>
                  {person.interests.map((i) => (
                    <Chip key={i} label={i} light selected={person.sharedInterests.includes(i)} />
                  ))}
                </ChipRow>
              </Panel>
            ) : null}

            {d.prompts.map((p) => (
              <Panel key={p.q}>
                <Text style={{ color: c.muted, fontWeight: "700" }}>“ {p.q}</Text>
                <Text style={{ color: c.text, fontSize: 22, fontWeight: "700" }}>{p.a}</Text>
              </Panel>
            ))}

            {photoCard(2)}

            {d.neighbourhoods.length ? (
              <Panel style={{ alignItems: "center", paddingVertical: 28 }}>
                <Text style={{ fontSize: 56 }}>🏘️</Text>
                <Text style={{ color: c.text, fontWeight: "700" }}>Favourite neighbourhood</Text>
                <Text style={{ color: c.text, fontSize: 30, fontWeight: "600", textAlign: "center" }}>
                  {d.neighbourhoods.join(" · ")}
                </Text>
              </Panel>
            ) : null}

            {d.favourite_places.length ? (
              <Panel>
                <Text style={{ color: c.text, fontWeight: "800", fontSize: 17 }}>Favourite places</Text>
                <ChipRow>
                  {d.favourite_places.map((p) => (
                    <Chip key={p} label={p} light />
                  ))}
                </ChipRow>
              </Panel>
            ) : null}

            {photos.slice(3).map((_, i) => photoCard(i + 3))}

            {companion ? (
              <Panel>
                <Text style={{ color: c.text, fontWeight: "800", fontSize: 17 }}>Book an activity</Text>
                <Body muted>
                  {person.displayName} is an approved companion. Activities happen in public places only, paid
                  in app tokens held until you both confirm. Not a date, and never anything romantic or
                  sexual.
                </Body>
                <Button
                  label="See activities"
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/booking/new/[companion]",
                      params: { companion: person.id },
                    } as never)
                  }
                />
              </Panel>
            ) : null}

            {!self ? (
              <Panel>
                <Text style={{ color: c.text, fontWeight: "800", fontSize: 17 }}>Safety</Text>
                <SafetyActions
                  userId={person.id}
                  onBlocked={() => (router.canGoBack() ? router.back() : router.replace("/(app)/discover"))}
                />
              </Panel>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {showActions && person && !done ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 24 }}>
          <ActionBar
            busy={busy}
            onPass={() => void act("pass")}
            onLike={() => void act("like")}
            onSuperLike={() => void act("super")}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
