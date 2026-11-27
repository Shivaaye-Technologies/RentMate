import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Avatar, BackBar, MenuRow, Panel, Progress } from "../../src/components/kit";
import { formatIndianNumber, profileStrength, type ProfileRow } from "../../src/lib/shared";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/session";
import { Body, Button, Notice, Screen, usePalette } from "../../src/ui";

const level = (pct: number) =>
  pct >= 85
    ? "Complete profile"
    : pct >= 60
      ? "Strong profile"
      : pct >= 35
        ? "Getting there"
        : "Beginner profile";

/** Your space: completion, wallet and bookings, and everything else you manage. */
export default function ProfileHub() {
  const c = usePalette();
  const router = useRouter();
  const { session } = useSession();
  const [row, setRow] = useState<ProfileRow | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [isCompanion, setIsCompanion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const me = session?.user?.id;
        if (!supabase || !me) return setError("Please sign in again.");
        const [p, w, comp] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", me).maybeSingle(),
          supabase.from("token_wallets").select("balance").eq("user_id", me).maybeSingle(),
          supabase.from("companion_profiles").select("user_id").eq("user_id", me).maybeSingle(),
        ]);
        if (!active) return;
        if (p.error) setError("Could not load your profile. Check your connection.");
        setRow((p.data as ProfileRow | null) ?? null);
        setBalance((w.data as { balance?: number } | null)?.balance ?? null);
        setIsCompanion(!!comp.data);
      })();
      return () => {
        active = false;
      };
    }, [session?.user?.id]),
  );

  const strength = row ? profileStrength(row) : null;
  const go = (href: string) => router.push(href as Href);

  return (
    <Screen>
      <BackBar />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text
          style={{ color: c.text, fontSize: 40, fontWeight: "600", letterSpacing: -1, flexShrink: 1 }}
          numberOfLines={1}
        >
          {row?.display_name ?? " "} {row?.verified ? <Text style={{ fontSize: 24 }}>✓</Text> : null}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          onPress={() => go("/(app)/edit-profile")}
          style={{ backgroundColor: c.surface, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 12 }}
        >
          <Text style={{ color: c.text, fontWeight: "800", fontSize: 16 }}>✎ Edit</Text>
        </Pressable>
      </View>

      {strength ? (
        <Panel style={{ borderRadius: 34, padding: 24 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <View style={{ gap: 4, flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 19, fontWeight: "700" }}>
                {level(strength.percent)}
              </Text>
              <Text style={{ color: c.brand, fontSize: 44, fontWeight: "600" }}>{strength.percent} %</Text>
            </View>
            <Avatar path={row?.photo_path ?? null} name={row?.display_name} size={96} radius={26} />
          </View>
          <Progress value={strength.percent} />
          <Body muted>A fuller profile helps the right people find you.</Body>
          <Button label="Improve your profile" onPress={() => go("/(app)/profile-tasks")} />
        </Panel>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Wallet and tokens"
        onPress={() => go("/(app)/wallet")}
        style={{ backgroundColor: c.tabBar, borderRadius: 30, padding: 24, gap: 6 }}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 30, fontWeight: "700" }}>Wallet</Text>
        <Text style={{ color: "#D9D3CC", fontSize: 16 }}>
          {balance === null
            ? "Tokens for activities and extras"
            : `${formatIndianNumber(balance)} tokens`}
        </Text>
        <View
          style={{
            alignSelf: "flex-start",
            backgroundColor: c.chipActive,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 7,
            marginTop: 8,
          }}
        >
          <Text style={{ color: c.onChipActive, fontWeight: "700" }}>Open wallet</Text>
        </View>
      </Pressable>

      <Panel>
        <Text style={{ color: c.text, fontSize: 26, fontWeight: "700" }}>My bookings</Text>
        <Body muted>Activities with approved companions, always in public places.</Body>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Bookings" onPress={() => go("/(app)/booking")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Find activities" kind="plain" onPress={() => go("/(app)/companions")} />
          </View>
        </View>
      </Panel>

      <View style={{ gap: 14 }}>
        <MenuRow glyph="☰" label="Dating preferences" onPress={() => go("/(app)/preferences")} />
        <MenuRow glyph="🔔" label="Notifications" onPress={() => go("/(app)/notifications")} />
        {isCompanion ? (
          <MenuRow glyph="🗓️" label="My availability" onPress={() => go("/(app)/availability")} />
        ) : null}
        <MenuRow glyph="🎙️" label="Live rooms" onPress={() => go("/(app)/live")} />
        <MenuRow glyph="⚙️" label="Settings, privacy & safety" onPress={() => go("/(app)/settings")} />
      </View>
      <Body muted>18+ only. Report or block anyone, any time, free.</Body>
    </Screen>
  );
}
