/**
 * Small accessible building blocks. Touch targets are at least 48 dp, text scales with the system
 * font size, and colours follow the system light/dark setting.
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

export function usePalette() {
  const dark = useColorScheme() === "dark";
  return dark
    ? {
        bg: "#121212",
        text: "#F4F4F5",
        muted: "#A1A1AA",
        card: "#1E1E22",
        border: "#3F3F46",
        accent: "#F472B6",
        danger: "#F87171",
        onAccent: "#1A1A1A",
      }
    : {
        bg: "#FFFFFF",
        text: "#18181B",
        muted: "#52525B",
        card: "#F4F4F5",
        border: "#D4D4D8",
        accent: "#BE185D",
        danger: "#B91C1C",
        onAccent: "#FFFFFF",
      };
}

export function Screen({ children }: { children: ReactNode }) {
  const c = usePalette();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.bg }}
      edges={["top", "bottom", "left", "right"]}
    >
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

export function Body({
  children,
  muted,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  const c = usePalette();
  return (
    <Text style={[styles.body, { color: muted ? c.muted : c.text }]}>
      {children}
    </Text>
  );
}

export function Field(
  props: TextInputProps & { label: string; error?: string | null },
) {
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
  const bg =
    kind === "primary" ? c.accent : kind === "danger" ? c.danger : "transparent";
  const fg = kind === "plain" ? c.accent : c.onAccent;
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
          {props.checked ? (
            <Text style={{ color: c.onAccent, fontWeight: "700" }}>✓</Text>
          ) : null}
        </View>
        <Text style={[styles.body, { color: c.text, flex: 1 }]}>
          {props.label}
        </Text>
      </Pressable>
      {props.error ? <Notice kind="error">{props.error}</Notice> : null}
    </View>
  );
}

export function Notice({
  children,
  kind,
}: {
  children: ReactNode;
  kind: "error" | "info";
}) {
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
  title: { fontSize: 26, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 22 },
  field: { gap: 6 },
  label: { fontSize: 15, fontWeight: "600" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderRadius: 10,
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
