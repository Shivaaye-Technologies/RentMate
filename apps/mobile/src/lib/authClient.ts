/** Supabase client for Google OAuth and the app-link callback. */
import * as Linking from "expo-linking";
import { AUTH_CALLBACK_PATH, type AuthClient } from "./auth";
import { supabase } from "./supabase";

export const authClient: AuthClient | null = supabase;
/** rentmate://auth/callback; registered as a Supabase Auth redirect URL. */
export const callbackUrl = () => Linking.createURL(AUTH_CALLBACK_PATH);
