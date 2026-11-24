import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";
import { Body, Button, Notice, Title, usePalette } from "../ui";

type Message = { id: string; sender_id: string; body: string; created_at: string };
type Reaction = { id: number; kind: string; created_at: string };
const REACTIONS = ["heart", "clap", "laugh", "wow", "fire"] as const;
const EMOJI: Record<string, string> = { heart: "❤️", clap: "👏", laugh: "😂", wow: "😮", fire: "🔥" };

export function LiveChat({ streamId }: { streamId: string }) {
  const c = usePalette();
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const db = client as NonNullable<typeof client>;
    let active = true;
    async function load() {
      const [chat, reacts] = await Promise.all([
        db.from("live_chat_messages").select("id,sender_id,body,created_at").eq("stream_id", streamId).is("hidden_at", null).order("created_at", { ascending: false }).limit(40),
        db.from("live_reactions").select("id,kind,created_at").eq("stream_id", streamId).order("created_at", { ascending: false }).limit(30),
      ]);
      if (!active) return;
      if (chat.error) setError(chat.error.message);
      else setMessages((chat.data ?? []).reverse() as Message[]);
      if (!reacts.error) setReactions((reacts.data ?? []) as Reaction[]);
    }
    void load();
    const channel = db
      .channel("live-chat-" + streamId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_chat_messages", filter: "stream_id=eq." + streamId }, (payload) => {
        const next = payload.new as Message;
        if (active) setMessages((old) => old.some((m) => m.id === next.id) ? old : [...old.slice(-39), next]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "live_chat_messages", filter: "stream_id=eq." + streamId }, (payload) => {
        if (payload.eventType === "UPDATE" && active) {
          const changed = payload.new as Message & { hidden_at?: string | null };
          if (changed.hidden_at) setMessages((old) => old.filter((m) => m.id !== changed.id));
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_reactions", filter: "stream_id=eq." + streamId }, (payload) => {
        if (active) setReactions((old) => [payload.new as Reaction, ...old].slice(0, 30));
      })
      .subscribe();
    return () => {
      active = false;
      void db.removeChannel(channel);
    };
  }, [streamId]);

  async function send() {
    const body = draft.trim();
    if (!body || body.length > 300 || !supabase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Please sign in to chat.");
      const { error: insertError } = await supabase.from("live_chat_messages").insert({
        stream_id: streamId,
        sender_id: auth.user.id,
        body,
      });
      if (insertError) throw new Error(insertError.message);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function react(kind: (typeof REACTIONS)[number]) {
    if (!supabase) return;
    const { error: reactionError } = await supabase.rpc("live_react", { p_stream: streamId, p_kind: kind });
    if (reactionError) setError(reactionError.message);
  }

  return (
    <View style={{ gap: 10, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 14, backgroundColor: c.card }}>
      <Title>Live chat</Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {REACTIONS.map((kind) => (
          <Button key={kind} label={EMOJI[kind]} kind="plain" onPress={() => void react(kind)} />
        ))}
      </View>
      {reactions.length ? (
        <Text style={{ color: c.muted }}>{reactions.slice(0, 12).map((r) => EMOJI[r.kind] ?? "✨").join(" ")}</Text>
      ) : null}
      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
        <View style={{ gap: 8 }}>
          {messages.length ? messages.map((m) => (
            <View key={m.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>{m.sender_id.slice(0, 8)}</Text>
              <Text style={{ color: c.text }}>{m.body}</Text>
            </View>
          )) : <Body muted>Be the first to say hello.</Body>}
        </View>
      </ScrollView>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <TextInput
        value={draft}
        onChangeText={setDraft}
        maxLength={300}
        placeholder="Write a respectful message…"
        placeholderTextColor={c.muted}
        multiline
        style={{ minHeight: 44, maxHeight: 100, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 10 }}
      />
      <Button label={busy ? "Sending…" : "Send message"} busy={busy} disabled={!draft.trim()} onPress={() => void send()} />
      <Body muted>Messages are screened and rate-limited. Adult or explicit content is not allowed.</Body>
    </View>
  );
}
