/* global document, window -- used inside page.evaluate(), which runs in the browser */
// Browser smoke test for apps/web, run against a production build in real Chromium.
// No network: every request that is not to the local static server is blocked, so this
// never touches Supabase, Render or any real account. Run: npm run test:e2e
//
// Playwright is not a project dependency. CI installs it with `npm install --no-save`;
// locally it is found if installed globally (or in node_modules).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { headersForTest, inlineScriptProblems } from "./lib/render-headers.mjs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error(
    "Playwright is not installed. Run: npm install --no-save playwright && npx playwright install chromium",
  );
  process.exit(1);
}

const root = new URL("..", import.meta.url).pathname;
// Served with render.yaml's security headers; local test servers are the only extra origins.
const SECURITY_HEADERS = headersForTest(root, [
  "http://127.0.0.1:*",
  "ws://127.0.0.1:*",
  // The unconfigured build falls back to the local development API.
  "http://localhost:*",
]);
const work = mkdtempSync(join(tmpdir(), "soulmate-e2e-"));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};
let failures = 0;

function build(name, env) {
  const outDir = join(work, name);
  execFileSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: join(root, "apps/web"),
    env: { ...process.env, VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", VITE_API_URL: "", ...env },
    stdio: "inherit",
  });
  return outDir;
}

// Static server with the same SPA fallback as the Render rewrite rule.
function serve(dir) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    let file = join(dir, path);
    if (!file.startsWith(dir) || !existsSync(file) || path === "/") file = join(dir, "index.html");
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": types[extname(file)] ?? "application/octet-stream",
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function check(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

async function open(browser, base, viewport, handleExternal = null) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const external = new Set();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) errors.push(`CSP: ${m.text()}`);
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (handleExternal && (await handleExternal(route, url))) return;
    external.add(new URL(url).host);
    return route.abort();
  });
  await page.goto(base + "/", { waitUntil: "load" });
  return { context, page, errors, external };
}

const executablePath = ["/opt/pw-browsers/chromium"].find((p) => existsSync(p));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const servers = [];
try {
  // 1. Configured build, signed out: the sign-in screen must render.
  //    The Supabase URL is a placeholder host; any request to it is blocked and recorded.
  const configuredDir = build("configured", {
    VITE_SUPABASE_URL: "https://e2e-placeholder.supabase.co",
    VITE_SUPABASE_ANON_KEY: "e2e-placeholder-anon-key",
    VITE_API_URL: "https://e2e-placeholder-api.onrender.com",
  });
  const inline = inlineScriptProblems(
    readFileSync(join(configuredDir, "index.html"), "utf8"),
    SECURITY_HEADERS["Content-Security-Policy"],
  );
  check(
    "render.yaml's CSP allows the built page's inline theme script (hash matches)",
    inline.length === 0,
    inline.join(" | "),
  );
  const configured = await serve(configuredDir);
  servers.push(configured);
  const base = `http://127.0.0.1:${configured.address().port}`;

  for (const [label, viewport] of [
    ["desktop", { width: 1280, height: 800 }],
    ["phone", { width: 390, height: 844 }],
  ]) {
    const { context, page, errors } = await open(browser, base, viewport);
    check(
      `${label}: page title is the RentMate title`,
      (await page.title()) === "RentMate — Meet. Connect. Experience.",
    );
    const email = page.locator('input[type="email"]');
    await email
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
    check(`${label}: signed-out visitor sees the email sign-in form`, (await email.count()) > 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(
      `${label}: no horizontal scrolling`,
      overflow <= 1,
      `page is ${overflow}px wider than the viewport`,
    );
    check(
      `${label}: no uncaught JavaScript errors or Content-Security-Policy violations`,
      errors.length === 0,
      errors.join(" | "),
    );
    await context.close();
  }

  // 2. Deep link: the SPA fallback must serve the app, not a 404.
  {
    const { context, page } = await open(browser, base, { width: 1280, height: 800 });
    await page.goto(base + "/some/deep/link", { waitUntil: "load" });
    check("deep links load the app", (await page.title()) === "RentMate — Meet. Connect. Experience.");
    await context.close();
  }

  // 2b. Sign-up needs the explicit 18+ confirmation before anything is sent (P2-03; a declaration, not verification).
  {
    const { context, page } = await open(browser, base, { width: 390, height: 844 });
    const signups = [];
    page.on("request", (r) => {
      if (r.url().includes("/auth/v1/signup")) signups.push(r.url());
    });
    await page.locator('input[type="email"]').first().waitFor({ state: "visible", timeout: 10000 });
    await page.locator('input[type="email"]').first().fill("new.member@example.com");
    await page.locator('input[autocomplete="new-password"]').first().fill("walks2026cafe");
    await page.locator("form button.btn.block").first().click();
    const message = page.getByText("Please confirm that you are 18 or older.");
    await message.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    check("sign-up without the 18+ confirmation shows why", await message.isVisible());
    check("sign-up without the 18+ confirmation sends nothing", signups.length === 0, signups.join(", "));
    await page.getByLabel("I confirm that I am 18 or older.").check();
    await page.locator("form button.btn.block").first().click();
    await page.waitForTimeout(1500);
    check("with the 18+ confirmation, sign-up is sent", signups.length > 0);
    await context.close();
  }

  // 2c. Demo Mode uses fictional profiles and simulated interactions only.
  {
    const { context, page, errors, external } = await open(
      browser,
      base,
      { width: 390, height: 844 },
      async (route, url) => {
        const method = route.request().method();
        // The app pings API liveness on startup; permit only this read-only GET.
        if (
          url === "https://e2e-placeholder-api.onrender.com/health" &&
          method === "GET"
        ) {
          await route.abort();
          return true;
        }
        // Static fonts are optional presentation assets, not app data or writes.
        if (
          (url.startsWith("https://fonts.googleapis.com/") ||
            url.startsWith("https://fonts.gstatic.com/")) &&
          method === "GET"
        ) {
          await route.abort();
          return true;
        }
        if (
          url.startsWith(
            "https://e2e-placeholder.supabase.co/rest/v1/rpc/demo_mode_profiles",
          ) &&
          method === "POST"
        ) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([
              {
                id: "00000000-0000-5000-8000-000000000001",
                display_name: "Demo Asha",
                age: 27,
                bio: "A fictional demo profile.",
                interests: ["Hiking", "Coffee"],
                looking_for: "relationship",
                photo_path: null,
                verified: false,
                created_at: "2026-01-01T00:00:00.000Z",
                distance_km: 4,
                online: true,
              },
            ]),
          });
          return true;
        }
        return false;
      },
    );
    await page.goto(base + "/#demo", { waitUntil: "load" });
    await page
      .getByText("Demo Mode", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 10000 });
    check(
      "Demo Mode loads fictional profiles from the dedicated demo RPC",
      (await page.getByText("Demo Asha").count()) > 0,
    );
    check(
      "Demo Mode clearly explains that profiles and interactions are simulated",
      (await page.locator(".demo-banner").innerText()).includes("fictional and simulated"),
    );
    await page.getByRole("button", { name: "Likes" }).click();
    check(
      "Demo Mode exposes its simulated Likes tab",
      await page.getByText(/Fictional demo profiles that/).isVisible(),
    );
    await page.getByRole("button", { name: "Chats" }).click();
    check(
      "Demo Mode exposes its simulated Chats tab",
      await page.getByText(/Simulated matches and conversations/).isVisible(),
    );
    check(
      "Demo Mode makes no unapproved external requests or writes",
      external.size === 0,
      [...external].join(", "),
    );
    check(
      "Demo Mode has no uncaught JavaScript or CSP errors",
      errors.length === 0,
      errors.join(" | "),
    );
    await context.close();
  }

  // 3. Build without Supabase settings: must show the configuration message instead of failing.
  const bare = await serve(build("unconfigured", {}));
  servers.push(bare);
  {
    const bareBase = `http://127.0.0.1:${bare.address().port}`;
    const { context, page, errors, external } = await open(browser, bareBase, { width: 1280, height: 800 });
    const text = await page.locator("body").innerText();
    check(
      "unconfigured build explains the missing Supabase settings",
      text.includes("missing its Supabase settings"),
    );
    // Expected and allowed: Google Fonts (index.html) and the API health ping in main.tsx that wakes Render.
    const supabaseHosts = [...external].filter((h) => h.includes("supabase"));
    check("unconfigured build never contacts Supabase", supabaseHosts.length === 0, supabaseHosts.join(", "));
    check("unconfigured build has no uncaught errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
} finally {
  await browser.close();
  for (const s of servers) s.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall browser checks passed");
process.exit(failures ? 1 : 0);
