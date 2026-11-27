import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, Panel, SquareButton, TopBar } from "../../src/components/kit";
import { supabase } from "../../src/lib/supabase";
import { signedPhotoUrl } from "../../src/lib/photos";
import { SafetyActions } from "../../src/components/SafetyActions";
import { Body, Button, Notice, Screen, usePalette } from "../../src/ui";

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
  photoPath: string | null;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [companionOf, setCompanionOf] = useState<string | null>(null);
  // Offer "Book an activity" only when the other person is an approved companion (visible under RLS).
  useEffect(() => {
    if (!active || !supabase) return;
    let alive = true;
    void supabase
      .from("companion_profiles")
      .select("user_id")
      .eq("user_id", active.personId)
      .maybeSingle()
      .then(({ data }) => alive && setCompanionOf(data ? active.personId : null));
    return () => {
      alive = false;
    };
  }, [active]);
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
          pathname: "/call/[id]",
          params: { id: call.id, mode: call.mode === "voice" ? "audio" : "video" },
        } as never);
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
  const openProfile = (personId: string) =>
    router.push({ pathname: "/(app)/user/[id]", params: { id: personId, actions: "0" } } as never);
  const callButtons = active ? (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Button
          label="📞 Voice call"
          kind="plain"
          onPress={() =>
            router.push({
              pathname: "/call/[id]",
              params: { id: "new", callee: active.personId, mode: "audio" },
            } as never)
          }
        />
      </View>
      <View style={{ flex: 1 }}>
        <Button
          label="🎥 Video call"
          kind="plain"
          onPress={() =>
            router.push({
              pathname: "/call/[id]",
              params: { id: "new", callee: active.personId, mode: "video" },
            } as never)
          }
        />
      </View>
    </View>
  ) : null;
  const incoming = incomingCall ? (
    <Panel style={{ borderWidth: 2, borderColor: c.chipActive }}>
      <Body>{incomingCall.mode === "voice" ? "📞 Incoming voice call" : "🎥 Incoming video call"}</Body>
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
    </Panel>
  ) : null;

  if (active) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to conversations"
              hitSlop={12}
              onPress={() => {
                setActive(null);
                setMessages([]);
                setMenuOpen(false);
              }}
            >
              <Text style={{ color: c.text, fontSize: 30, fontWeight: "600" }}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`See ${active.name}'s profile`}
              onPress={() => openProfile(active.personId)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}
            >
              <Avatar path={active.photoPath} name={active.name} size={56} radius={18} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 18, fontWeight: "800" }} numberOfLines={1}>
                  {active.name}, {active.age}
                </Text>
                <Text style={{ color: c.muted }}>See profile</Text>
              </View>
            </Pressable>
            <SquareButton label="More options" glyph="⋯" onPress={() => setMenuOpen((v) => !v)} />
          </View>
          <ScrollView
            contentContainerStyle={{
              padding: 16,
              gap: 10,
              flexGrow: 1,
              width: "100%",
              maxWidth: 640,
              alignSelf: "center",
            }}
            keyboardShouldPersistTaps="handled"
          >
            {error ? <Notice kind="error">{error}</Notice> : null}
            {incoming}
            {menuOpen ? (
              <Panel>
                {callButtons}
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
              </Panel>
            ) : null}
            {companionOf === active.personId ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/(app)/booking/new/[companion]",
                    params: { companion: active.personId },
                  } as never)
                }
                style={{
                  backgroundColor: c.tabBar,
                  borderRadius: 22,
                  padding: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Text style={{ fontSize: 24 }}>🗓️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>
                    Book an activity with {active.name}
                  </Text>
                  <Text style={{ color: "#D9D3CC", fontSize: 13 }}>
                    Public places only · tokens held until you both confirm
                  </Text>
                </View>
                <Text style={{ color: "#FFFFFF", fontSize: 24 }}>›</Text>
              </Pressable>
            ) : null}
            {!messages.length ? (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 14,
                  paddingVertical: 30,
                }}
              >
                <Avatar path={active.photoPath} name={active.name} size={180} radius={36} />
                <Text style={{ color: c.text, fontSize: 20, fontWeight: "800" }}>
                  You matched with {active.name}
                </Text>
                <Body muted>Say hello. Keep it kind, and meet in public places.</Body>
              </View>
            ) : null}
            {messages.map((m) => {
              const mine = m.sender_id === myId;
              return (
                <View
                  key={m.id}
                  style={{
                    alignSelf: mine ? "flex-end" : "flex-start",
                    maxWidth: "82%",
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderRadius: 22,
                    borderBottomRightRadius: mine ? 6 : 22,
                    borderBottomLeftRadius: mine ? 22 : 6,
                    backgroundColor: mine ? c.accent : c.card,
                  }}
                >
                  <Text style={{ color: mine ? c.onAccent : c.text, fontSize: 16 }}>{m.body}</Text>
                  <Text
                    style={{ color: mine ? c.onAccent : c.muted, fontSize: 11, marginTop: 4, opacity: 0.7 }}
                  >
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message…"
              placeholderTextColor={c.muted}
              accessibilityLabel="Message"
              multiline
              maxLength={2000}
              style={{
                flex: 1,
                minHeight: 56,
                maxHeight: 130,
                borderRadius: 28,
                paddingHorizontal: 20,
                paddingTop: 16,
                paddingBottom: 14,
                color: c.text,
                fontSize: 16,
                backgroundColor: c.card,
                borderWidth: 1,
                borderColor: c.border,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!draft.trim() || sending}
              onPress={() => void send()}
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: c.accent,
                alignItems: "center",
                justifyContent: "center",
                opacity: !draft.trim() || sending ? 0.4 : 1,
              }}
            >
              <Text style={{ color: c.onAccent, fontSize: 22 }}>➤</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <Screen>
      <TopBar title="Chat" />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {incoming}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/(app)/booking" as never)}
        style={{
          backgroundColor: c.card,
          borderRadius: 24,
          padding: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: c.tabBar,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 24 }}>🗓️</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: "800" }}>Booking chats</Text>
          <Text style={{ color: c.muted }}>Messages for your activity bookings</Text>
        </View>
        <Text style={{ color: c.text, fontSize: 26 }}>›</Text>
      </Pressable>
      {busy && !threads.length ? (
        <ActivityIndicator accessibilityLabel="Loading conversations" color={c.text} />
      ) : null}
      {!busy && threads.length === 0 ? (
        <Panel style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 40 }}>💬</Text>
          <Body muted>No conversations yet. When you both like each other, you can chat here.</Body>
        </Panel>
      ) : null}
      {threads.map((t) => (
        <Pressable
          key={t.matchId}
          accessibilityRole="button"
          accessibilityLabel={`Chat with ${t.name}`}
          onPress={() => {
            setError(null);
            setActive(t);
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            paddingVertical: 6,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Avatar path={t.photoPath} name={t.name} size={64} radius={22} />
          <View
            style={{ flex: 1, gap: 3, borderBottomWidth: 1, borderBottomColor: c.border, paddingBottom: 12 }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: c.text, fontWeight: "800", fontSize: 17 }} numberOfLines={1}>
                {t.name}, {t.age}
              </Text>
              {t.last ? (
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  {new Date(t.last.created_at).toLocaleDateString([], { day: "numeric", month: "short" })}
                </Text>
              ) : null}
            </View>
            <Text
              style={{ color: t.last ? c.muted : c.text, fontWeight: t.last ? "400" : "700" }}
              numberOfLines={1}
            >
              {t.last?.body ?? "New match · say hello 👋"}
            </Text>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}
