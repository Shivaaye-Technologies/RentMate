import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Text, View } from "react-native";
import { apiBaseUrl, supabase } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

type Candidate = { id: string; displayName: string; age: number; bio: string; interests?: string[]; online?: boolean; distanceKm?: number | null; verified?: boolean };
export default function Discover() {
  const c = usePalette();
  const [items, setItems] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const load = useCallback(async () => {
    if (!supabase) return setError("App configuration is missing.");
    setBusy(true); setError(null);
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
  return <Screen>
    <Title>Discover people</Title>
    <Body muted>Meet adults who share your interests. Be respectful and take your time.</Body>
    {error ? <Notice kind="error">{error}</Notice> : null}
    {busy ? <Body muted>Loading profiles…</Body> : null}
    {!busy && !error && !person ? <Body>No profiles to show right now. Try again later.</Body> : null}
    {person ? <View style={{ padding: 18, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, gap: 12 }}>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: "700" }}>{person.displayName || "RentMate member"}, {person.age}</Text>
      <Text style={{ color: c.muted }}>{person.online ? "Active recently" : "Member"}{person.verified ? " · Verified profile" : ""}{typeof person.distanceKm === "number" ? ` · About ${Math.round(person.distanceKm)} km away` : ""}</Text>
      <Text style={{ color: c.text, fontSize: 16 }}>{person.bio || "This member hasn't added an introduction yet."}</Text>
      {person.interests?.length ? <Text style={{ color: c.muted }}>Interests: {person.interests.join(" · ")}</Text> : null}
      <Body muted>Profile photos and like/pass actions will be enabled in the next connected discovery milestone.</Body>
      <Button label="Next profile" onPress={() => setIndex((v) => (v + 1) % items.length)} disabled={items.length < 2} />
    </View> : null}
    <Button label="Refresh profiles" kind="plain" onPress={() => void load()} busy={busy} />
  </Screen>;
}