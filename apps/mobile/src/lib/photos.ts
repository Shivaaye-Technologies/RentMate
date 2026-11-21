import { supabase } from "./supabase";

/** Private profile images are exposed only through short-lived signed URLs. */
export async function signedPhotoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path || !supabase) return null;
  const { data, error } = await supabase.storage.from("photos").createSignedUrl(path, 10 * 60);
  return error || !data ? null : data.signedUrl;
}
