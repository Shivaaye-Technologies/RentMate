import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDiagnostics,
  dbFailure,
  diagnostics,
  diagnosticsText,
  record,
  redact,
} from "../lib/diagnostics";

beforeEach(clearDiagnostics);

describe("diagnostics", () => {
  it("redacts JWTs, bearer headers, Supabase keys and emails", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl";
    expect(redact(`Bearer ${jwt}`)).not.toContain(jwt);
    expect(redact(jwt)).toBe("[redacted]");
    expect(redact("sb_publishable_abcDEF123")).toBe("[redacted]");
    expect(redact("from member@example.com")).toBe("from [redacted]");
  });

  it("redacts identifiers inside API paths (e.g. a call id)", () => {
    record("api", "failed", { path: "/api/v1/calls/3f2b8c1e-9d4a-4b7e-8f21-0c9e5a7d6b12/join", status: 500 });
    expect(diagnosticsText()).not.toContain("3f2b8c1e");
  });

  it("drops sensitive fields entirely and keeps counts and status codes", () => {
    record("api", "ok", {
      path: "/api/v1/matches",
      status: 200,
      access_token: "x",
      email: "a@b.c",
      lat: 12.97,
      count: 3,
    });
    const [e] = diagnostics();
    expect(e.detail).toEqual({ path: "/api/v1/matches", status: 200, count: 3 });
  });

  it("records a permission failure by table and code, without the database message", () => {
    dbFailure("likes", { code: "42501", message: "permission denied for table likes" });
    dbFailure("bookings", null);
    const text = diagnosticsText();
    expect(text).toContain("permission denied");
    expect(text).toContain('"table":"likes"');
    expect(text).toContain('"code":"42501"');
    expect(diagnostics()).toHaveLength(1);
  });

  it("keeps only the most recent events", () => {
    for (let i = 0; i < 200; i++) record("feed", "loaded", { count: i });
    expect(diagnostics()).toHaveLength(80);
    expect(diagnostics().at(-1)?.detail).toEqual({ count: 199 });
  });
});
