/** The Android Supabase client as the auth flows' client, plus the app-link URLs for email links. */
import * as Linking from "expo-linking";
import { AUTH_CALLBACK_PATH, AUTH_RESET_PATH, type AuthClient } from "./auth";
import { supabase } from "./supabase";

export const authClient: AuthClient | null = supabase;
/** rentmate://auth/callback (release builds); development builds use their own scheme automatically. */
export const callbackUrl = () => Linking.createURL(AUTH_CALLBACK_PATH);
export const resetUrl = () => Linking.createURL(AUTH_RESET_PATH);
