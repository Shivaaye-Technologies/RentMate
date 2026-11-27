/**
 * RentMate interface kit: the top bar, square action buttons, chips, info rows and photo cards shared by the
 * redesigned screens. Original RentMate styling (wordmark, colours, glyphs); no third-party brand assets.
 */
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Image, Pressable, Text, View, type ViewStyle } from "react-native";
import { signedPhotoUrl } from "../lib/photos";
import { supabase } from "../lib/supabase";
import { usePalette } from "../ui";

/** The RentMate wordmark: lower-case, heavy, with the brand dot. */
export function Wordmark({ size = 34 }: { size?: number }) {
  const c = usePalette();
  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel="RentMate"
      style={{ color: c.text, fontSize: size, fontWeight: "900", letterSpacing: -1.2 }}
    >
      rentmate<Text style={{ color: c.brand }}>.</Text>
    </Text>
  );
}

/** Rounded-square button used in the top bar and for small actions. */
export function SquareButton(props: {
  label: string;
  glyph: string;
  onPress: () => void;
  dot?: boolean;
  size?: number;
  dark?: boolean;
}) {
  const c = usePalette();
  const size = props.size ?? 48;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: props.dark ? c.accent : c.surface,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ fontSize: size * 0.42, color: props.dark ? c.onAccent : c.text }}>{props.glyph}</Text>
      {props.dot ? (
        <View
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: c.like,
            borderWidth: 2,
            borderColor: c.bg,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/** Small circular-ish avatar from a private photo path (signed link), or initials. */
export function Avatar(props: { path?: string | null; name?: string; size?: number; radius?: number }) {
  const c = usePalette();
  const size = props.size ?? 48;
  const [uri, setUri] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (props.path)
        void signedPhotoUrl(props.path).then((u) => {
          if (active) setUri(u);
        });
      else setUri(null);
      return () => {
        active = false;
      };
    }, [props.path]),
  );
  const style = {
    width: size,
    height: size,
    borderRadius: props.radius ?? size * 0.3,
    backgroundColor: c.chipActive,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };
  return (
    <View style={style}>
      {uri ? (
        <Image source={{ uri }} style={{ width: "100%", height: "100%" }} accessibilityIgnoresInvertColors />
      ) : (
        <Text style={{ color: c.onChipActive, fontWeight: "800", fontSize: size * 0.4 }}>
          {(props.name ?? "R").trim().slice(0, 1).toUpperCase() || "R"}
        </Text>
      )}
    </View>
  );
}

/** Unread notifications and the member's own main photo, for the top bar. */
function useTopBarState() {
  const [unread, setUnread] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState("");
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!supabase) return;
        const { data: auth } = await supabase.auth.getUser();
        const me = auth.user?.id;
        if (!me) return;
        const [n, p] = await Promise.all([
          supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
          supabase.from("profiles").select("display_name, photo_path").eq("id", me).maybeSingle(),
        ]);
        if (!active) return;
        setUnread((n.count ?? 0) > 0);
        setPhoto((p.data as { photo_path?: string | null } | null)?.photo_path ?? null);
        setName((p.data as { display_name?: string } | null)?.display_name ?? "");
      })();
      return () => {
        active = false;
      };
    }, []),
  );
  return { unread, photo, name };
}

/** Top bar: wordmark or a screen title on the left; filters, notifications and your profile on the right. */
export function TopBar({ title, filters = false }: { title?: string; filters?: boolean }) {
  const router = useRouter();
  const { unread, photo, name } = useTopBarState();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      {title ? <BigTitle>{title}</BigTitle> : <Wordmark />}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {filters ? (
          <SquareButton
            label="Discovery preferences"
            glyph="☰"
            onPress={() => router.push("/(app)/preferences" as Href)}
          />
        ) : null}
        <SquareButton
          label={unread ? "Notifications, unread" : "Notifications"}
          glyph="🔔"
          dot={unread}
          onPress={() => router.push("/(app)/notifications" as Href)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          onPress={() => router.push("/(app)/profile" as Href)}
        >
          <Avatar path={photo} name={name} size={48} />
        </Pressable>
      </View>
    </View>
  );
}

/** Large display title (screen headings such as "Likes" or "Preferences"). */
export function BigTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  const c = usePalette();
  return (
    <View style={{ gap: 2, flexShrink: 1 }}>
      <Text
        accessibilityRole="header"
        style={{ color: c.text, fontSize: 34, fontWeight: "800", letterSpacing: -1 }}
      >
        {children}
      </Text>
      {sub ? <Text style={{ color: c.muted, fontSize: 15 }}>{sub}</Text> : null}
    </View>
  );
}

/** Back arrow row, with an optional title in the middle and an action on the right. */
export function BackBar(props: { title?: string; right?: ReactNode; onBack?: () => void }) {
  const c = usePalette();
  const router = useRouter();
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={12}
        onPress={() =>
          props.onBack ? props.onBack() : router.canGoBack() ? router.back() : router.replace("/")
        }
        style={{ width: 48, height: 48, justifyContent: "center" }}
      >
        <Text style={{ color: c.text, fontSize: 30, fontWeight: "600" }}>‹</Text>
      </Pressable>
      {props.title ? (
        <Text
          style={{ color: c.text, fontSize: 18, fontWeight: "800", flex: 1, textAlign: "center" }}
          numberOfLines={1}
        >
          {props.title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <View style={{ minWidth: 48, alignItems: "flex-end" }}>{props.right}</View>
    </View>
  );
}

/** Selectable chip (preferences, profile details). */
export function Chip(props: { label: string; selected?: boolean; onPress?: () => void; light?: boolean }) {
  const c = usePalette();
  const content = (
    <Text
      style={{
        color: props.selected ? c.onChipActive : c.text,
        fontSize: 16,
        fontWeight: props.selected ? "700" : "500",
      }}
    >
      {props.label}
    </Text>
  );
  const style: ViewStyle = {
    backgroundColor: props.selected ? c.chipActive : props.light ? c.card : c.chip,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: "center",
  };
  if (!props.onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!props.selected }}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [style, { opacity: pressed ? 0.8 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{children}</View>;
}

/** White rounded panel. */
export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = usePalette();
  return (
    <View style={[{ backgroundColor: c.card, borderRadius: 28, padding: 20, gap: 14 }, style]}>
      {children}
    </View>
  );
}

/** Icon + text row inside a panel (profile facts). */
export function FactRow({ glyph, text, last }: { glyph: string; text: string; last?: boolean }) {
  const c = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Text style={{ fontSize: 20, width: 26, textAlign: "center" }}>{glyph}</Text>
      <Text style={{ color: c.text, fontSize: 16, flex: 1 }}>{text}</Text>
    </View>
  );
}

/** Editable row: icon tile, label and value, then an "Add" button or a chevron. */
export function EditRow(props: {
  glyph: string;
  label: string;
  value: string | null;
  onPress: () => void;
  last?: boolean;
}) {
  const c = usePalette();
  const empty = !props.value;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}: ${props.value ?? "not provided"}`}
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 12,
        borderBottomWidth: props.last ? 0 : 1,
        borderBottomColor: c.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 18,
          backgroundColor: c.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 24 }}>{props.glyph}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 17, fontWeight: "700" }}>{props.label}</Text>
        <Text style={{ color: c.muted, fontSize: 15 }} numberOfLines={1}>
          {props.value ?? "Not provided"}
        </Text>
      </View>
      {empty ? (
        <View
          style={{ backgroundColor: c.accent, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 }}
        >
          <Text style={{ color: c.onAccent, fontWeight: "700" }}>Add</Text>
        </View>
      ) : (
        <Text style={{ color: c.text, fontSize: 26 }}>›</Text>
      )}
    </Pressable>
  );
}

/** Menu row with an icon tile and a chevron (profile hub). */
export function MenuRow({
  glyph,
  label,
  onPress,
  badge,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  badge?: string;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          backgroundColor: c.card,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 26 }}>{glyph}</Text>
      </View>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: "700", flex: 1 }}>{label}</Text>
      {badge ? <Text style={{ color: c.muted, fontWeight: "700" }}>{badge}</Text> : null}
      <Text style={{ color: c.text, fontSize: 28 }}>›</Text>
    </Pressable>
  );
}

/** Full-width photo card with a dark band at the bottom for the name and badges. */
export function PhotoCard(props: {
  uri: string | null;
  height: number;
  initials?: string;
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const c = usePalette();
  const body = (
    <View
      style={{ height: props.height, borderRadius: 30, overflow: "hidden", backgroundColor: c.chipActive }}
    >
      {props.uri ? (
        <Image
          source={{ uri: props.uri }}
          resizeMode="cover"
          style={{ width: "100%", height: "100%" }}
          accessibilityLabel={props.accessibilityLabel}
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 96, fontWeight: "900", color: c.onChipActive, opacity: 0.6 }}>
            {props.initials ?? "R"}
          </Text>
        </View>
      )}
      {props.children ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 22,
            paddingTop: 40,
            paddingBottom: 22,
            gap: 8,
            backgroundColor: "rgba(10,8,6,0.38)",
          }}
        >
          {props.children}
        </View>
      ) : null}
    </View>
  );
  if (!props.onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
    >
      {body}
    </Pressable>
  );
}

/** "● Active today" pill shown on photos. */
export function ActivePill({ label }: { label: string }) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: "rgba(20,18,16,0.72)",
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 7,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ADE80" }} />
      <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 15 }}>{label}</Text>
    </View>
  );
}

/** The pass / like / special-like buttons under a profile. */
export function ActionBar(props: {
  onPass: () => void;
  onLike: () => void;
  onSuperLike?: () => void;
  busy?: boolean;
}) {
  const c = usePalette();
  const big = (glyph: string, label: string, onPress: () => void, color: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={props.busy}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 86,
        height: 86,
        borderRadius: 28,
        backgroundColor: "#2A2725",
        alignItems: "center",
        justifyContent: "center",
        opacity: props.busy ? 0.5 : pressed ? 0.8 : 1,
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      })}
    >
      <Text style={{ fontSize: 38, color, fontWeight: "900" }}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 22 }}>
      {big("✕", "Pass", props.onPass, "#FFFFFF")}
      {big("♥", "Like", props.onLike, c.like)}
      {props.onSuperLike ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Special like"
          disabled={props.busy}
          onPress={props.onSuperLike}
          style={({ pressed }) => ({
            width: 64,
            height: 64,
            borderRadius: 22,
            backgroundColor: c.star,
            alignItems: "center",
            justifyContent: "center",
            opacity: props.busy ? 0.5 : pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ fontSize: 28, color: "#141210" }}>★</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Progress bar (profile completion). */
export function Progress({ value, color }: { value: number; color?: string }) {
  const c = usePalette();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ height: 8, borderRadius: 4, backgroundColor: c.surface, overflow: "hidden" }}
    >
      <View
        style={{ width: `${pct}%`, height: "100%", borderRadius: 4, backgroundColor: color ?? c.brand }}
      />
    </View>
  );
}

/** Number stepper used for ranges (age, height) without a native slider dependency. */
export function Stepper(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  const c = usePalette();
  const step = props.step ?? 1;
  const btn = (glyph: string, next: number, disabled: boolean, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => props.onChange(next)}
      style={{
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Text style={{ color: c.text, fontSize: 24, fontWeight: "700" }}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={{ alignItems: "center", gap: 8, flex: 1 }}>
      <Text style={{ color: c.muted, fontWeight: "600" }}>{props.label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {btn("−", props.value - step, props.value - step < props.min, `Decrease ${props.label}`)}
        <Text style={{ color: c.text, fontSize: 24, fontWeight: "800", minWidth: 44, textAlign: "center" }}>
          {props.value}
        </Text>
        {btn("+", props.value + step, props.value + step > props.max, `Increase ${props.label}`)}
      </View>
    </View>
  );
}
