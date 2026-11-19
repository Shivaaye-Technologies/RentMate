#!/usr/bin/env node
/* global document, window -- used inside page.evaluate() / init scripts, which run in the browser */
// Browser test of the admin MFA screens (apps/web/src/security/AdminGate.tsx) in real Chromium, served with
// render.yaml's security headers. A small fake Supabase stands in for GoTrue's MFA endpoints and the security RPCs,
// whose server-side rules are proven separately in supabase/tests/admin_mfa.sql and recovery_codes_and_retention.sql.
//
// Covers: enrolment (QR + key, wrong code refused, right code verifies and raises the session to aal2), recovery
// codes shown once and must be acknowledged, the gate opening afterwards; the challenge screen; recovery sign-in with
// a pasted 24-character code (full code reaches the server, not a truncated one); a wrong code; lockout message.
// Run: npm run test:e2e:mfa
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

const SB_PORT = 54501;
const WEB_PORT = 54502;
const ADMIN = "aaaaaaaa-0000-4000-8000-00000000a001";
const CODES = Array.from({ length: 10 }, (_, i) => `AB${i}D-12C4-EF56-7890-ABC${i}`);
let failures = 0;
const results = [];
function check(name, cond, detail = "") {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? `\n      ${detail}` : ""}`);
  if (!cond) failures++;
}

// ---------- Fake Supabase: GoTrue MFA + security RPCs ----------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (aal) =>
  `${b64({ alg: "none", typ: "JWT" })}.${b64({
    sub: ADMIN,
    role: "authenticated",
    aal,
    session_id: "11111111-2222-4333-8444-555555555555",
    amr: aal === "aal2" ? [{ method: "password" }, { method: "totp" }] : [{ method: "password" }],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.x`;
const aalOf = (req) => {
  try {
    const t = (req.headers.authorization ?? "").replace(/^Bearer /, "").split(".")[1];
    return JSON.parse(Buffer.from(t, "base64url").toString()).aal ?? "aal1";
  } catch {
    return "aal1";
  }
};
const state = { factor: null, recoveryGrant: false, codesUsed: new Set(), receivedCodes: [], failed: 0 };
const user = () => ({
  id: ADMIN,
  aud: "authenticated",
  role: "authenticated",
  email: "admin@mfa.test",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
  factors: state.factor ? [state.factor] : [],
});
const session = (aal) => ({
  access_token: jwt(aal),
  refresh_token: `refresh-${aal}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: user(),
});

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
    const aal = aalOf(req);
    if (url.pathname === "/auth/v1/user") return send(200, user());
    if (url.pathname === "/auth/v1/factors" && req.method === "POST") {
      state.factor = { id: "f-totp-1", factor_type: "totp", status: "unverified", friendly_name: "RentMate" };
      return send(200, {
        id: "f-totp-1",
        type: "totp",
        totp: {
          // GoTrue returns bare SVG; supabase-js adds the "data:image/svg+xml;utf-8," prefix itself.
          qr_code:
            "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='black'/></svg>",
          secret: "JBSWY3DPEHPK3PXP",
          uri: "otpauth://totp/RentMate:admin@mfa.test?secret=JBSWY3DPEHPK3PXP",
        },
      });
    }
    if (/^\/auth\/v1\/factors\/[^/]+\/challenge$/.test(url.pathname)) {
      return send(200, { id: "challenge-1", type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
    }
    if (/^\/auth\/v1\/factors\/[^/]+\/verify$/.test(url.pathname)) {
      if (body.code !== "123456") {
        return send(422, {
          code: "mfa_verification_failed",
          msg: "Invalid TOTP code entered",
          error_code: "mfa_verification_failed",
        });
      }
      state.factor = { ...state.factor, status: "verified" };
      return send(200, session("aal2"));
    }
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname)?.[1];
    if (rpc === "my_security_status") {
      return send(200, {
        privileged: true,
        roles: ["admin"],
        mfa_required: true,
        has_factor: state.factor?.status === "verified",
        aal,
        mfa_ok: aal === "aal2" || state.recoveryGrant,
        recovery_codes_left: CODES.length - state.codesUsed.size,
        recovery_until: state.recoveryGrant ? new Date(Date.now() + 15 * 60_000).toISOString() : null,
      });
    }
    if (rpc === "mfa_generate_recovery_codes") {
      if (aal !== "aal2")
        return send(403, { code: "42501", message: "Verify with your authenticator app first." });
      return send(200, CODES);
    }
    if (rpc === "mfa_use_recovery_code") {
      state.receivedCodes.push(body.p_code);
      if (state.failed >= 5) return send(200, "locked");
      if (CODES.includes(body.p_code) && !state.codesUsed.has(body.p_code)) {
        state.codesUsed.add(body.p_code);
        state.recoveryGrant = true;
        return send(200, "ok");
      }
      state.failed++;
      return send(200, "invalid");
    }
    if (rpc) return send(200, []);
    return send(200, []);
  });
});
await new Promise((r) => sb.listen(SB_PORT, "127.0.0.1", r));

// ---------- Build and serve the web app with the production headers ----------
const work = mkdtempSync(join(tmpdir(), "rentmate-mfa-"));
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
async function adminPage(aal) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["sb-127-auth-token", JSON.stringify(session(aal))],
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) pageErrors.push(`CSP: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${WEB_PORT}/#admin`);
  return { context, page };
}
const heading = (page) =>
  page
    .locator("h2")
    .first()
    .innerText({ timeout: 10_000 })
    .catch(() => "");

try {
  // ===== Enrolment =====
  {
    const { context, page } = await adminPage("aal1");
    check(
      "an admin without a factor must set up an authenticator first",
      /Set up your authenticator/.test(await heading(page)),
    );
    await page.getByRole("button", { name: "Start setup" }).click();
    const qr = page.locator("img.mfa-qr");
    await qr.waitFor({ timeout: 10_000 });
    const decoded = await qr.evaluate((img) =>
      img.complete ? img.naturalWidth : new Promise((r) => (img.onload = () => r(img.naturalWidth))),
    );
    const qrInfo = await qr.evaluate((img) => ({
      src: img.getAttribute("src")?.slice(0, 60),
      complete: img.complete,
    }));
    check(
      "enrolment shows a QR code (the image decodes under the CSP)",
      decoded > 0,
      `naturalWidth ${decoded} ${JSON.stringify(qrInfo)}`,
    );
    check(
      "enrolment shows the key for manual entry",
      (await page.locator(".mfa-secret").innerText()) === "JBSWY3DPEHPK3PXP",
    );
    const codeInput = page.getByLabel("6-digit code");
    await codeInput.fill("12ab34");
    check("the code field accepts digits only", (await codeInput.inputValue()) === "1234");
    await codeInput.fill("999999");
    await page.locator("form").getByRole("button").click();
    await page.locator(".alert.error").waitFor({ timeout: 5000 });
    check("a wrong code is refused with a message", (await page.locator(".alert.error").count()) === 1);
    await codeInput.fill("123456");
    await page.locator("form").getByRole("button").click();
    await page.getByRole("heading", { name: "Save your recovery codes" }).waitFor({ timeout: 10_000 });
    const shown = await page.locator(".mfa-codes code").allInnerTexts();
    check("after verifying, ten recovery codes are shown once", shown.length === 10 && shown[0] === CODES[0]);
    const cont = page.getByRole("button", { name: "Continue" });
    check("continuing requires confirming the codes were saved", await cont.isDisabled());
    await page.getByLabel("I have saved these codes").check();
    await cont.click();
    await page.waitForFunction(() => !document.body.innerText.includes("Save your recovery codes"), null, {
      timeout: 10_000,
    });
    const after = await page.locator("body").innerText();
    check(
      "the admin area opens after enrolment (session raised to aal2)",
      !/Set up your authenticator|Enter your 6-digit code/.test(after),
    );
    await context.close();
  }

  // ===== Challenge on a new password-only session =====
  {
    const { context, page } = await adminPage("aal1");
    check(
      "a later password-only session is asked for the 6-digit code",
      /Enter your 6-digit code/.test(await heading(page)),
    );

    // ===== Recovery with a pasted 24-character code =====
    await page.getByRole("button", { name: "Lost your phone? Use a recovery code" }).click();
    check("the recovery screen opens", /Use a recovery code/.test(await heading(page)));
    const input = page.getByLabel("Recovery code");
    await input.fill("not-a-real-code");
    await page.locator("form").getByRole("button").click();
    await page.locator(".alert.error").waitFor({ timeout: 5000 });
    check(
      "a wrong recovery code is refused",
      /isn't valid or was already used/.test(await page.locator(".alert.error").innerText()),
    );
    const pasted = `  ${CODES[3].toLowerCase()}  `; // pasted with spaces, lower case, dashes: 28 characters
    await input.fill(pasted);
    check("the field keeps the whole pasted code (not truncated)", (await input.inputValue()) === pasted);
    await page.locator("form").getByRole("button").click();
    await page.waitForFunction(() => !document.body.innerText.includes("Use a recovery code"), null, {
      timeout: 10_000,
    });
    check(
      "the server receives the complete, normalised code",
      state.receivedCodes.at(-1) === CODES[3],
      `received ${JSON.stringify(state.receivedCodes)}`,
    );
    check(
      "a valid recovery code opens the admin area",
      !/Use a recovery code|Enter your 6-digit code/.test(await page.locator("body").innerText()),
    );
    await context.close();
  }

  // ===== Lockout message after too many failures =====
  {
    state.recoveryGrant = false;
    state.failed = 5;
    const { context, page } = await adminPage("aal1");
    await page.getByRole("button", { name: "Lost your phone? Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(CODES[5]);
    await page.locator("form").getByRole("button").click();
    await page.locator(".alert.error").waitFor({ timeout: 5000 });
    check(
      "after 5 failures, recovery reports a lock instead of trying",
      /lock|later|hour/i.test(await page.locator(".alert.error").innerText()),
    );
    check("a locked attempt does not open the admin area", /Use a recovery code/.test(await heading(page)));
    await context.close();
  }

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
console.log(failures ? `\n${failures} check(s) failed` : `\nall ${results.length} MFA browser checks passed`);
process.exit(failures ? 1 : 0);
