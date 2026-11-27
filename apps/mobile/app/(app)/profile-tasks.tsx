import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { BackBar, Chip, ChipRow } from "../../src/components/kit";
import { profileStrength, type ProfileRow, type StrengthItem } from "../../src/lib/shared";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/session";
import { Notice, Screen, usePalette } from "../../src/ui";

const GLYPH: Record<StrengthItem["key"], string> = {
  photo: "🖼️",
  photos3: "🖼️",
  bio: "✍️",
  interests: "✨",
  prompts: "❝",
  facts: "👤",
  job: "💼",
  education: "🎓",
  city: "📍",
  neighbourhoods: "🏘️",
  places: "🚩",
  location: "🧭",
};

const TASK_TEXT: Partial<Record<StrengthItem["key"], string>> = {
  photos3: "3 photos is a must!",
  facts: "No more mystery: add 5 facts about yourself",
  prompts: "Share your fun facts, your tips and more…",
  neighbourhoods: "Pick your favourite neighbourhood (best place to hang out)",
  places: "Share your places (great icebreaker)",
  job: "What do you do for a living?",
  education: "Your studies?",
  interests: "Share hobbies to find common interests",
  city: "Enter your city (the basics)",
  bio: "Write a short bio",
  location: "Show your approximate distance",
};

/** "Your profile is X% complete": open and done tasks, each leading to the right editor. */
export default function ProfileTasks() {
  const c = usePalette();
  const router = useRouter();
  const { session } = useSession();
  const [row, setRow] = useState<ProfileRow | null>(null);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!supabase || !session?.user?.id) return;
        const { data, error: e } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle();
        if (e) setError("Could not load your profile.");
        setRow((data as ProfileRow | null) ?? null);
      })();
    }, [session?.user?.id]),
  );

  const s = row ? profileStrength(row) : null;
  const items = s ? s.items.filter((i) => (tab === "open" ? !i.done : i.done)) : [];

  return (
    <Screen>
      <BackBar
        right={
          row ? (
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                router.push({ pathname: "/(app)/user/[id]", params: { id: row.id, self: "1" } } as never)
              }
            >
              <Text style={{ color: c.text, fontWeight: "800", fontSize: 16 }}>View my profile</Text>
            </Pressable>
          ) : null
        }
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Text style={{ color: c.text, fontSize: 36, fontWeight: "600", letterSpacing: -0.8 }}>
        Your profile is {s?.percent ?? 0}% complete
      </Text>
      <ChipRow>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "open" }}
          onPress={() => setTab("open")}
          style={{
            backgroundColor: tab === "open" ? c.accent : c.chip,
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: tab === "open" ? c.onAccent : c.text, fontWeight: "700" }}>To do</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "done" }}
          onPress={() => setTab("done")}
          style={{
            backgroundColor: tab === "done" ? c.accent : c.chip,
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: tab === "done" ? c.onAccent : c.text, fontWeight: "700" }}>Done</Text>
        </Pressable>
      </ChipRow>
      {tab === "open" && items.length ? (
        <View style={{ backgroundColor: c.surface, borderRadius: 20, padding: 16 }}>
          <Text style={{ color: c.muted }}>🔦 The first tasks help you get noticed quickly.</Text>
        </View>
      ) : null}
      {items.length === 0 ? (
        <Chip label={tab === "open" ? "Nothing left. Nice work!" : "Nothing done yet"} />
      ) : null}
      {items.map((i) => (
        <Pressable
          key={i.key}
          accessibilityRole="button"
          accessibilityLabel={TASK_TEXT[i.key] ?? i.label}
          disabled={i.done}
          onPress={() =>
            router.push((i.key === "location" ? "/(app)/settings" : "/(app)/edit-profile") as Href)
          }
          style={{
            backgroundColor: c.card,
            borderRadius: 28,
            padding: 18,
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
          }}
        >
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              backgroundColor: i.done ? c.chipActive : c.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 26, color: c.onAccent }}>{GLYPH[i.key]}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.text, fontSize: 17, fontWeight: "700" }}>
              {TASK_TEXT[i.key] ?? i.label}
            </Text>
            {i.hint && !i.done ? <Text style={{ color: c.muted }}>{i.hint}</Text> : null}
          </View>
          {!i.done ? <Text style={{ color: c.text, fontSize: 26 }}>›</Text> : null}
        </Pressable>
      ))}
    </Screen>
  );
}
