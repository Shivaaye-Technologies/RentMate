import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { View, Text, TextInput } from "react-native";
import { apiBaseUrl, supabase } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";
type Stream = {
  id: string;
  title?: string;
  stageName?: string;
  status?: string;
  category?: string;
  explicit?: boolean;
};
export default function Live() {
  const c = usePalette();
  const router = useRouter();
  const [rooms, setRooms] = useState<Stream[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [hostCategories, setHostCategories] = useState<{ key: string; label: string }[]>([]);
  const [hostTitle, setHostTitle] = useState("");
  const [hostCategory, setHostCategory] = useState("");
  const [starting, setStarting] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return setMessage("App configuration is missing.");
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`${apiBaseUrl}/api/v1/live/streams`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load live rooms.");
      const safe = Array.isArray(body.streams) ? body.streams.filter((x: Stream) => !x.explicit) : [];
      setRooms(safe);
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      if (me) {
        const { data: creator } = await supabase.from("creators").select("user_id,categories,status").eq("user_id", me).maybeSingle();
        if (creator?.status === "approved") {
          setCreatorId(creator.user_id);
          const { data: categories } = await supabase.from("content_categories").select("key,label,explicit").in("key", creator.categories ?? []).eq("explicit", false).order("label");
          const allowed = (categories ?? []).map((x) => ({ key: x.key, label: x.label }));
          setHostCategories(allowed);
          setHostCategory((old) => old || allowed[0]?.key || "");
        } else {
          setCreatorId(null);
          setHostCategories([]);
        }
      }
      if (!safe.length) setMessage("No live rooms are available right now. Check back later.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load live rooms.");
    } finally {
      setBusy(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function startHostStream() {
    if (!creatorId || !supabase || starting) return;
    if (hostTitle.trim().length < 3 || !hostCategory) {
      setMessage("Enter a stream title (at least 3 characters) and choose a category.");
      return;
    }
    setStarting(true);
    setMessage(null);
    try {
      const { data, error: insertError } = await supabase.from("live_streams").insert({
        creator_id: creatorId,
        provider_key: "livekit",
        title: hostTitle.trim(),
        category: hostCategory,
        scheduled_at: null,
        participants: [],
      }).select("id").single();
      if (insertError) throw new Error(insertError.message);
      const { data: readiness, error: readinessError } = await supabase.rpc("live_broadcast_check", { p_stream: data.id });
      if (readinessError) throw new Error(readinessError.message);
      const problems = (readiness ?? []) as string[];
      if (problems.length) {
        setMessage("This account or stream is not ready to broadcast: " + problems.join(", ") + ". Complete creator verification, agreement and consent requirements in Creator Studio.");
        return;
      }
      const { data: started, error: startError } = await supabase.rpc("live_start_stream", { p_stream: data.id });
      if (startError) throw new Error(startError.message);
      const startProblems = (started ?? []) as string[];
      if (startProblems.length) {
        setMessage("The stream could not start: " + startProblems.join(", "));
        return;
      }
      router.push({ pathname: "/live/host/[id]", params: { id: data.id } } as never);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not start the live room.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Screen>
      <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>RENTMATE LIVE</Text>
      <Title>Live social rooms</Title>
      <Body>Real conversations, shared interests and positive community energy.</Body>
      <Body muted>
        Only permitted, non-explicit social rooms are shown. Joining is subject to server-side safety checks.
      </Body>
      {message ? <Notice kind="info">{message}</Notice> : null}
      {creatorId ? (
        <View style={{ padding: 16, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, gap: 10 }}>
          <Title>Go live</Title>
          <TextInput value={hostTitle} onChangeText={setHostTitle} maxLength={80} placeholder="Stream title" placeholderTextColor={c.muted} style={{ color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12 }} />
          <Text style={{ color: c.muted }}>Choose an approved non-explicit category:</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {hostCategories.map((category) => (
              <Button key={category.key} label={category.label} kind={hostCategory === category.key ? "primary" : "plain"} disabled={starting} onPress={() => setHostCategory(category.key)} />
            ))}
          </View>
          <Button label={starting ? "Checking readiness…" : "Start live room"} busy={starting} disabled={!hostCategories.length} onPress={() => void startHostStream()} />
          <Body muted>Broadcasting is enabled only for approved creators who pass server-side readiness and consent checks.</Body>
        </View>
      ) : null}
      {rooms.map((room) => (
        <View
          key={room.id}
          style={{
            padding: 18,
            borderRadius: 20,
            backgroundColor: c.card,
            borderColor: c.border,
            borderWidth: 1,
            gap: 8,
          }}
        >
          <Text style={{ color: c.text, fontSize: 18, fontWeight: "700" }}>
            {room.title || "Community room"}
          </Text>
          <Text style={{ color: c.muted }}>
            {room.stageName || "RentMate host"} · {room.category || "Social"} · {room.status || "Scheduled"}
          </Text>
          <Button
            label="Join live room"
            onPress={() => router.push({ pathname: "/live/[id]", params: { id: room.id } } as never)}
          />
        </View>
      ))}
      <Button label="Refresh rooms" onPress={() => void load()} busy={busy} />
    </Screen>
  );
}
