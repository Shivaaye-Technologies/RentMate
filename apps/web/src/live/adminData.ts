import { apiBaseUrl } from "../api";
import { supabase } from "../supabase";

export interface ProviderRow {
  key: string;
  name: string;
  kind: "webrtc_sfu" | "white_label" | "affiliate";
  api_endpoint: string;
  credential_env: string | null;
  supported_countries: string[];
  permitted_categories: string[];
  commercial_use: boolean;
  monetisation: boolean;
  contract_status: "none" | "negotiating" | "signed" | "expired" | "terminated";
  contract_reference: string | null;
  terms_authorize_model: boolean;
  terms_reviewed_at: string | null;
  integration_status: "disabled" | "testing" | "enabled";
  notes: string | null;
}

export interface AdminCreator {
  user_id: string;
  stage_name: string;
  country_code: string;
  categories: string[];
  status: string;
  agreement_version: string | null;
  revenue_share_pct: number | null;
  identity_verified: boolean;
  age_verified: boolean;
  status_reason: string | null;
  created_at: string;
}

export interface AdminStreamRow {
  id: string;
  stage_name: string;
  title: string;
  category: string;
  explicit: boolean;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  problems: string[];
}

export interface ReportRow {
  id: string;
  reason: string;
  details: string;
  priority: "normal" | "urgent";
  status: string;
  stream_id: string | null;
  session_id: string | null;
  creator_id: string | null;
  created_at: string;
  handling_note: string | null;
}

export interface CountryPolicy {
  country_code: string;
  live_allowed: boolean;
  private_sessions_allowed: boolean;
  explicit_allowed: boolean;
  legal_clearance_ref: string | null;
  notes: string | null;
}

export interface LogRow {
  id: number;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface TicketRow {
  id: string;
  creator_id: string;
  subject: string;
  body: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
}

export interface AppealRow {
  id: string;
  creator_id: string;
  statement: string;
  status: string;
  created_at: string;
}

export interface HealthRow {
  streamId: string;
  status: "ok" | "no_broadcaster" | "provider_unreachable" | "provider_missing" | "policy_problem";
  viewers: number | null;
  problems: string[];
  title: string;
  stageName: string;
}

/** Friendly message for a database error, without internals. */
export function adminError(e: { code?: string; message?: string }): string {
  if (e.code === "42501") return "You don't have permission to do that.";
  if (e.code === "23514")
    return "That isn't allowed by the platform rules (check the highlighted requirements).";
  if (e.code === "22023") return e.message ?? "That request isn't valid.";
  return e.message ?? "Something went wrong.";
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(adminError(error));
  return data as T;
}

/** Calls the API (live moderation needs the server to talk to the streaming provider). */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/v1/live${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new Error("Can't reach the SOULMATE.AI server. Try again in a moment.");
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `The server returned an error (${res.status}).`);
  return body as T;
}

export const adminApi = {
  roles: () => rpc<string[]>("my_live_roles"),
  providers: () => rpc<ProviderRow[]>("admin_list_providers"),
  providerStatus: () => api<{ providers: { key: string; configured: boolean }[] }>("/admin/providers"),
  saveProvider: (p: ProviderRow, termsReviewed: boolean) =>
    rpc<void>("admin_upsert_provider", {
      p_key: p.key,
      p_name: p.name,
      p_kind: p.kind,
      p_api_endpoint: p.api_endpoint,
      p_credential_env: p.credential_env || null,
      p_supported_countries: p.supported_countries,
      p_permitted_categories: p.permitted_categories,
      p_commercial_use: p.commercial_use,
      p_monetisation: p.monetisation,
      p_contract_status: p.contract_status,
      p_contract_reference: p.contract_reference || null,
      p_terms_authorize_model: p.terms_authorize_model,
      p_terms_reviewed: termsReviewed,
      p_integration_status: p.integration_status,
      p_notes: p.notes || null,
    }),
  creators: () => rpc<AdminCreator[]>("admin_list_creators"),
  review: (user: string, status: string, reason: string) =>
    rpc<void>("admin_review_creator", { p_user: user, p_status: status, p_reason: reason || null }),
  recordVerification: (
    user: string,
    v: {
      kind: "identity" | "age";
      provider: string;
      reference: string;
      status: string;
      country: string;
      over18: boolean;
    },
  ) =>
    rpc<void>("admin_record_verification", {
      p_user: user,
      p_kind: v.kind,
      p_provider: v.provider,
      p_reference: v.reference,
      p_status: v.status,
      p_country: v.country || null,
      p_over_18: v.kind === "age" ? v.over18 : null,
      p_expires_at: null,
    }),
  recordViewerAge: (
    user: string,
    provider: string,
    reference: string,
    status: string,
    country: string,
    over18: boolean,
  ) =>
    rpc<void>("admin_record_viewer_age", {
      p_user: user,
      p_provider: provider,
      p_reference: reference,
      p_status: status,
      p_country: country || null,
      p_over_18: over18,
    }),
  revenueShare: (user: string, pct: number) =>
    rpc<void>("admin_set_revenue_share", { p_user: user, p_pct: pct }),
  setAgreement: (version: string, title: string, url: string, activate: boolean) =>
    rpc<void>("admin_set_agreement", {
      p_version: version,
      p_title: title,
      p_url: url,
      p_activate: activate,
    }),
  streams: () => rpc<AdminStreamRow[]>("admin_list_streams"),
  health: () => api<{ checkedAt: string; streams: HealthRow[] }>("/admin/health"),
  terminate: (streamId: string, reason: string) =>
    api<{ terminated: boolean; roomClosed: boolean }>(`/streams/${streamId}/terminate`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  emergencyStop: (on: boolean, reason: string) =>
    api<{ emergencyStop: boolean; roomsClosed: number; roomsFailed: string[] }>("/emergency-stop", {
      method: "POST",
      body: JSON.stringify({ on, reason }),
    }),
  settings: async () => {
    const { data, error } = await supabase
      .from("live_settings")
      .select("emergency_stop, emergency_reason, updated_at")
      .single();
    if (error) throw new Error(adminError(error));
    return data as { emergency_stop: boolean; emergency_reason: string | null; updated_at: string };
  },
  reports: () => rpc<ReportRow[]>("admin_list_reports"),
  resolveReport: (id: string, status: "actioned" | "dismissed", note: string) =>
    rpc<void>("admin_resolve_report", { p_report: id, p_status: status, p_note: note || null }),
  policies: async () => {
    const { data, error } = await supabase.from("country_policies").select("*").order("country_code");
    if (error) throw new Error(adminError(error));
    return (data ?? []) as CountryPolicy[];
  },
  savePolicy: (p: CountryPolicy) =>
    rpc<void>("admin_set_country_policy", {
      p_country: p.country_code,
      p_live: p.live_allowed,
      p_private: p.private_sessions_allowed,
      p_explicit: p.explicit_allowed,
      p_clearance_ref: p.legal_clearance_ref || null,
      p_notes: p.notes || null,
    }),
  log: () => rpc<LogRow[]>("admin_moderation_log", { p_limit: 200 }),
  tickets: () => rpc<TicketRow[]>("admin_list_tickets"),
  replyTicket: (id: string, reply: string, close: boolean) =>
    rpc<void>("admin_reply_ticket", { p_ticket: id, p_reply: reply, p_close: close }),
  appeals: () => rpc<AppealRow[]>("admin_list_appeals"),
  decideAppeal: (id: string, overturn: boolean, note: string) =>
    rpc<void>("admin_decide_appeal", { p_appeal: id, p_overturn: overturn, p_note: note || null }),
  setRole: (user: string, role: "admin" | "moderator", grant: boolean) =>
    rpc<void>("admin_set_role", { p_user: user, p_role: role, p_grant: grant }),
};

/** What blocks a provider from being enabled (mirrors the database rule). */
export function providerBlockers(p: ProviderRow, termsReviewed: boolean): string[] {
  const out: string[] = [];
  if (p.integration_status === "enabled") {
    if (p.contract_status !== "signed") out.push("The contract must be signed.");
    if (!p.contract_reference?.trim()) out.push("Add the contract reference.");
    if (!p.terms_authorize_model) out.push("Confirm the written terms authorise our business model.");
    if (!p.commercial_use) out.push("The terms must permit commercial use.");
    if (!termsReviewed && !p.terms_reviewed_at) out.push("Mark the terms as reviewed.");
  }
  if (p.integration_status === "testing") {
    if (p.contract_status !== "negotiating" && p.contract_status !== "signed") {
      out.push("Testing needs a contract under negotiation or signed.");
    }
    if (!termsReviewed && !p.terms_reviewed_at) out.push("Mark the terms as reviewed.");
  }
  if (!/^(https|wss):\/\/\S+$/.test(p.api_endpoint))
    out.push("The endpoint must start with https:// or wss://.");
  if (p.credential_env && !/^[A-Z][A-Z0-9_]{2,40}$/.test(p.credential_env)) {
    out.push("Credential setting must be an environment variable name like LIVEKIT, not a secret.");
  }
  return out;
}

/** What blocks a country policy (mirrors the database rule). */
export function policyBlockers(p: CountryPolicy): string[] {
  const out: string[] = [];
  if (!/^[A-Z]{2}$/.test(p.country_code)) out.push("Use a two-letter country code.");
  if (p.explicit_allowed && p.country_code === "IN") out.push("Adult content can't be enabled for India.");
  if (p.explicit_allowed && !p.legal_clearance_ref?.trim()) {
    out.push("Adult content needs a reference to the written legal clearance for this country.");
  }
  return out;
}

/** Comma/space separated country codes, upper-cased and checked. */
export function parseCountries(text: string): { codes: string[]; bad: string[] } {
  const parts = text
    .split(/[\s,]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  return {
    codes: [...new Set(parts.filter((x) => /^[A-Z]{2}$/.test(x)))],
    bad: parts.filter((x) => !/^[A-Z]{2}$/.test(x)),
  };
}
