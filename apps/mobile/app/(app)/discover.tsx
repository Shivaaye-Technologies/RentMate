import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { apiBaseUrl, supabase } from "../../src/lib/supabase";
import { signedPhotoUrl } from "../../src/lib/photos";
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
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return setError("App configuration is missing.");
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`${apiBaseUrl}/api/v1/matches`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load profiles.");
      setItems(Array.isArray(body.matches) ? body.matches : []);
      setIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load profiles.");
    } finally {
      setBusy(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const person = items[index];
  useFocusEffect(useCallback(() => {
    let active = true;
    setPhotoUrl(null);
    if (person?.photoPath) void signedPhotoUrl(person.photoPath).then(url => { if (active) setPhotoUrl(url); });
    return () => { active = false; };
  }, [person?.id, person?.photoPath]));
  const advance = async (kind: "like" | "pass") => {
    if (!person || !supabase || actionBusy) return;
    setActionBusy(true); setError(null); setFeedback(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      if (!me) throw new Error("Please sign in again.");
      const result = kind === "pass"
        ? await supabase.from("passes").insert({ passer_id: me, passed_id: person.id })
        : await supabase.from("likes").insert({ liker_id: me, liked_id: person.id, is_super: false, message: null });
      if (result.error) throw new Error(result.error.message);
      setFeedback(kind === "like" ? "Like sent." : "Profile passed.");
      setIndex(v => Math.min(v + 1, Math.max(0, items.length - 1)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That action could not be saved.");
    } finally { setActionBusy(false); }
  };
  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View>
          <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>RENTMATE</Text>
          <Title>Discover</Title>
        </View>
        <View
          style={{ backgroundColor: c.card, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 8 }}
        >
          <Text style={{ color: c.text, fontWeight: "700" }}>18+ · Safe space</Text>
        </View>
      </View>
      <Body muted>People, stories and shared interests. Take your time finding your kind of connection.</Body>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {feedback ? <Notice kind="info">{feedback}</Notice> : null}
      {busy ? <Body muted>Finding people…</Body> : null}
      {!busy && !error && !person ? (
        <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 24, gap: 12 }}>
          <Title>It's quiet here</Title>
          <Body>No profiles are available right now. Check back soon or update your preferences.</Body>
          <Button label="Refresh discovery" onPress={() => void load()} />
        </View>
      ) : null}
      {person ? (
        <View
          style={{
            backgroundColor: c.card,
            borderRadius: 26,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          <View
            style={{
              height: 340,
              backgroundColor: "#F4C9DA",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
            ) : (
              <Text style={{ fontSize: 84, color: "#9D426D" }}>
                {(person.displayName ?? "R").slice(0, 1).toUpperCase()}
              </Text>
            )}
            <View
              style={{
                position: "absolute",
                top: 16,
                left: 16,
                backgroundColor: "white",
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 7,
              }}
            >
              <Text style={{ color: "#7B2450", fontWeight: "700" }}>
                {person.online ? "● Active" : "Member"}
              </Text>
            </View>
          </View>
          <View style={{ padding: 20, gap: 10 }}>
            <Text style={{ color: c.text, fontSize: 27, fontWeight: "800" }}>
              {person.displayName || "RentMate member"}, {person.age} {person.verified ? "✓" : ""}
            </Text>
            <Text style={{ color: c.muted }}>
              {typeof person.distanceKm === "number"
                ? `About ${Math.max(1, Math.round(person.distanceKm))} km away`
                : "Discover someone new"}{" "}
              · {person.verified ? "Verified profile" : "Community member"}
            </Text>
            <Text style={{ color: c.text, fontSize: 16, lineHeight: 23 }}>
              {person.bio || "A new connection waiting to say hello."}
            </Text>
            {!!person.interests?.length && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {person.interests.slice(0, 6).map((tag) => (
                  <View
                    key={tag}
                    style={{
                      backgroundColor: c.bg,
                      borderRadius: 18,
                      paddingHorizontal: 11,
                      paddingVertical: 7,
                    }}
                  >
                    <Text style={{ color: c.text }}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <Pressable
                disabled={actionBusy}
                onPress={() => void advance("pass")}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 24,
                  minHeight: 54,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: c.text, fontSize: 16, fontWeight: "700" }}>× Pass</Text>
              </Pressable>
              <Pressable
                disabled={actionBusy}
                onPress={() => void advance("like")}
                style={{
                  flex: 1,
                  backgroundColor: c.accent,
                  borderRadius: 24,
                  minHeight: 54,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: c.onAccent, fontSize: 16, fontWeight: "700" }}>♡ Like</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      <Button label="Refresh people" kind="plain" onPress={() => void load()} busy={busy} />
    </Screen>
  );
}
