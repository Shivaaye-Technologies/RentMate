import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthScreen, PUBLIC_PAGES } from "./components/AuthScreen";

const publicDir = join(__dirname, "..", "public");

describe("public landing page (signed out)", () => {
  const html = renderToStaticMarkup(createElement(AuthScreen));

  it("lets visitors create an account or sign in without logging in first", () => {
    expect(html).toContain("Create account");
    expect(html).toContain("Sign in");
    expect(html).toMatch(/type="email"/);
    expect(html).toMatch(/type="password"/);
  });

  it("offers Demo Mode without signing up", () => {
    expect(html).toContain('href="#demo"');
    expect(html).toContain("Try Demo Mode");
    expect(html).toMatch(/fictional profiles with simulated likes, matches and chat/);
  });

  it("states the 18+ rule and links the legal pages", () => {
    expect(html).toContain("18 or older");
    for (const p of PUBLIC_PAGES) expect(html).toContain(`href="${p.href}"`);
  });

  it("shows no private data or dating features before sign-in", () => {
    expect(html).not.toMatch(/Discover|Likes|Chats|Messages/);
  });
});

describe("public information pages", () => {
  for (const p of PUBLIC_PAGES) {
    it(`${p.href} exists and needs no sign-in or keys`, () => {
      const page = readFileSync(join(publicDir, p.href), "utf8");
      expect(page).toMatch(/<title>[^<]+<\/title>/);
      expect(page).not.toMatch(/sb_publishable_|sb_secret_|service_role|eyJhbGci/i);
    });
  }
});
