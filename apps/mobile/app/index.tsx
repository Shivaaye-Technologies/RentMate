import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../src/session";
import { usePalette } from "../src/ui";

/** Splash: waits for the stored session, then sends the member to sign-in or into the app. */
export default function Index() {
  const { ready, session } = useSession();
  const c = usePalette();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}>
        <ActivityIndicator accessibilityLabel="Loading RentMate" color={c.accent} size="large" />
      </View>
    );
  }
  return <Redirect href={session ? "/home" : "/sign-in"} />;
}
