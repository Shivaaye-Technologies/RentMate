/**
 * Public configuration compiled into the app. Only publishable values are allowed: the Supabase URL, the Supabase
 * publishable (anon) key and the RentMate API URL. A key whose JWT role is "service_role" (or that looks like a
 * secret key) is refused, so a misconfigured build fails at start instead of shipping a server secret.
 */
export type AppConfig = { supabaseUrl: string; supabaseKey: string; apiUrl: string };
export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] };

type Env = Record<string, string | undefined>;

function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = globalThis.atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

function httpsUrl(value: string | undefined, name: string, problems: string[], allowLocal: boolean): string {
  const v = (value ?? "").trim().replace(/\/+$/, "");
  if (!v) {
    problems.push(`${name} is not set`);
    return "";
  }
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    problems.push(`${name} is not a valid URL`);
    return "";
  }
  const local = /^(localhost|127\.0\.0\.1|10\.0\.2\.2)$/.test(url.hostname);
  if (url.protocol !== "https:" && !(allowLocal && local && url.protocol === "http:")) {
    problems.push(`${name} must use https`);
  }
  return v;
}

/** Reads and checks the public configuration. `dev` allows http://localhost-style URLs for the emulator. */
export function readConfig(env: Env, dev = false): ConfigResult {
  const problems: string[] = [];
  const supabaseUrl = httpsUrl(env.EXPO_PUBLIC_SUPABASE_URL, "EXPO_PUBLIC_SUPABASE_URL", problems, dev);
  const apiUrl = httpsUrl(env.EXPO_PUBLIC_API_URL, "EXPO_PUBLIC_API_URL", problems, dev);
  const supabaseKey = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseKey) problems.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is not set");
  else if (jwtRole(supabaseKey) === "service_role" || /^sb_secret_/.test(supabaseKey)) {
    problems.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is a server secret; use the publishable (anon) key");
  }
  return problems.length
    ? { ok: false, problems }
    : { ok: true, config: { supabaseUrl, supabaseKey, apiUrl } };
}
