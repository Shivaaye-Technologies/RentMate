/**
 * Redacted, in-memory diagnostics for device testing (Profile → Diagnostics). Records what happened, never secrets:
 * no tokens, keys, emails, message bodies or coordinates. Values are reduced to a short allow-listed shape and any
 * string that looks like a credential is replaced before it is stored.
 */
export type DiagEvent = {
  at: string;
  area: DiagArea;
  event: string;
  detail?: Record<string, string | number | boolean>;
};
export type DiagArea = "auth" | "api" | "db" | "feed" | "chat";

const MAX = 80;
const events: DiagEvent[] = [];
const listeners = new Set<() => void>();

// JWTs, bearer headers, Supabase keys (sb_…, eyJ…), long hex/base64 runs and email addresses.
const SECRETISH =
  /(bearer\s+\S+|eyJ[\w-]+\.[\w-]+(\.[\w-]+)?|sb_(publishable|secret)_\w+|[A-Za-z0-9+/_-]{32,}|[^\s@]+@[^\s@]+\.[^\s@]+)/gi;

export function redact(value: string): string {
  return value.replace(SECRETISH, "[redacted]").slice(0, 160);
}

export function record(area: DiagArea, event: string, detail?: Record<string, unknown>): void {
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (/token|key|secret|password|authorization|email|body|lat|lng/i.test(k)) continue;
    if (typeof v === "number" || typeof v === "boolean") clean[k] = v;
    else if (typeof v === "string") clean[k] = redact(v);
  }
  events.push({ at: new Date().toISOString(), area, event: redact(event), detail: clean });
  if (events.length > MAX) events.splice(0, events.length - MAX);
  for (const l of listeners) l();
}

export const diagnostics = (): readonly DiagEvent[] => events.slice();
export const clearDiagnostics = () => {
  events.length = 0;
  for (const l of listeners) l();
};
export function onDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One line per event, safe to copy into a bug report. */
export const diagnosticsText = () =>
  events
    .map(
      (e) =>
        `${e.at} ${e.area} ${e.event}${e.detail && Object.keys(e.detail).length ? " " + JSON.stringify(e.detail) : ""}`,
    )
    .join("\n");

/** Shape of a Supabase/PostgREST error, without its message text (which can quote data). */
export function dbFailure(table: string, error: { code?: string; message?: string } | null | undefined) {
  if (!error) return;
  const permission = error.code === "42501" || /permission denied/i.test(error.message ?? "");
  record("db", permission ? "permission denied" : "query failed", { table, code: error.code ?? "unknown" });
}
