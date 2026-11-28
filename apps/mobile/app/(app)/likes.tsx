import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { Chip, ChipRow, TopBar } from "../../src/components/kit";
import { supabase } from "../../src/lib/supabase";
import { signedPhotoUrl } from "../../src/lib/photos";
import { Body, Notice, Screen, usePalette } from "../../src/ui";
import { dbFailure } from "../../src/lib/diagnostics";

type PersonRow = {
  id: string;
  display_name: string;
  age: number;
  bio: string | null;
  photo_path: string | null;
  verified: boolean;
  online: boolean;
  created_at: string;
  interests: string[] | null;
};
type LikeRow = {
  liker_id: string;
  liked_id: string;
  is_super: boolean;
  message: string | null;
  created_at: string;
};
type MatchRow = { id: string; user_a: string; user_b: string; created_at: string };
type Tile = {
  id: string;
  name: string;
  age: number;
  photo: string | null;
  verified: boolean;
  online: boolean;
  super: boolean;
  message: string | null;
  at: string;
  matchId?: string;
};

export default function Likes() {
  const c = usePalette();
  const router = useRouter();
  const [tab, setTab] = useState<"received" | "sent" | "matches">("received");
  const [received, setReceived] = useState<Tile[]>([]);
  const [sent, setSent] = useState<Tile[]>([]);
  const [matches, setMatches] = useState<Tile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const [r, s, p, m] = await Promise.all([
        supabase
          .from("likes")
          .select("liker_id,liked_id,is_super,message,created_at")
          .eq("liked_id", me)
          .order("created_at", { ascending: false }),
        supabase
          .from("likes")
          .select("liker_id,liked_id,is_super,message,created_at")
          .eq("liker_id", me)
          .order("created_at", { ascending: false }),
        supabase.from("passes").select("passed_id").eq("passer_id", me),
        supabase
          .from("matches")
          .select("id,user_a,user_b,created_at")
          .order("created_at", { ascending: false }),
      ]);
      dbFailure("likes (received)", r.error);
      dbFailure("likes (sent)", s.error);
      dbFailure("passes", p.error);
      dbFailure("matches", m.error);
      const failure = r.error ?? s.error ?? p.error ?? m.error;
      if (failure)
        throw new Error(
          `We couldn't load your likes (${failure.code ?? "error"}). Pull to refresh or try again later.`,
        );
      const receivedRows = (r.data ?? []) as LikeRow[];
      const sentRows = (s.data ?? []) as LikeRow[];
      const passRows = p.data ?? [];
      const matchRows = (m.data ?? []) as MatchRow[];
      const answered = new Set([...sentRows.map((x) => x.liked_id), ...passRows.map((x) => x.passed_id)]);
      const waiting = sentRows.filter((x) => !receivedRows.some((y) => y.liker_id === x.liked_id));
      const ids = [
        ...new Set([
          ...receivedRows.filter((x) => !answered.has(x.liker_id)).map((x) => x.liker_id),
          ...waiting.map((x) => x.liked_id),
          ...matchRows.map((x) => (x.user_a === me ? x.user_b : x.user_a)),
        ]),
      ];
      const peopleResult = ids.length
        ? await supabase.rpc("profiles_by_ids", { p_ids: ids })
        : { data: [], error: null };
      if (peopleResult.error) throw new Error(peopleResult.error.message);
      const people = new Map(((peopleResult.data ?? []) as PersonRow[]).map((x) => [x.id, x]));
      const makeTiles = async (rows: LikeRow[], idKey: "liker_id" | "liked_id") =>
        Promise.all(
          rows
            .flatMap((x) => {
              const person = people.get(x[idKey]);
              if (!person) return [];
              return [
                {
                  id: person.id,
                  name: person.display_name,
                  age: person.age,
                  photoPath: person.photo_path,
                  verified: person.verified,
                  online: person.online,
                  super: x.is_super,
                  message: x.message,
                  at: x.created_at,
                },
              ];
            })
            .map(async (x) => ({ ...x, photo: await signedPhotoUrl(x.photoPath) })),
        );
      const [receivedTiles, sentTiles] = await Promise.all([
        makeTiles(
          receivedRows.filter((x) => !answered.has(x.liker_id)),
          "liker_id",
        ),
        makeTiles(waiting, "liked_id"),
      ]);
      const matchTiles = await Promise.all(
        matchRows
          .flatMap((x) => {
            const person = people.get(x.user_a === me ? x.user_b : x.user_a);
            if (!person) return [];
            return [
              {
                id: person.id,
                name: person.display_name,
                age: person.age,
                photoPath: person.photo_path,
                verified: person.verified,
                online: person.online,
                super: false,
                message: null,
                at: x.created_at,
                matchId: x.id,
              },
            ];
          })
          .map(async (x) => ({ ...x, photo: await signedPhotoUrl(x.photoPath) })),
      );
      setReceived(receivedTiles);
      setSent(sentTiles);
      setMatches(matchTiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load likes.");
    } finally {
      setBusy(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const rows = tab === "received" ? received : tab === "sent" ? sent : matches;
  const empty =
    tab === "received"
      ? "No new likes yet. When someone likes you, they will appear here."
      : tab === "sent"
        ? "You have no pending likes."
        : "Your mutual matches will appear here.";
  return (
    <Screen>
      <TopBar title="Likes" />
      <ChipRow>
        {(["received", "sent", "matches"] as const).map((key) => (
          <Chip
            key={key}
            label={
              key === "received"
                ? `Liked you${received.length ? ` · ${received.length}` : ""}`
                : key === "sent"
                  ? "You liked"
                  : "Matches"
            }
            selected={tab === key}
            onPress={() => setTab(key)}
          />
        ))}
      </ChipRow>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {busy && rows.length === 0 ? (
        <ActivityIndicator accessibilityLabel="Loading likes" color={c.text} />
      ) : null}
      {!busy && !error && rows.length === 0 ? (
        <View
          style={{ backgroundColor: c.card, borderRadius: 28, padding: 24, gap: 10, alignItems: "center" }}
        >
          <Text style={{ fontSize: 40 }}>♥</Text>
          <Body muted>{empty}</Body>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {rows.map((person) => (
          <Pressable
            key={person.matchId ?? person.id}
            accessibilityRole="button"
            accessibilityLabel={`${person.name}, ${person.age}`}
            onPress={() => {
              if (tab === "matches" && person.matchId) {
                router.push({ pathname: "/chat", params: { matchId: person.matchId } });
              } else {
                router.push({
                  pathname: "/(app)/user/[id]",
                  params: { id: person.id, actions: tab === "received" ? "1" : "0" },
                } as never);
              }
            }}
            style={{
              width: "48%",
              height: 250,
              borderRadius: 26,
              overflow: "hidden",
              backgroundColor: c.chipActive,
            }}
          >
            {person.photo ? (
              <Image source={{ uri: person.photo }} style={{ width: "100%", height: "100%" }} />
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: c.onChipActive, fontSize: 56, fontWeight: "900" }}>
                  {person.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                padding: 12,
                backgroundColor: "rgba(10,8,6,0.42)",
                gap: 2,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "800" }} numberOfLines={1}>
                {person.name}, {person.age} {person.verified ? "✓" : ""}
              </Text>
              <Text style={{ color: "#F1ECE6", fontSize: 13 }} numberOfLines={1}>
                {person.super
                  ? "★ Special like"
                  : person.online
                    ? "● Active now"
                    : tab === "matches"
                      ? "It's a match"
                      : "Like"}
              </Text>
              {person.message ? (
                <Text style={{ color: "#FFFFFF", fontSize: 13 }} numberOfLines={2}>
                  “{person.message}”
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
