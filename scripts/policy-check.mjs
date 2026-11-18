#!/usr/bin/env node
// Repository policy guard: keeps content that GitHub's Terms and Acceptable Use Policies prohibit, or that
// RentMate's own rules forbid, out of the repository. Runs in `npm run check` (CI) and fails the build.
//
//   1. No real secrets (GitHub, Supabase, Stripe, AWS, private keys, long JWTs) and no .env files.
//   2. No raster images, video or audio at all; SVGs must be plain drawings (no embedded images or scripts).
//   3. No file larger than 2 MB.
//   4. No adult / pornographic wording, except in lines that state a prohibition.
//
// Usage: node scripts/policy-check.mjs            (checks tracked + new files)
//        node scripts/policy-check.mjs --self-test
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_BYTES = 2 * 1024 * 1024;

export const SECRET_PATTERNS = [
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ["Stripe live key", /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Private key", /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ["Anthropic key", /\bsk-ant-(api|admin)\d{2}-[A-Za-z0-9_-]{80,}\b/],
  ["Long JWT (possible service key)", /\beyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{30,}\b/],
];

const MEDIA =
  /\.(png|jpe?g|gif|webp|avif|heic|bmp|tiff?|ico|mp4|mov|webm|mkv|avi|m4v|mp3|wav|ogg|m4a|flac)$/i;
const SVG_UNSAFE =
  /<image\b|<script\b|<foreignObject\b|data:[a-z]+\/[a-z0-9.+-]+;base64|href\s*=\s*["']https?:/i;

export const ADULT_TERMS =
  /\b(porn\w*|xxx|nsfw|nude|nudes|nudity|escort(s|ing)?|onlyfans|camgirls?|sexting|hookups?|erotic\w*|fetish\w*)\b/i;
// A line may mention these words only to forbid them.
export const PROHIBITION =
  /\b(no|not|never|forbid\w*|prohibit\w*|ban\w*|block\w*|reject\w*|refus\w*|disallow\w*|without|doesn't|does not|don't|isn't|cannot|can't|abuse|policy|policies|unsupported|risk)\b/i;

const SKIP = [/^package-lock\.json$/, /^scripts\/policy-check\.mjs$/, /(^|\/)node_modules\//];
const TEXT =
  /\.(m?[jt]sx?|cjs|json|md|sql|html|css|ya?ml|sh|txt|svg|toml|env\.example)$|(^|\/)\.env\.example$/;

export function checkFile(path, content) {
  const problems = [];
  if (/(^|\/)\.env($|\.)/.test(path) && !path.endsWith(".env.example"))
    problems.push(".env files must never be committed");
  if (MEDIA.test(path)) problems.push("images, video and audio are not stored in the repository");
  if (path.endsWith(".svg") && SVG_UNSAFE.test(content))
    problems.push("SVG embeds an image, script or remote link");
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    for (const [name, re] of SECRET_PATTERNS)
      if (re.test(line)) problems.push(`line ${i + 1}: looks like a real ${name}`);
    if (ADULT_TERMS.test(line) && !PROHIBITION.test(line))
      problems.push(`line ${i + 1}: adult-content wording`);
  });
  return problems;
}

function files() {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return out.split("\n").filter((f) => f && !SKIP.some((re) => re.test(f)));
}

function selfTest() {
  const cases = [
    ["a.ts", `const t = "ghp_${"A".repeat(36)}";`, true],
    ["a.ts", `const fake = "ghp_ShouldNeverBeLogged";`, false],
    ["a.sql", "-- RentMate does not support pornographic content", false],
    ["a.tsx", "<h1>Hot porn tonight</h1>", true],
    ["a.md", "Escorting and sexual services are prohibited.", false],
    ["photo.jpg", "", true],
    ["x.svg", '<svg><image href="data:image/png;base64,AAAA"/></svg>', true],
    ["x.svg", '<svg><circle r="3"/></svg>', false],
    ["apps/api/.env", "A=1", true],
    [".env.example", "LIVEKIT_API_KEY=", false],
  ];
  let bad = 0;
  for (const [p, c, shouldFail] of cases) {
    const failed = checkFile(p, c).length > 0;
    if (failed !== shouldFail) {
      bad++;
      console.log(`FAIL self-test: ${p} ${JSON.stringify(c).slice(0, 50)}`);
    }
  }
  console.log(
    bad ? `${bad} self-test case(s) failed` : `policy self-test: ${cases.length}/${cases.length} ok`,
  );
  return bad === 0;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest() ? 0 : 1);
} else {
  if (!selfTest()) process.exit(1);
  let failures = 0;
  const list = files();
  for (const f of list) {
    let size = 0;
    try {
      size = statSync(f).size;
    } catch {
      continue; // deleted in the working tree
    }
    const problems = [];
    if (size > MAX_BYTES) problems.push(`file is ${(size / 1048576).toFixed(1)} MB (limit 2 MB)`);
    const content = TEXT.test(f) && size <= MAX_BYTES ? readFileSync(f, "utf8") : "";
    problems.push(...checkFile(f, content));
    for (const p of problems) {
      failures++;
      console.log(`POLICY  ${f}: ${p}`);
    }
  }
  console.log(
    failures
      ? `${failures} policy problem(s) in ${list.length} files`
      : `policy check: ${list.length} files ok`,
  );
  process.exit(failures ? 1 : 0);
}
