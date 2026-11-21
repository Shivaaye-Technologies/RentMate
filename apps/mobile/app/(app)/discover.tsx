import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { apiBaseUrl, supabase } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

type Candidate = {
  id: string;
  displayName?: string;
  age: number;
  bio?: string;
  interests?: string[];
  online?: boolean;
  distanceKm?: number | null;
  verified?: boolean;
  photoPath?: string | null;
  photos?: string[];
};
export default function Discover() {
  const c = usePalette();
  const [items, setItems] = useState<Candidate[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return setError("App configuration is missing.");
    setBusy(true); setError(null); setFeedback(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`${apiBaseUrl}/api/v1/matches`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load profiles.");
      setItems(Array.isArray(body.matches) ? body.matches : []);
      setIndex(0);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load profiles."); }
    finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const person = items[index];
  const advance = (label: string) => {
    setFeedback(`${label} preview selected. This action is not yet saved to your account.`);
    if (items.length > 1) setIndex((v) => (v + 1) % items.length);
  };
  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View><Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>RENTMATE</Text><Title>Discover</Title></View>
        <View style={{ backgroundColor: c.card, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 8 }}><Text style={{ color: c.text, fontWeight: "700" }}>18+ · Safe space</Text></View>
      </View>
      <Body muted>People, stories and shared interests. Take your time finding your kind of connection.</Body>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {feedback ? <Notice kind="info">{feedback}</Notice> : null}
      {busy ? <Body muted>Finding people…</Body> : null}
      {!busy && !error && !person ? <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 24, gap: 12 }}><Title>It's quiet here</Title><Body>No profiles are available right now. Check back soon or update your preferences.</Body><Button label="Refresh discovery" onPress={() => void load()} /></View> : null}
      {person ? (
        <View style={{ backgroundColor: c.card, borderRadius: 26, overflow: "hidden", borderWidth: 1, borderColor: c.border }}>
          <View style={{ height: 340, backgroundColor: "#F4C9DA", alignItems: "center", justifyContent: "center" }}>
            {person.photoPath || person.photos?.[0] ? <View style={{ alignItems: "center", gap: 8 }}><Text style={{ fontSize: 64 }}>♡</Text><Text style={{ color: "#6D294B", fontWeight: "700" }}>Profile photo</Text><Text style={{ color: "#6D294B", fontSize: 12 }}>Private photo access will be connected here</Text></View> : <Text style={{ fontSize: 84, color: "#9D426D" }}>{(person.displayName ?? "R").slice(0,1).toUpperCase()}</Text>}
            <View style={{ position: "absolute", top: 16, left: 16, backgroundColor: "white", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: "#7B2450", fontWeight: "700" }}>{person.online ? "● Active" : "Member"}</Text></View>
          </View>
          <View style={{ padding: 20, gap: 10 }}>
            <Text style={{ color: c.text, fontSize: 27, fontWeight: "800" }}>{person.displayName || "RentMate member"}, {person.age} {person.verified ? "✓" : ""}</Text>
            <Text style={{ color: c.muted }}>{typeof person.distanceKm === "number" ? `About ${Math.max(1, Math.round(person.distanceKm))} km away` : "Discover someone new"} · {person.verified ? "Verified profile" : "Community member"}</Text>
            <Text style={{ color: c.text, fontSize: 16, lineHeight: 23 }}>{person.bio || "A new connection waiting to say hello."}</Text>
            {!!person.interests?.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{person.interests.slice(0,6).map((tag) => <View key={tag} style={{ backgroundColor: c.bg, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 7 }}><Text style={{ color: c.text }}>{tag}</Text></View>)}</View>}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <Pressable onPress={() => advance("Pass")} style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 24, minHeight: 54, alignItems: "center", justifyContent: "center" }}><Text style={{ color: c.text, fontSize: 16, fontWeight: "700" }}>× Pass</Text></Pressable>
              <Pressable onPress={() => advance("Like")} style={{ flex: 1, backgroundColor: c.accent, borderRadius: 24, minHeight: 54, alignItems: "center", justifyContent: "center" }}><Text style={{ color: c.onAccent, fontSize: 16, fontWeight: "700" }}>♡ Like</Text></Pressable>
            </View>
          </View>
        </View>
      ) : null}
      <Button label="Refresh people" kind="plain" onPress={() => void load()} busy={busy} />
    </Screen>
  );
}
