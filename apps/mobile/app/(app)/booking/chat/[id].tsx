import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { bookingErrorMessage } from "../../../../src/lib/bookings";
import { supabase } from "../../../../src/lib/supabase";
import { Button, Notice, usePalette } from "../../../../src/ui";

type Msg = {
  id: string;
  sender_id: string | null;
  kind: "text" | "system";
  body: string;
  created_at: string;
};

/** Chat for one booking. Only its two participants can read or write (enforced by the database). */
export default function BookingChat() {
  const c = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [me, setMe] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<Msg>>(null);

  const load = useCallback(async () => {
    if (!supabase || !id) return;
    const { data: auth } = await supabase.auth.getUser();
    setMe(auth.user?.id ?? null);
    const { data, error: e } = await supabase
      .from("booking_messages")
      .select("id, sender_id, kind, body, created_at")
      .eq("booking_id", id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (e) return setError(bookingErrorMessage(e));
    setMsgs((data ?? []) as Msg[]);
  }, [id]);

  useEffect(() => {
    void load();
    const client = supabase;
    if (!client || !id) return;
    const channel = client
      .channel(`booking-chat-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "booking_messages", filter: `booking_id=eq.${id}` },
        (p) => setMsgs((m) => (m && !m.some((x) => x.id === (p.new as Msg).id) ? [...m, p.new as Msg] : m)),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [id, load]);

  async function send() {
    const body = text.trim();
    if (!supabase || !id || !body || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("booking_messages")
      .insert({ booking_id: id, body })
      .select("id, sender_id, kind, body, created_at")
      .single();
    setBusy(false);
    if (e) return setError(bookingErrorMessage(e));
    setText("");
    setMsgs((m) => (m && !m.some((x) => x.id === (data as Msg).id) ? [...m, data as Msg] : m));
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["bottom", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        {!msgs && !error ? <ActivityIndicator style={{ marginTop: 24 }} color={c.accent} /> : null}
        <FlatList
          ref={list}
          data={msgs ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) =>
            item.kind === "system" ? (
              <Text style={{ color: c.muted, textAlign: "center", fontSize: 13 }}>{item.body}</Text>
            ) : (
              <View
                style={{
                  alignSelf: item.sender_id === me ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  backgroundColor: item.sender_id === me ? c.accent : c.card,
                  borderRadius: 14,
                  padding: 10,
                }}
              >
                <Text style={{ color: item.sender_id === me ? c.onAccent : c.text }}>{item.body}</Text>
              </View>
            )
          }
        />
        {error ? (
          <View style={{ paddingHorizontal: 16 }}>
            <Notice kind="error">{error}</Notice>
          </View>
        ) : null}
        <View
          style={{ flexDirection: "row", gap: 8, padding: 12, borderTopColor: c.border, borderTopWidth: 1 }}
        >
          <TextInput
            accessibilityLabel="Message"
            value={text}
            onChangeText={setText}
            placeholder="Message about this booking"
            placeholderTextColor={c.muted}
            maxLength={1000}
            style={{
              flex: 1,
              color: c.text,
              borderColor: c.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 10,
            }}
          />
          <Button label="Send" onPress={() => void send()} busy={busy} disabled={!text.trim()} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
