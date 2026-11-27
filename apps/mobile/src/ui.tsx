/**
 * Small accessible building blocks. Touch targets are at least 48 dp, text
 * scales with the system font size, and colours follow the system light/dark
 * setting.
 */
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * RentMate palette: warm paper background, ink-black controls, lavender highlights. Every screen reads colours from
 * here, so the look stays consistent and dark mode keeps working.
 */
export function usePalette() {
  const dark = useColorScheme() === "dark";
  return dark
    ? {
        bg: "#121110",
        text: "#F3EFEA",
        muted: "#A8A29A",
        card: "#1D1B19",
        border: "#34302C",
        accent: "#F3EFEA",
        onAccent: "#141210",
        danger: "#F87171",
        chip: "#2A2724",
        chipActive: "#B99AD6",
        onChipActive: "#141210",
        brand: "#E879B9",
        like: "#F0435B",
        star: "#8EC5F0",
        tabBar: "#0B0A09",
        surface: "#26231F",
      }
    : {
        bg: "#F1ECE6",
        text: "#141210",
        muted: "#6E6860",
        card: "#FAF8F5",
        border: "#E3DDD5",
        accent: "#141210",
        onAccent: "#FFFFFF",
        danger: "#B42318",
        chip: "#E5DFD8",
        chipActive: "#D7BDEB",
        onChipActive: "#141210",
        brand: "#B0237A",
        like: "#E8364C",
        star: "#8EC5F0",
        tabBar: "#0E0D0C",
        surface: "#E9E3DC",
      };
}

export type Palette = ReturnType<typeof usePalette>;

export function Screen({ children }: { children: ReactNode }) {
  const c = usePalette();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.screen}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const c = usePalette();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const c = usePalette();
  return <Text style={[styles.body, { color: muted ? c.muted : c.text }]}>{children}</Text>;
}

export function Field(props: TextInputProps & { label: string; error?: string | null }) {
  const c = usePalette();
  const { label, error, style, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={[
          styles.input,
          {
            color: c.text,
            borderColor: error ? c.danger : c.border,
            backgroundColor: c.card,
          },
          style,
        ]}
        {...input}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
    </View>
  );
}

export function Button(props: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  kind?: "primary" | "plain" | "danger";
}) {
  const c = usePalette();
  const kind = props.kind ?? "primary";
  const disabled = props.disabled || props.busy;
  const bg = kind === "primary" ? c.accent : kind === "danger" ? c.danger : c.chip;
  const fg = kind === "plain" ? c.text : kind === "danger" ? "#FFFFFF" : c.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!disabled, busy: !!props.busy }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{props.label}</Text>
      )}
    </Pressable>
  );
}

export function Checkbox(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string | null;
}) {
  const c = usePalette();
  return (
    <View style={styles.field}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={props.label}
        accessibilityState={{ checked: props.checked }}
        onPress={() => props.onChange(!props.checked)}
        style={styles.checkRow}
      >
        <View
          style={[
            styles.box,
            {
              borderColor: props.error ? c.danger : c.border,
              backgroundColor: props.checked ? c.accent : "transparent",
            },
          ]}
        >
          {props.checked ? <Text style={{ color: c.onAccent, fontWeight: "700" }}>✓</Text> : null}
        </View>
        <Text style={[styles.body, { color: c.text, flex: 1 }]}>{props.label}</Text>
      </Pressable>
      {props.error ? <Notice kind="error">{props.error}</Notice> : null}
    </View>
  );
}

export function Notice({ children, kind }: { children: ReactNode; kind: "error" | "info" }) {
  const c = usePalette();
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.body, { color: kind === "error" ? c.danger : c.muted }]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 16,
    flexGrow: 1,
  },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.3 },
  body: { fontSize: 16, lineHeight: 22 },
  field: { gap: 6 },
  label: { fontSize: 15, fontWeight: "600" },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  button: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 16, fontWeight: "700" },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
  },
  box: {
    width: 26,
    height: 26,
    borderWidth: 2,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
