import { supabase } from "../supabase";

/** From public.my_security_status(): the database decides; this only drives the screens. */
export interface SecurityStatus {
  privileged: boolean;
  mfa_required: boolean;
  aal: string;
  has_factor: boolean;
  recovery_codes_left: number;
  recovery_until: string | null;
  mfa_ok: boolean;
}

export type Gate = "pass" | "enroll" | "challenge";

/**
 * What an admin page shows first. Members without a role pass through (the database refuses admin actions anyway).
 * When MFA is required: no factor yet → enrol; factor but a password-only session → verify with the app.
 */
export function decideGate(s: SecurityStatus | null): Gate {
  if (!s || !s.privileged || s.mfa_ok) return "pass";
  return s.has_factor ? "challenge" : "enroll";
}

/**
 * Recovery codes look like ABCD-1234-EF56-7890-ABCD (case, spaces and dashes do not matter). Older 12-digit codes
 * (ABCD-1234-EF56) are still accepted. The server normalises the same way.
 */
export function normaliseRecoveryCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^0-9A-F]/g, "");
  if (compact.length !== 20 && compact.length !== 12) return input.trim();
  return compact.match(/.{4}/g)!.join("-");
}

export const SIX_DIGITS = /^\d{6}$/;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const mfaApi = {
  status: () => rpc<SecurityStatus>("my_security_status"),
  async enroll() {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `RentMate ${new Date().toISOString().slice(0, 10)}`,
    });
    if (error) throw new Error(error.message);
    return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  },
  async verify(factorId: string, code: string) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new Error(error.message);
  },
  async firstVerifiedFactor(): Promise<string | null> {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw new Error(error.message);
    return data.totp.find((f) => f.status === "verified")?.id ?? null;
  },
  generateRecoveryCodes: () => rpc<string[]>("mfa_generate_recovery_codes"),
  useRecoveryCode: (code: string) =>
    rpc<"ok" | "invalid" | "locked">("mfa_use_recovery_code", { p_code: normaliseRecoveryCode(code) }),
  setRequired: (on: boolean) => rpc<void>("admin_set_mfa_required", { p_on: on }),
  readiness: () => rpc<{ user_id: string; roles: string[]; has_factor: boolean }[]>("admin_mfa_readiness"),
};
