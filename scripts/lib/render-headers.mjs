// Reads the static site's security headers from render.yaml so browser tests serve the app exactly as Render will.
// The headers block has a fixed shape (path / name / value), so a small parser avoids a YAML dependency.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function renderHeaders(root) {
  const text = readFileSync(join(root, "render.yaml"), "utf8");
  const block = text.split(/\n\s*headers:\s*\n/)[1];
  if (!block) throw new Error("render.yaml has no headers block");
  const headers = {};
  for (const m of block.matchAll(/-\s*path:\s*(\S+)\s*\n\s*name:\s*(\S+)\s*\n\s*value:\s*(.+)/g)) {
    if (m[1] !== "/*") continue;
    headers[m[2]] = m[3].trim().replace(/^"(.*)"$/, "$1");
  }
  if (!headers["Content-Security-Policy"])
    throw new Error("render.yaml headers have no Content-Security-Policy");
  return headers;
}

/** Same headers, with extra origins allowed for local test servers (connect-src, img-src, media-src). */
export function headersForTest(root, extraOrigins) {
  const h = { ...renderHeaders(root) };
  h["Content-Security-Policy"] = h["Content-Security-Policy"]
    .split(";")
    .map((d) => {
      const t = d.trim();
      return /^(connect-src|img-src|media-src)\s/.test(t) ? `${t} ${extraOrigins.join(" ")}` : t;
    })
    .join("; ");
  // HSTS on a plain-http local server is meaningless; keep everything else identical.
  delete h["Strict-Transport-Security"];
  return h;
}

/** Every inline <script> in a built index.html must be allowed by a sha256 source in the CSP. */
export function inlineScriptProblems(indexHtml, csp) {
  const problems = [];
  for (const m of indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const hash = `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`;
    if (!csp.includes(hash)) problems.push(`inline script ${hash} is not allowed by the CSP`);
  }
  return problems;
}
