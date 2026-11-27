import { Text, View } from "react-native";
import { usePalette } from "../ui";
import { Wordmark } from "./kit";

/** Sign-in / sign-up header: wordmark, a soft tile collage (no stock photos) and the one-line promise. */
export function AuthHero({ line }: { line: string }) {
  const c = usePalette();
  const tile = (bg: string, glyph: string, rotate: string, size = 92) => (
    <View
      style={{
        width: size,
        height: size * 1.2,
        borderRadius: 24,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate }],
        marginHorizontal: -6,
        borderWidth: 3,
        borderColor: c.card,
      }}
    >
      <Text style={{ fontSize: size * 0.42 }}>{glyph}</Text>
    </View>
  );
  return (
    <View style={{ gap: 18, alignItems: "center", paddingTop: 12 }}>
      <Wordmark size={46} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", height: 150 }}>
        {tile("#B6D6F2", "☕", "-8deg")}
        {tile("#DDBDE6", "🎶", "4deg", 104)}
        {tile("#F4A68C", "🏏", "10deg")}
      </View>
      <Text style={{ color: c.text, fontSize: 22, fontWeight: "700", textAlign: "center" }}>{line}</Text>
      <Text style={{ color: c.muted, textAlign: "center" }}>
        18+ only · meet in public places · report and block are always free
      </Text>
    </View>
  );
}
