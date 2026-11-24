import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Pressable, Text, TextInput, View } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { signedPhotoUrl } from "../../src/lib/photos";
import { SafetyActions } from "../../src/components/SafetyActions";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

type MatchRow = { id: string; user_a: string; user_b: string; created_at: string };
type PersonRow = {
  id: string;
  display_name: string;
  age: number;
  photo_path: string | null;
  online: boolean;
};
type Message = { id: string; match_id: string; sender_id: string; body: string; created_at: string };
type IncomingCall = { id: string; caller_id: string; mode: "voice" | "video"; created_at: string };
type Thread = {
  matchId: string;
  personId: string;
  name: string;
  age: number;
  photo: string | null;
  last: Message | null;
};
export default function Chat() {
  const c = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const requestedMatchId = Array.isArray(params.matchId) ? params.matchId[0] : params.matchId;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [active, setActive] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [answeringCall, setAnsweringCall] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) {
      setError("App configuration is missing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      if (!me) throw new Error("Please sign in again.");
      setMyId(me);
      const { data: rows, error: matchError } = await supabase
        .from("matches")
        .select("id,user_a,user_b,created_at")
        .order("created_at", { ascending: false });
      if (matchError) throw new Error(matchError.message);
      const matches = (rows ?? []) as MatchRow[];
      if (!matches.length) {
        setThreads([]);
        return;
      }
      const ids = matches.map((x) => (x.user_a === me ? x.user_b : x.user_a));
      const [people, msgs] = await Promise.all([
        supabase.rpc("profiles_by_ids", { p_ids: ids }),
        supabase
          .from("messages")
          .select("id,match_id,sender_id,body,created_at")
          .in(
            "match_id",
            matches.map((x) => x.id),
          )
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);
      if (people.error) throw new Error(people.error.message);
      if (msgs.error) throw new Error(msgs.error.message);
      const byId = new Map(((people.data ?? []) as PersonRow[]).map((x) => [x.id, x]));
      const latest = new Map<string, Message>();
      for (const msg of (msgs.data ?? []) as Message[])
        if (!latest.has(msg.match_id)) latest.set(msg.match_id, msg);
      const built = await Promise.all(
        matches
          .flatMap((row) => {
            const person = byId.get(row.user_a === me ? row.user_b : row.user_a);
            if (!person) return [];
            return [
              {
                matchId: row.id,
                personId: person.id,
                name: person.display_name,
                age: person.age,
                photoPath: person.photo_path,
                last: latest.get(row.id) ?? null,
              },
            ];
          })
          .map(async (x) => ({ ...x, photo: await signedPhotoUrl(x.photoPath) })),
      );
      setThreads(built);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load conversations.");
    } finally {
      setBusy(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (!requestedMatchId) return;
    const thread = threads.find((item) => item.matchId === requestedMatchId);
    if (!thread) return;
    setError(null);
    setMessages([]);
    setActive(thread);
  }, [requestedMatchId, threads]);
  useEffect(() => {
    if (!myId || !supabase) return;
    let cancelled = false;
    const loadIncoming = async () => {
      const { data, error: queryError } = await supabase!
        .from("call_sessions")
        .select("id,caller_id,mode,created_at")
        .eq("callee_id", myId)
        .eq("status", "ringing")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && !queryError) setIncomingCall((data as IncomingCall | null) ?? null);
    };
    void loadIncoming();
    const channel = supabase
      .channel("mobile-incoming-calls:" + myId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_sessions", filter: "callee_id=eq." + myId },
        () => void loadIncoming(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase!.removeChannel(channel);
    };
  }, [myId]);
  async function answerIncoming(accept: boolean) {
    if (!incomingCall || !supabase || answeringCall) return;
    setAnsweringCall(true);
    setError(null);
    try {
      const { error: answerError } = await supabase.rpc("call_answer", {
        p_call: incomingCall.id,
        p_accept: accept,
      });
      if (answerError) throw new Error(answerError.message);
      const call = incomingCall;
      setIncomingCall(null);
      if (accept) {
        router.push({
          pathname: "/call/[id]" as Href,
          params: { id: call.id, mode: call.mode === "voice" ? "audio" : "video" },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not answer the call.");
    } finally {
      setAnsweringCall(false);
    }
  }
  const activeMatchId = active?.matchId;
  useEffect(() => {
    if (!activeMatchId || !supabase) return;
    let cancelled = false;
    const loadMessages = async () => {
      const { data, error: queryError } = await supabase!
        .from("messages")
        .select("id,match_id,sender_id,body,created_at")
        .eq("match_id", activeMatchId)
        .order("created_at", { ascending: true })
        .limit(300);
      if (cancelled) return;
      if (queryError) setError(queryError.message);
      else setMessages((data ?? []) as Message[]);
      const { data: auth } = await supabase!.auth.getUser();
      if (auth.user?.id)
        await supabase!
          .from("match_reads")
          .upsert(
            { match_id: activeMatchId, user_id: auth.user.id, read_at: new Date().toISOString() },
            { onConflict: "match_id,user_id" },
          );
    };
    void loadMessages();
    const channel = supabase
      .channel("mobile-chat:" + activeMatchId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "match_id=eq." + activeMatchId },
        (payload) => {
          const next = payload.new as Message;
          setMessages((old) => (old.some((x) => x.id === next.id) ? old : [...old, next]));
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase!.removeChannel(channel);
    };
  }, [activeMatchId]);
  async function send() {
    const body = draft.trim();
    if (!body || !active || sending || !supabase) return;
    if (body.length > 2000) {
      setError("Messages must be 2,000 characters or fewer.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      if (!me) throw new Error("Please sign in again.");
      const { data, error: insertError } = await supabase
        .from("messages")
        .insert({ match_id: active.matchId, sender_id: me, body })
        .select("id,match_id,sender_id,body,created_at")
        .single();
      if (insertError) throw new Error(insertError.message);
      setMessages((old) => (old.some((x) => x.id === data.id) ? old : [...old, data as Message]));
      setDraft("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message not sent.");
    } finally {
      setSending(false);
    }
  }
  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Title>{active ? active.name : "Messages"}</Title>
        {active ? (
          <Button
            label="Back"
            kind="plain"
            onPress={() => {
              setActive(null);
              setMessages([]);
            }}
          />
        ) : (
          <Button label="Refresh" kind="plain" busy={busy} onPress={() => void load()} />
        )}
      </View>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {incomingCall ? (
        <View
          style={{
            padding: 14,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: c.accent,
            backgroundColor: c.card,
            gap: 10,
          }}
        >
          <Body>{incomingCall.mode === "voice" ? "Incoming voice call" : "Incoming video call"}</Body>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Accept" busy={answeringCall} onPress={() => void answerIncoming(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Decline"
                kind="danger"
                disabled={answeringCall}
                onPress={() => void answerIncoming(false)}
              />
            </View>
          </View>
        </View>
      ) : null}
      {active ? (
        <SafetyActions
          userId={active.personId}
          matchId={active.matchId}
          onBlocked={() => {
            setActive(null);
            setMessages([]);
            void load();
          }}
          onUnmatched={() => {
            setActive(null);
            setMessages([]);
            void load();
          }}
        />
      ) : null}
      {active ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              label="Voice call"
              onPress={() =>
                router.push({
                  pathname: "/call/[id]" as Href,
                  params: { id: "new", callee: active.personId, mode: "audio" },
                })
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Video call"
              onPress={() =>
                router.push({
                  pathname: "/call/[id]" as Href,
                  params: { id: "new", callee: active.personId, mode: "video" },
                })
              }
            />
          </View>
        </View>
      ) : null}
      {!active ? (
        <>
          <Body muted>Chats are available after a mutual match.</Body>
          {!busy && threads.length === 0 ? (
            <Body muted>
              No matches yet. When you both like each other, your conversations will appear here.
            </Body>
          ) : null}
          {threads.map((t) => (
            <Pressable
              key={t.matchId}
              onPress={() => {
                setError(null);
                setActive(t);
              }}
              style={{
                padding: 14,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.card,
                gap: 4,
              }}
            >
              <Text style={{ color: c.text, fontWeight: "700", fontSize: 17 }}>
                {t.name}, {t.age}
              </Text>
              <Text style={{ color: c.muted }} numberOfLines={1}>
                {t.last?.body ?? "Say hello 👋"}
              </Text>
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <View style={{ minHeight: 260, gap: 10 }}>
            {messages.map((m) => (
              <View
                key={m.id}
                style={{
                  alignSelf: m.sender_id === myId ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  padding: 12,
                  borderRadius: 16,
                  backgroundColor: m.sender_id === myId ? c.accent : c.card,
                }}
              >
                <Text style={{ color: m.sender_id === myId ? c.onAccent : c.text }}>{m.body}</Text>
                <Text
                  style={{ color: m.sender_id === myId ? c.onAccent : c.muted, fontSize: 10, marginTop: 4 }}
                >
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
            ))}
            {!messages.length ? (
              <Body muted>Your conversation starts here. Keep it respectful and stay safe.</Body>
            ) : null}
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message…"
            placeholderTextColor={c.muted}
            multiline
            maxLength={2000}
            style={{
              minHeight: 50,
              maxHeight: 120,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 14,
              padding: 12,
              color: c.text,
              backgroundColor: c.card,
            }}
          />
          <Button
            label={sending ? "Sending…" : "Send message"}
            busy={sending}
            disabled={!draft.trim()}
            onPress={() => void send()}
          />
        </>
      )}
    </Screen>
  );
}
