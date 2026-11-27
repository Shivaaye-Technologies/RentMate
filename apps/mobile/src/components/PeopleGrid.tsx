import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { distanceText, type Person } from "../lib/people";
import { signedPhotoUrl } from "../lib/photos";
import { usePalette } from "../ui";

function Tile({ person, caption }: { person: Person; caption?: string }) {
  const c = usePalette();
  const router = useRouter();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void signedPhotoUrl(person.photoPath).then((u) => active && setUri(u));
    return () => {
      active = false;
    };
  }, [person.photoPath]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${person.displayName}, ${person.age}`}
      onPress={() => router.push({ pathname: "/(app)/user/[id]", params: { id: person.id } } as never)}
      style={{
        width: "48%",
        height: 230,
        borderRadius: 26,
        overflow: "hidden",
        backgroundColor: c.chipActive,
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: "100%", height: "100%" }} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: c.onChipActive, fontSize: 54, fontWeight: "900" }}>
            {person.displayName.slice(0, 1).toUpperCase()}
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
        }}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "800" }} numberOfLines={1}>
          {person.displayName}, {person.age}
        </Text>
        <Text style={{ color: "#F1ECE6", fontSize: 13 }} numberOfLines={1}>
          {caption ??
            (person.online ? "● Active now" : (distanceText(person.distanceKm) ?? person.details.city ?? ""))}
        </Text>
      </View>
    </Pressable>
  );
}

/** Two-column grid of people; each tile opens the profile. */
export function PeopleGrid({
  people,
  caption,
}: {
  people: Person[];
  caption?: (p: Person) => string | undefined;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {people.map((p) => (
        <Tile key={p.id} person={p} caption={caption?.(p)} />
      ))}
    </View>
  );
}
