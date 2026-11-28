/** Supabase client for email/password and Google sign-in, and the app links that finish them. */
import * as Linking from "expo-linking";
import { AUTH_CALLBACK_PATH, AUTH_RESET_PATH, type AuthClient } from "./auth";
import { supabase } from "./supabase";

export const authClient: AuthClient | null = supabase;
/** rentmate://auth/callback (email confirmation and Google OAuth); a Supabase Auth redirect URL. */
export const callbackUrl = () => Linking.createURL(AUTH_CALLBACK_PATH);
/** rentmate://auth/reset (password reset emails); a Supabase Auth redirect URL. */
export const resetUrl = () => Linking.createURL(AUTH_RESET_PATH);
