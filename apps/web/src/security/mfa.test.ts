import { describe, expect, it } from "vitest";
import { decideGate, normaliseRecoveryCode, SIX_DIGITS, type SecurityStatus } from "./mfa";

const base: SecurityStatus = {
  privileged: true,
  mfa_required: true,
  aal: "aal1",
  has_factor: false,
  recovery_codes_left: 0,
  recovery_until: null,
  mfa_ok: false,
};

describe("admin MFA gate", () => {
  it("lets members without a role and satisfied sessions through", () => {
    expect(decideGate(null)).toBe("pass");
    expect(decideGate({ ...base, privileged: false })).toBe("pass");
    expect(decideGate({ ...base, mfa_ok: true })).toBe("pass");
    expect(decideGate({ ...base, mfa_required: false, mfa_ok: true })).toBe("pass");
  });
  it("asks for enrolment when there is no factor, and a code when there is", () => {
    expect(decideGate(base)).toBe("enroll");
    expect(decideGate({ ...base, has_factor: true })).toBe("challenge");
  });
});

describe("recovery codes", () => {
  it("accept any case, spaces or missing dashes", () => {
    expect(normaliseRecoveryCode("abcd 1234 ef56")).toBe("ABCD-1234-EF56");
    expect(normaliseRecoveryCode("ABCD1234EF56")).toBe("ABCD-1234-EF56");
    expect(normaliseRecoveryCode("abcd-1234-ef56")).toBe("ABCD-1234-EF56");
    expect(normaliseRecoveryCode("short")).toBe("short");
    expect(normaliseRecoveryCode("abcd 1234 ef56 7890 abcd")).toBe("ABCD-1234-EF56-7890-ABCD");
    expect(normaliseRecoveryCode("ABCD1234EF567890ABCD")).toBe("ABCD-1234-EF56-7890-ABCD");
    expect(normaliseRecoveryCode("abcd-1234-ef56-7890-abc")).toBe("abcd-1234-ef56-7890-abc");
  });
  it("authenticator codes are exactly six digits", () => {
    expect(SIX_DIGITS.test("123456")).toBe(true);
    expect(SIX_DIGITS.test("12345")).toBe(false);
    expect(SIX_DIGITS.test("12a456")).toBe(false);
  });
});
