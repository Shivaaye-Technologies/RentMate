import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

// Placeholders keep the module importable when env vars are missing;
// the app shows a configuration message instead of calling Supabase.
export const supabase = createClient(url || "http://localhost:54321", key || "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true },
});

export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from("photos").getPublicUrl(path).data.publicUrl;
}
