import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminConsole, ProviderForm } from "./AdminConsole";
import { adminError, parseCountries, policyBlockers, providerBlockers, type ProviderRow } from "./adminData";

const provider: ProviderRow = {
  key: "livekit",
  name: "LiveKit",
  kind: "webrtc_sfu",
  api_endpoint: "wss://x.livekit.cloud",
  credential_env: "LIVEKIT",
  supported_countries: [],
  permitted_categories: ["talk"],
  commercial_use: false,
  monetisation: false,
  contract_status: "negotiating",
  contract_reference: null,
  terms_authorize_model: false,
  terms_reviewed_at: null,
  integration_status: "enabled",
  notes: null,
};

describe("provider rules (mirror the database)", () => {
  it("lists everything missing before a provider can be enabled", () => {
    expect(providerBlockers(provider, false)).toEqual([
      "The contract must be signed.",
      "Add the contract reference.",
      "Confirm the written terms authorise our business model.",
      "The terms must permit commercial use.",
      "Mark the terms as reviewed.",
    ]);
    const ok = {
      ...provider,
      contract_status: "signed" as const,
      contract_reference: "C-1",
      terms_authorize_model: true,
      commercial_use: true,
    };
    expect(providerBlockers(ok, true)).toEqual([]);
  });

  it("rejects insecure endpoints and secrets typed into the credential name", () => {
    const p = {
      ...provider,
      integration_status: "disabled" as const,
      api_endpoint: "http://x",
      credential_env: "sk_live_abc123",
    };
    expect(providerBlockers(p, false)).toEqual([
      "The endpoint must start with https:// or wss://.",
      "Credential setting must be an environment variable name like LIVEKIT, not a secret.",
    ]);
  });
});

describe("country policy rules", () => {
  const base = {
    country_code: "GB",
    live_allowed: true,
    private_sessions_allowed: true,
    explicit_allowed: false,
    legal_clearance_ref: null,
    notes: null,
  };
  it("never allows adult content in India and needs clearance elsewhere", () => {
    expect(
      policyBlockers({ ...base, country_code: "IN", explicit_allowed: true, legal_clearance_ref: "x" }),
    ).toContain("Adult content can't be enabled for India.");
    expect(policyBlockers({ ...base, explicit_allowed: true })).toContain(
      "Adult content needs a reference to the written legal clearance for this country.",
    );
    expect(policyBlockers({ ...base, explicit_allowed: true, legal_clearance_ref: "Opinion LO-7" })).toEqual(
      [],
    );
    expect(policyBlockers({ ...base, country_code: "GBR" })).toContain("Use a two-letter country code.");
  });

  it("parses country lists", () => {
    expect(parseCountries("in, gb us,  IN")).toEqual({ codes: ["IN", "GB", "US"], bad: [] });
    expect(parseCountries("India, US").bad).toEqual(["INDIA"]);
  });

  it("explains permission errors plainly", () => {
    expect(adminError({ code: "42501", message: "This needs the admin role" })).toBe(
      "You don't have permission to do that.",
    );
    expect(adminError({ code: "23514", message: "violates check constraint" })).toMatch(/platform rules/);
  });
});

describe("admin screens", () => {
  it("warns never to type secrets and shows whether the server has credentials", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderForm, { initial: provider, configured: false, onSaved: async () => undefined }),
    );
    expect(html).toContain("Never type an API key or secret here");
    expect(html).toContain("not set on the server");
    expect(html).toContain("Written terms authorise our business model");
    expect(html).toContain("The contract must be signed.");
  });

  it("starts by checking the member's role", () => {
    const html = renderToStaticMarkup(createElement(AdminConsole, { onExit: () => undefined }));
    expect(html).toContain("SOULMATE LIVE · Admin");
    expect(html).toContain("spinner");
  });
});
