import { describe, expect, it } from "vitest";
import {
  classifyAuthError,
  cooldownLeft,
  emailProblem,
  hasAuthParams,
  looksLikeExistingAccount,
  parseAuthRedirect,
  passwordProblem,
} from "./auth";

describe("classifyAuthError", () => {
  it("tells an unconfirmed email apart from wrong credentials", () => {
    expect(
      classifyAuthError({ code: "email_not_confirmed", status: 400, message: "Email not confirmed" }).kind,
    ).toBe("email_not_confirmed");
    expect(
      classifyAuthError({ code: "invalid_credentials", status: 400, message: "Invalid login credentials" })
        .kind,
    ).toBe("invalid_credentials");
  });

  it("explains the email sending limit separately from general rate limits", () => {
    const email = classifyAuthError({
      code: "over_email_send_rate_limit",
      status: 429,
      message: "email rate limit exceeded",
    });
    expect(email.kind).toBe("email_rate_limited");
    expect(email.message).toMatch(/newest email/);
    const general = classifyAuthError({
      status: 429,
      message: "For security purposes, you can only request this after 42 seconds.",
    });
    expect(general.kind).toBe("rate_limited");
  });

  it("handles expired links, weak passwords, existing accounts and network failures", () => {
    expect(classifyAuthError({ code: "otp_expired" }).kind).toBe("link_expired");
    expect(classifyAuthError({ code: "weak_password", message: "Password should be at least 8" }).kind).toBe(
      "weak_password",
    );
    expect(classifyAuthError({ code: "user_already_exists" }).kind).toBe("already_registered");
    expect(classifyAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }).kind).toBe(
      "network",
    );
    expect(classifyAuthError({ message: "something odd" }).kind).toBe("unknown");
  });

  it("never echoes raw server text", () => {
    expect(classifyAuthError({ message: "<script>x</script>" }).message).not.toContain("<script>");
  });
});

describe("passwordProblem / emailProblem", () => {
  it("requires 8+ characters with letters and numbers", () => {
    expect(passwordProblem("short1")).toMatch(/8/);
    expect(passwordProblem("lettersonly")).toMatch(/letters and numbers/);
    expect(passwordProblem("12345678")).toMatch(/letters and numbers/);
    expect(passwordProblem("goodpass9")).toBeNull();
    expect(passwordProblem("a1".repeat(40))).toMatch(/72/);
  });

  it("checks the email shape", () => {
    expect(emailProblem("")).toMatch(/Enter your email/);
    expect(emailProblem("not-an-email")).toMatch(/valid/);
    expect(emailProblem(" me@example.com ")).toBeNull();
  });
});

describe("email links", () => {
  it("reads an expired confirmation link from the hash", () => {
    const r = parseAuthRedirect(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      "",
    );
    expect(r.problem?.kind).toBe("link_expired");
  });

  it("recognises a password recovery link", () => {
    const r = parseAuthRedirect("#access_token=abc&type=recovery", "");
    expect(r).toEqual({ type: "recovery", problem: null });
    expect(hasAuthParams("#access_token=abc&type=recovery", "")).toBe(true);
    expect(hasAuthParams("#demo", "")).toBe(false);
  });

  it("detects a sign-up for an email that already has an account", () => {
    expect(looksLikeExistingAccount({ identities: [] })).toBe(true);
    expect(looksLikeExistingAccount({ identities: [{}] })).toBe(false);
    expect(looksLikeExistingAccount(null)).toBe(false);
  });
});

describe("cooldownLeft", () => {
  it("counts down from the last email", () => {
    expect(cooldownLeft(null, 1000)).toBe(0);
    expect(cooldownLeft(0 + 1, 1 + 15_000)).toBe(45);
    expect(cooldownLeft(1, 1 + 61_000)).toBe(0);
    // A clock that hasn't caught up never shows more than the full cooldown.
    expect(cooldownLeft(10_000, 0)).toBe(60);
  });
});
