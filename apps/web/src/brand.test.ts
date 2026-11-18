import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthScreen } from "./components/AuthScreen";
import { BRAND } from "./brand";

const root = join(__dirname, "..");
const landing = renderToStaticMarkup(createElement(AuthScreen));

describe("RentMate brand", () => {
  it("names the product and tagline on the landing page", () => {
    expect(BRAND.name).toBe("RentMate");
    expect(landing).toContain("RentMate");
    expect(landing).toContain("Meet. Connect. Experience.");
    expect(landing).toMatch(/class="monogram"[^>]*>RM</);
  });

  it("states the safety rules and does not offer unbuilt features as available", () => {
    expect(landing).toContain("No sexual services of any kind");
    expect(landing).toContain("18+ only");
    // Physical and hybrid are shown as in development, never as bookable.
    expect(landing.match(/In development/g)?.length).toBe(2);
    expect(landing).not.toMatch(/Book now|Buy tokens|Withdraw/i);
  });

  it("leaves no old brand name in the shell, favicon or public pages", () => {
    const files = [
      "index.html",
      "public/privacy.html",
      "public/terms.html",
      "public/safety.html",
      "public/delete-account.html",
    ];
    for (const f of files) expect(readFileSync(join(root, f), "utf8")).not.toMatch(/SOULMATE/i);
    expect(readFileSync(join(root, "public/favicon.svg"), "utf8")).toContain(">RM<");
  });

  it("uses the dark champagne-gold design tokens", () => {
    const css = readFileSync(join(__dirname, "styles.css"), "utf8");
    expect(css).toMatch(/--bg: #0b0a09/);
    expect(css).toMatch(/--gold: #d4b26a/);
    expect(css).toMatch(/color-scheme: dark/);
  });
});
