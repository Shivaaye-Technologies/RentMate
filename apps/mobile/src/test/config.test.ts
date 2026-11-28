import { describe, expect, it } from "vitest";
import { readConfig } from "../lib/config";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) => `${b64({ alg: "HS256" })}.${b64({ role, iss: "supabase" })}.sig`;
const good = {
  EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
  EXPO_PUBLIC_API_URL: "https://api.example.onrender.com/",
};

describe("readConfig (public values only)", () => {
  it("accepts the publishable key and https URLs, trimming trailing slashes", () => {
    const r = readConfig(good);
    expect(r).toEqual({
      ok: true,
      config: {
        supabaseUrl: "https://abc.supabase.co",
        supabaseKey: good.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        apiUrl: "https://api.example.onrender.com",
      },
    });
  });

  it("refuses a service_role key so a server secret can never ship in the app", () => {
    const r = readConfig({ ...good, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join()).toMatch(/server secret/);
  });

  it("refuses a new-style secret key", () => {
    expect(readConfig({ ...good, EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abc123" }).ok).toBe(false);
  });

  it("accepts a new-style publishable key", () => {
    expect(readConfig({ ...good, EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc123" }).ok).toBe(true);
  });

  it("reports every missing value", () => {
    const r = readConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toHaveLength(3);
  });

  it("requires https, except local addresses in development builds", () => {
    expect(readConfig({ ...good, EXPO_PUBLIC_API_URL: "http://api.example.com" }).ok).toBe(false);
    expect(readConfig({ ...good, EXPO_PUBLIC_API_URL: "http://10.0.2.2:4000" }).ok).toBe(false);
    expect(readConfig({ ...good, EXPO_PUBLIC_API_URL: "http://10.0.2.2:4000" }, true).ok).toBe(true);
    expect(readConfig({ ...good, EXPO_PUBLIC_API_URL: "http://api.example.com" }, true).ok).toBe(false);
  });
});
