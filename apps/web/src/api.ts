export type HealthState = "checking" | "online" | "offline";

/** Base URL of the API. Set VITE_API_URL at build time; defaults to local dev. */
export function apiBaseUrl(envUrl: string | undefined = import.meta.env.VITE_API_URL): string {
  const url = (envUrl ?? "").trim() || "http://localhost:4000";
  return url.replace(/\/+$/, "");
}

export async function checkHealth(fetchFn: typeof fetch = fetch, base = apiBaseUrl()): Promise<HealthState> {
  try {
    const res = await fetchFn(`${base}/health`);
    if (!res.ok) return "offline";
    const body = (await res.json()) as { status?: string };
    return body.status === "ok" ? "online" : "offline";
  } catch {
    return "offline";
  }
}
