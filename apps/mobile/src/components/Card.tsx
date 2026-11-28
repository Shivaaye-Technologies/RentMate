import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { usePalette } from "../ui";

/** A bordered card; pressable when onPress is given. */
export function Card({
  children,
  onPress,
  label,
}: {
  children: ReactNode;
  onPress?: () => void;
  label?: string;
}) {
  const c = usePalette();
  const style = {
    padding: 16,
    borderRadius: 18,
    backgroundColor: c.card,
    borderColor: c.border,
    borderWidth: 1,
    gap: 6,
  } as const;
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={style}>
      {children}
    </Pressable>
  );
}

/** A row of selectable chips (single choice). */
export function Chips<T extends string | number>(props: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const c = usePalette();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {props.options.map((o) => {
        const on = o.value === props.value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => props.onChange(o.value)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on ? c.accent : c.border,
              backgroundColor: on ? c.accent : "transparent",
            }}
          >
            <TextLabel on={on}>{o.label}</TextLabel>
          </Pressable>
        );
      })}
    </View>
  );
}

function TextLabel({ children, on }: { children: ReactNode; on: boolean }) {
  const c = usePalette();
  return <Text style={{ color: on ? c.onAccent : c.text, fontWeight: "600" }}>{children}</Text>;
}
