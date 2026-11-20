#!/usr/bin/env node
/* global document, window -- used inside page.waitForFunction() / init scripts, which run in the browser */
// Browser test of onboarding's age declaration (P2-03) in real Chromium, served with render.yaml's security headers.
// A small fake Supabase stands in for PostgREST; attest_adult's real rules are proven in supabase/tests/age_attestation.sql.
//
// Covers: the date of birth and 18+ confirmation are required before saving; when attest_adult fails (function
// missing / PGRST202, permission error, network failure) no profile is created and onboarding stays on the first
// step with a message; a retry after the failure succeeds and only then is the profile created.
// Run: npm run test:e2e:onboarding
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { headersForTest } from "./lib/render-headers.mjs";

const root = new URL("..", import.meta.url).pathname;
const require = createRequire(join(root, "package.json"));
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error(
    "Playwright is not installed. Run: npm install --no-save playwright && npx playwright install chromium",
  );
  process.exit(1);
}

const SB_PORT = 54511;
const WEB_PORT = 54512;
const MEMBER = "bbbbbbbb-0000-4000-8000-00000000b001";
let failures = 0;
const results = [];
function check(name, cond, detail = "") {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? `\n      ${detail}` : ""}`);
  if (!cond) failures++;
}

// ---------- Fake Supabase ----------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({
  sub: MEMBER,
  role: "authenticated",
  aal: "aal1",
  exp: Math.floor(Date.now() / 1000) + 3600,
})}.x`;
const user = {
  id: MEMBER,
  aud: "authenticated",
  role: "authenticated",
  email: "new.member@onboarding.test",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};
const session = {
  access_token: token,
  refresh_token: "refresh-1",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
};

// attest: what attest_adult does next ("ok", "missing", "denied"). A network failure is simulated in the browser.
const state = { attest: "ok", attestCalls: [], profileWrites: 0 };
const sb = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.end();
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const body = raw ? JSON.parse(raw) : {};
    const send = (status, data) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(data));
    };
    if (url.pathname === "/auth/v1/user") return send(200, user);
    if (url.pathname === "/rest/v1/rpc/attest_adult") {
      state.attestCalls.push(body);
      if (state.attest === "missing") {
        return send(404, {
          code: "PGRST202",
          message:
            "Could not find the function public.attest_adult(p_birth_date, p_confirm) in the schema cache",
        });
      }
      if (state.attest === "denied") {
        return send(403, { code: "42501", message: "permission denied for function attest_adult" });
      }
      return send(200, 30);
    }
    if (url.pathname === "/rest/v1/profiles") {
      if (req.method === "GET")
        return send(200, req.headers.accept?.includes("vnd.pgrst.object") ? null : []);
      state.profileWrites++;
      return send(201, []);
    }
    return send(200, []);
  });
});
await new Promise((r) => sb.listen(SB_PORT, "127.0.0.1", r));

// ---------- Build and serve the web app with the production headers ----------
const work = mkdtempSync(join(tmpdir(), "rentmate-onboarding-"));
const webDir = join(work, "dist");
execFileSync("npx", ["vite", "build", "--outDir", webDir, "--emptyOutDir", "--logLevel", "error"], {
  cwd: join(root, "apps/web"),
  env: {
    ...process.env,
    VITE_SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
    VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
    VITE_API_URL: `http://127.0.0.1:${SB_PORT}`,
  },
  stdio: "inherit",
});
const SECURITY_HEADERS = headersForTest(root, ["http://127.0.0.1:*", "ws://127.0.0.1:*"]);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const web = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  let file = join(webDir, path);
  if (!file.startsWith(webDir) || !existsSync(file) || path === "/") file = join(webDir, "index.html");
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": types[extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
});
await new Promise((r) => web.listen(WEB_PORT, "127.0.0.1", r));

const browser = await chromium.launch();
const pageErrors = [];
const stepText = (page) =>
  page
    .locator(".onboarding > p.muted.small.center")
    .first()
    .innerText({ timeout: 10_000 })
    .catch(() => "");
const action = (page) => page.locator("form button.btn.dark.grow");

/** Walks from the first step to the save step ("places"), leaving the optional steps empty. */
async function toSaveStep(page) {
  for (let i = 0; i < 12; i++) {
    if ((await action(page).innerText()) === "Save and continue") return true;
    const before = await stepText(page);
    await action(page).click();
    await page.waitForFunction((b) => !document.body.innerText.includes(b), before, { timeout: 5000 });
  }
  return false;
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["sb-127-auth-token", JSON.stringify(session)],
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) pageErrors.push(`CSP: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await page.locator('input[type="date"]').waitFor({ timeout: 10_000 });
  check("a new member starts onboarding at the date-of-birth step", /Step 1 of/.test(await stepText(page)));

  // ===== The 18+ confirmation and date of birth are required =====
  await page.getByLabel("First name").fill("Asha");
  await action(page).click();
  check(
    "without a date of birth and the 18+ confirmation, onboarding does not continue",
    /Step 1 of/.test(await stepText(page)),
  );
  await page.locator('input[type="date"]').fill("2015-01-01");
  await page.locator('label.check input[type="checkbox"]').check();
  await action(page).click();
  check(
    "an under-18 date of birth is refused in the browser",
    /Step 1 of/.test(await stepText(page)) && (await page.locator("small.err").count()) > 0,
  );
  await page.locator('input[type="date"]').fill("1995-06-15");
  check("with an adult date of birth and the confirmation, onboarding continues", await toSaveStep(page));

  // ===== attest_adult failures stop onboarding (fail closed) =====
  for (const [mode, label, pattern] of [
    ["missing", "the attest_adult function is missing (PGRST202)", /temporarily unavailable/i],
    ["denied", "attest_adult is refused (permission error)", /sign in again/i],
    ["network", "the network fails during attest_adult", /couldn't confirm your age/i],
  ]) {
    state.attest = mode;
    const writes = state.profileWrites;
    const calls = state.attestCalls.length;
    if ((await action(page).innerText()) !== "Save and continue") await toSaveStep(page);
    if (mode === "network") {
      await page.route("**/rest/v1/rpc/attest_adult", (route) => {
        state.attestCalls.push(route.request().postDataJSON());
        return route.abort("internetdisconnected");
      });
    }
    await action(page).click();
    const alert = page.locator(".alert.error");
    await alert.waitFor({ timeout: 10_000 });
    const message = await alert.innerText();
    check(`${label}: attest_adult was called`, state.attestCalls.length === calls + 1);
    check(
      `${label}: no profile is created`,
      state.profileWrites === writes,
      `profile writes ${state.profileWrites}`,
    );
    check(
      `${label}: onboarding returns to the first step with a clear message`,
      /Step 1 of/.test(await stepText(page)) && pattern.test(message),
      `step "${await stepText(page)}", message "${message}"`,
    );
    if (mode === "network") await page.unroute("**/rest/v1/rpc/attest_adult");
  }

  // ===== A retry after the failure succeeds =====
  state.attest = "ok";
  await toSaveStep(page);
  await action(page).click();
  await page.waitForFunction(() => /Step (9|10|11|12) of/.test(document.body.innerText), null, {
    timeout: 15_000,
  });
  check("a retry succeeds: the profile is created once", state.profileWrites === 1, `${state.profileWrites}`);
  check(
    "the declaration sent is the date of birth with the confirmation",
    JSON.stringify(state.attestCalls.at(-1)) ===
      JSON.stringify({ p_birth_date: "1995-06-15", p_confirm: true }),
    JSON.stringify(state.attestCalls.at(-1)),
  );
  check("onboarding moves past the save step", !/Step [1-8] of/.test(await stepText(page)));
  await context.close();

  check(
    "no uncaught errors or Content-Security-Policy violations",
    pageErrors.length === 0,
    pageErrors.slice(0, 5).join(" | "),
  );
} catch (e) {
  failures++;
  results.push(`FAIL  test run stopped: ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
  sb.close();
  web.close();
  rmSync(work, { recursive: true, force: true });
}
console.log(results.join("\n"));
console.log(
  failures ? `\n${failures} check(s) failed` : `\nall ${results.length} onboarding browser checks passed`,
);
process.exit(failures ? 1 : 0);
