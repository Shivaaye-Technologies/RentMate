import { Stack } from "expo-router";
import { usePalette } from "../../../src/ui";

export default function BookingLayout() {
  const c = usePalette();
  return (
    <Stack
      screenOptions={{
        headerTitleAlign: "center",
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: "My bookings" }} />
      <Stack.Screen name="new/[companion]" options={{ title: "Request a booking" }} />
      <Stack.Screen name="[id]" options={{ title: "Booking" }} />
      <Stack.Screen name="chat/[id]" options={{ title: "Booking chat" }} />
    </Stack>
  );
}
