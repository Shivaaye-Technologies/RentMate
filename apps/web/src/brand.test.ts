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
    // Physical companionship takes booking requests (no payments); hybrid is still in development.
    expect(landing).toContain("Booking requests available");
    expect(landing.match(/In development/g)?.length).toBe(1);
    expect(landing).not.toMatch(/Buy tokens|Withdraw|Pay now/i);
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

  it("has light and dark themes and no gold", () => {
    const css = readFileSync(join(__dirname, "styles.css"), "utf8");
    expect(css).toMatch(/:root \{[^}]*--bg: #f6f6f4[^}]*color-scheme: light;/);
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*--bg: #0b0b0b/,
    );
    expect(css).toMatch(/:root\[data-theme="dark"\] \{[^}]*--bg: #0b0b0b/);
    expect(css).not.toMatch(/--gold|#d4b26a|champagne/i);
    const pages = ["index.html", "public/privacy.html", "public/favicon.svg"].map((f) =>
      readFileSync(join(root, f), "utf8"),
    );
    for (const page of pages) expect(page).not.toMatch(/#d4b26a|#e6c886|#a9873f/i);
  });

  it("offers a System / Light / Dark switch on the landing page", () => {
    expect(landing).toMatch(/role="radiogroup" aria-label="Appearance"/);
    for (const label of ["System", "Light", "Dark"]) expect(landing).toContain(`>${label}</button>`);
  });
});
