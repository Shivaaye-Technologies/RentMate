// Register the native WebRTC globals before Expo Router loads any screens.
import { registerGlobals } from "@livekit/react-native";

registerGlobals();

import "expo-router/entry";
