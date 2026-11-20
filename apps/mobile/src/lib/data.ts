/**
 * The shared profile data layer (apps/web/src/shared/profileData.ts) bound to the Android Supabase client. Same rules
 * as the web: nothing here talks to the database differently.
 */
import { supabaseProfileDb, type ProfileDb } from "./shared";
import { supabase } from "./supabase";

export const profileDb: ProfileDb | null = supabase ? supabaseProfileDb(supabase) : null;
