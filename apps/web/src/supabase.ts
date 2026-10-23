import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

// Placeholders keep the module importable when env vars are missing;
// the app shows a configuration message instead of calling Supabase.
export const supabase = createClient(url || "http://localhost:54321", key || "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Signed links last an hour; refresh them a few minutes early. */
export const SIGNED_URL_SECONDS = 60 * 60;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type CacheEntry = { url: string; expiresAt: number } | Promise<string | null>;
const cache = new Map<string, CacheEntry>();

/**
 * Photos are private: only signed-in users can read them, through short-lived
 * signed links (and never photos of someone in a block with them).
 */
export async function signedPhotoUrl(
  path: string | null | undefined,
  now = Date.now,
): Promise<string | null> {
  if (!path) return null;
  const hit = cache.get(path);
  if (hit instanceof Promise) return hit;
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > now()) return hit.url;

  const request = supabase.storage
    .from("photos")
    .createSignedUrl(path, SIGNED_URL_SECONDS)
    .then(({ data, error }) => {
      if (error || !data) {
        cache.delete(path);
        return null;
      }
      cache.set(path, { url: data.signedUrl, expiresAt: now() + SIGNED_URL_SECONDS * 1000 });
      return data.signedUrl;
    })
    .catch(() => {
      cache.delete(path);
      return null;
    });
  cache.set(path, request);
  return request;
}

/** Forget cached links (for example after sign-out). */
export function clearPhotoCache() {
  cache.clear();
}
