/**
 * Invite friends with the phone's share sheet, or by copying the link.
 * Privacy-friendly: the link is just the website address, with no referral
 * code, tracking parameter or personal data.
 */
export type InviteResult = "shared" | "copied" | "cancelled" | "unavailable";

export const INVITE_TEXT = "I'm trying RentMate, a dating app that matches on what you love. Join me:";

export interface InviteEnv {
  share?: (data: ShareData) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

export function inviteUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/`;
}

export async function invite(url: string, env: InviteEnv): Promise<InviteResult> {
  if (env.share) {
    try {
      await env.share({ title: "RentMate", text: INVITE_TEXT, url });
      return "shared";
    } catch (e) {
      // Closing the share sheet is not an error worth reporting.
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
    }
  }
  if (env.writeText) {
    try {
      await env.writeText(url);
      return "copied";
    } catch {
      // Clipboard blocked: fall through and show the link to copy by hand.
    }
  }
  return "unavailable";
}

/** The browser's share sheet and clipboard, when available. */
export function browserInviteEnv(): InviteEnv {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    share: nav?.share ? (data) => nav.share(data) : undefined,
    writeText: nav?.clipboard?.writeText ? (t) => nav.clipboard.writeText(t) : undefined,
  };
}
