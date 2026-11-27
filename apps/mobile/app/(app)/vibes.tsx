import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackBar, TopBar } from "../../src/components/kit";
import { PeopleGrid } from "../../src/components/PeopleGrid";
import { loadFeed } from "../../src/lib/feed";
import { buildVibes, type Vibe, type VibeTone } from "../../src/lib/people";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/session";
import { Body, Button, Notice, usePalette } from "../../src/ui";

const TONES: Record<VibeTone, { bg: string; card: string; title: string }> = {
  sky: { bg: "#4E6274", card: "#B6D6F2", title: "#B6D6F2" },
  lilac: { bg: "#6E5A78", card: "#DDBDE6", title: "#DDBDE6" },
  coral: { bg: "#6F4636", card: "#F4A68C", title: "#F4A68C" },
  periwinkle: { bg: "#525573", card: "#B4B8EE", title: "#B4B8EE" },
  sand: { bg: "#6B6150", card: "#EAD7AE", title: "#EAD7AE" },
  mint: { bg: "#3F5E52", card: "#B7E2C9", title: "#B7E2C9" },
};

/** Vibes: themed groups of people built from real shared interests, your city and distance. */
export default function Vibes() {
  const c = usePalette();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { session } = useSession();
  const [vibes, setVibes] = useState<Vibe[] | null>(null);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Vibe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardWidth = Math.min(width - 48, 480);

  const load = useCallback(async () => {
    setError(null);
    try {
      const me = session?.user?.id;
      const [people, mine] = await Promise.all([
        loadFeed(),
        me && supabase
          ? supabase.from("profiles").select("interests, city").eq("id", me).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const row = (mine as { data: { interests?: string[]; city?: string | null } | null }).data;
      setVibes(buildVibes(people, { interests: row?.interests ?? [], city: row?.city ?? null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Vibes.");
      setVibes((v) => v ?? []);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (vibes === null) void load();
    }, [load, vibes]),
  );

  if (open) {
    const tone = TONES[open.tone];
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
          <BackBar title={open.title} onBack={() => setOpen(null)} />
          <View style={{ backgroundColor: tone.card, borderRadius: 20, padding: 14 }}>
            <Text style={{ color: "#141210", fontWeight: "700" }}>♡ {open.why}</Text>
          </View>
          <PeopleGrid people={open.people} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const current = vibes?.[page];
  const tone = TONES[current?.tone ?? "lilac"];
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: current ? tone.bg : c.bg }}
      edges={["top", "left", "right"]}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: 40, flexGrow: 1 }}>
        <TopBar />
        <Text
          style={{
            color: current ? tone.title : c.text,
            fontSize: 64,
            fontWeight: "900",
            fontStyle: "italic",
            textAlign: "center",
            letterSpacing: -2,
          }}
        >
          Vibes
        </Text>
        {error ? <Notice kind="error">{error}</Notice> : null}
        {vibes === null ? (
          <ActivityIndicator accessibilityLabel="Loading Vibes" color="#FFFFFF" size="large" />
        ) : null}
        {vibes && vibes.length === 0 ? (
          <View style={{ backgroundColor: c.card, borderRadius: 28, padding: 24, gap: 12 }}>
            <Text style={{ color: c.text, fontSize: 22, fontWeight: "800" }}>No Vibes yet</Text>
            <Body muted>Add hobbies and your city to your profile to unlock Vibes built around you.</Body>
            <Button label="Add hobbies" onPress={() => router.push("/(app)/edit-profile" as Href)} />
          </View>
        ) : null}
        {current ? (
          <>
            <View
              style={{
                alignSelf: "center",
                backgroundColor: "rgba(255,255,255,0.18)",
                borderRadius: 18,
                paddingHorizontal: 18,
                paddingVertical: 12,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 16 }}>♡ {current.why}</Text>
            </View>
            <ScrollView
              horizontal
              pagingEnabled
              snapToInterval={cardWidth + 16}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) =>
                setPage(Math.round(e.nativeEvent.contentOffset.x / (cardWidth + 16)))
              }
              contentContainerStyle={{ gap: 16, paddingHorizontal: (width - 32 - cardWidth) / 2 }}
            >
              {vibes!.map((v) => (
                <View
                  key={v.key}
                  style={{
                    width: cardWidth,
                    height: Math.round(cardWidth * 1.2),
                    borderRadius: 44,
                    backgroundColor: TONES[v.tone].card,
                    borderWidth: 3,
                    borderColor: "rgba(255,255,255,0.7)",
                    padding: 28,
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{ fontSize: 72, textAlign: "center", marginTop: 20 }}
                    accessibilityElementsHidden
                  >
                    {v.art}
                  </Text>
                  <View style={{ gap: 14 }}>
                    <Text style={{ color: "#141210", fontSize: 34, fontWeight: "600", letterSpacing: -0.8 }}>
                      {v.title}
                    </Text>
                    <Text style={{ color: "#3A3530" }}>
                      {v.people.length} {v.people.length === 1 ? "person" : "people"}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`See profiles: ${v.title}`}
                      onPress={() => setOpen(v)}
                      style={{
                        alignSelf: "flex-start",
                        backgroundColor: "#141210",
                        borderRadius: 20,
                        paddingHorizontal: 22,
                        paddingVertical: 16,
                      }}
                    >
                      <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 16 }}>See profiles</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 8 }}>
              {vibes!.map((v, i) => (
                <View
                  key={v.key}
                  style={{
                    width: i === page ? 12 : 8,
                    height: i === page ? 12 : 8,
                    borderRadius: 6,
                    backgroundColor: i === page ? "#FFFFFF" : "rgba(255,255,255,0.4)",
                  }}
                />
              ))}
            </View>
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(app)/live" as Href)}
          style={{ alignSelf: "center", padding: 12 }}
        >
          <Text style={{ color: current ? "#FFFFFF" : c.text, fontWeight: "700" }}>Live rooms ›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
