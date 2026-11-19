#!/usr/bin/env node
// Repository policy guard. Keeps content that GitHub's Terms and Acceptable Use Policies prohibit, or that
// RentMate's permanent policy forbids, out of the repository. Runs first in `npm run check` and in CI.
//
//   1. No real secrets (GitHub, Supabase, Stripe, AWS, Anthropic, private keys, long JWTs) and no .env files.
//   2. No images, video or audio (checked by extension AND by file signature, so renamed media is caught);
//      SVGs must be plain drawings (no embedded images, scripts or remote links).
//   3. No file larger than 2 MB.
//   4. No pornographic / adult / sexual-solicitation wording, except in lines that state a prohibition.
//   5. Migration safety: well-formed, unique names; new migrations cannot delete or truncate data, drop tables
//      or columns, or switch off the no-adult-content protections.
//
// Usage: node scripts/policy-check.mjs              (self-test, then scan tracked + new files)
//        node scripts/policy-check.mjs --self-test  (self-test only)
import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CASES } from "./policy-check.cases.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
/** Migrations at or after this version must be non-destructive (earlier ones are already reviewed history). */
export const MIGRATION_SAFETY_FROM = "20261118000000";

export const SECRET_PATTERNS = [
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ["Stripe live key", /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Private key", /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ["Anthropic key", /\bsk-ant-(api|admin)\d{2}-[A-Za-z0-9_-]{80,}\b/],
  ["Long JWT (possible service key)", /\beyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{30,}\b/],
];

const MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|tiff?|ico|psd|mp4|mov|webm|mkv|avi|m4v|3gp|flv|mp3|wav|ogg|m4a|aac|flac)$/i;
const SVG_UNSAFE =
  /<image\b|<script\b|<foreignObject\b|data:[a-z]+\/[a-z0-9.+-]+;base64|href\s*=\s*["']https?:/i;

/** Recognises common image/video/audio files by their first bytes, whatever the file is called. */
export function mediaSignature(buf) {
  const b = (i) => buf[i];
  const ascii = (from, to) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length < 4) return null;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "JPEG image";
  if (b(0) === 0x89 && ascii(1, 4) === "PNG") return "PNG image";
  if (ascii(0, 4) === "GIF8") return "GIF image";
  if (ascii(0, 4) === "RIFF" && buf.length >= 12 && ["WEBP", "AVI ", "WAVE"].includes(ascii(8, 12)))
    return "RIFF media";
  if (buf.length >= 12 && ascii(4, 8) === "ftyp") return "MP4/MOV/HEIC media";
  if (b(0) === 0x1a && b(1) === 0x45 && b(2) === 0xdf && b(3) === 0xa3) return "WebM/MKV video";
  if (ascii(0, 3) === "ID3" || (b(0) === 0xff && (b(1) & 0xe0) === 0xe0 && b(1) !== 0xff)) return "MP3 audio";
  if (ascii(0, 4) === "OggS" || ascii(0, 4) === "fLaC") return "Ogg/FLAC audio";
  if (ascii(0, 4) === "BM" + ascii(2, 4) && b(0) === 0x42 && b(1) === 0x4d && buf.length > 26) return null; // too weak
  return null;
}

export const ADULT_TERMS = new RegExp(
  [
    "\\bp[o0]rn(o|os|s|y|ography|ographic|star|stars|hub)?\\b",
    "\\bpr0n\\b",
    "\\bxxx\\b",
    "\\bnsfw\\b",
    "\\bnudes\\b",
    "\\bnudity\\b",
    "\\bonlyfans\\b",
    "\\bcam ?girls?\\b",
    "\\bsexting\\b",
    "\\bescort(s|ing|ed)?\\b",
    "\\bsex(ual)? ?(services?|work(ers?)?|chat)\\b",
    "\\b(paid|money|cash) (for|4) sex\\b",
    "\\bsex (for|4) (money|cash|pay)\\b",
    "\\berotic(a)?\\b",
    "\\bfetish(es)?\\b",
    "\\bhentai\\b",
  ].join("|"),
  "i",
);
/** A line may use those words only to forbid them. Plain "no"/"without" are not enough ("no limits porn"). */
export const PROHIBITION = new RegExp(
  [
    "\\bnot\\b",
    "\\bnever\\b",
    "\\bprohibit\\w*",
    "\\bforbid\\w*",
    "\\bban(s|ned)?\\b",
    "\\bdisallow\\w*",
    "\\bdo(es)? not\\b",
    "\\b(doesn't|don't|isn't|aren't|cannot|can't|won't)\\b",
    "\\brefus\\w*",
    "\\breject\\w*",
    "\\bblock(s|ed|ing)?\\b",
    "\\bunsupported\\b",
    "\\babuse\\b",
    "\\bno (sexual|adult|explicit|p[o0]rn\\w*|escort\\w*|nudity|nudes)\\b",
  ].join("|"),
  "i",
);

/**
 * Explicit, reviewable exception for a single line (refusal tests, report-reason labels). It never exempts
 * secrets, media or migration rules, and every scan prints how many lines use it.
 */
export const ALLOW_MARK = /policy-guard: allow/;

/** Statements a new migration may not contain (non-destructive, protections stay on). */
export const MIGRATION_FORBIDDEN = [
  ["deletes data", /^\s*delete\s+from\b/im],
  // A TRUNCATE statement (at the start of a line, after ";" or inside dynamic EXECUTE). The TRUNCATE privilege named in
  // GRANT/REVOKE is not a statement and deletes nothing.
  ["truncates data", /(^|;)\s*truncate\b|\bexecute\s+(format\s*\(\s*)?'\s*truncate\b/im],
  ["drops a table", /\bdrop\s+table\b/i],
  ["drops a column", /\bdrop\s+column\b/i],
  ["drops a schema", /\bdrop\s+schema\b/i],
  ["disables a trigger", /\bdisable\s+trigger\b/i],
  ["disables row level security", /\bdisable\s+row\s+level\s+security\b/i],
  ["removes a no-adult-content trigger", /\bdrop\s+trigger\b[^;]*(no_adult_content|no_prohibited_text)/i],
  [
    "removes a no-adult-content constraint",
    /\bdrop\s+constraint\b[^;]*(no_adult_content|explicit_never_available)/i,
  ],
  ["re-enables adult content", /\b(explicit_allowed|available)\s*=\s*true\b/i],
];

const SKIP = [
  /^package-lock\.json$/,
  /^scripts\/policy-check(\.cases)?\.mjs$/,
  /(^|\/)node_modules\//,
  /^docs\/held-migrations\//, // non-executable records kept for review (.txt)
];
const TEXT =
  /\.(m?[jt]sx?|cjs|json|md|sql|html|css|ya?ml|sh|txt|svg|toml)$|(^|\/)\.env\.example$|(^|\/)\.gitignore$/;

export function checkFile(path, content, firstBytes) {
  const problems = [];
  if (/(^|\/)\.env($|\.)/.test(path) && !path.endsWith(".env.example"))
    problems.push(".env files must never be committed");
  if (MEDIA_EXT.test(path)) problems.push("images, video and audio are not stored in the repository");
  else if (firstBytes) {
    const sig = mediaSignature(firstBytes);
    if (sig) problems.push(`file content is a ${sig} (renamed media is not allowed)`);
  }
  if (path.endsWith(".svg") && SVG_UNSAFE.test(content))
    problems.push("SVG embeds an image, script or remote link");
  content.split("\n").forEach((line, i) => {
    for (const [name, re] of SECRET_PATTERNS)
      if (re.test(line)) problems.push(`line ${i + 1}: looks like a real ${name}`);
    if (ADULT_TERMS.test(line) && !PROHIBITION.test(line))
      problems.push(`line ${i + 1}: adult-content wording`);
  });
  problems.push(...checkMigration(path, content));
  return problems;
}

export function checkMigration(path, content) {
  const m = /^supabase\/migrations\/([^/]+)$/.exec(path);
  if (!m) return [];
  const name = m[1];
  const problems = [];
  const parts = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(name);
  if (!parts) return [`migration file name must look like 20260101000000_name.sql`];
  if (parts[1] >= MIGRATION_SAFETY_FROM) {
    // Strip SQL comments so documentation can describe what is forbidden.
    const code = content.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [what, re] of MIGRATION_FORBIDDEN) if (re.test(code)) problems.push(`migration ${what}`);
  }
  return problems;
}

/** Duplicate versions or names across migration files. */
export function checkMigrationSet(paths) {
  const problems = [];
  const versions = new Map();
  const names = new Map();
  for (const p of paths) {
    const m = /^supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/.exec(p);
    if (!m) continue;
    if (versions.has(m[1]))
      problems.push(`duplicate migration version ${m[1]}: ${versions.get(m[1])} and ${p}`);
    if (names.has(m[2])) problems.push(`duplicate migration name "${m[2]}": ${names.get(m[2])} and ${p}`);
    versions.set(m[1], p);
    names.set(m[2], p);
  }
  return problems;
}

/**
 * Reads size, the first bytes and (for small text files) the text through one open file handle, so all three describe
 * the same file even if it changes while the guard runs. Returns null for files deleted in the working tree.
 */
function inspect(path, wantText) {
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const { size } = fstatSync(fd);
    const buf = Buffer.alloc(16);
    const n = size > 0 ? readSync(fd, buf, 0, 16, 0) : 0;
    const content = wantText && size <= MAX_BYTES ? readFileSync(fd, "utf8") : "";
    return { size, head: n > 0 ? buf.subarray(0, n) : undefined, content };
  } finally {
    closeSync(fd);
  }
}

export function selfTest() {
  let bad = 0;
  for (const c of CASES) {
    const failed =
      c.set !== undefined
        ? checkMigrationSet(c.set).length > 0
        : checkFile(c.path, c.content ?? "", c.bytes ? Buffer.from(c.bytes) : undefined).length > 0;
    if (failed !== c.fail) {
      bad++;
      console.log(`FAIL self-test (${c.fail ? "missed" : "false alarm"}): ${c.note}`);
    }
  }
  console.log(
    bad ? `${bad} self-test case(s) failed` : `policy self-test: ${CASES.length}/${CASES.length} ok`,
  );
  return bad === 0;
}

function main() {
  if (!selfTest()) process.exit(1);
  if (process.argv.includes("--self-test")) process.exit(0);
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  const all = out.split("\n").filter(Boolean);
  const list = all.filter((f) => !SKIP.some((re) => re.test(f)));
  let failures = 0;
  let allowed = 0;
  const report = (f, p) => {
    failures++;
    console.log(`POLICY  ${f}: ${p}`);
  };
  for (const p of checkMigrationSet(all)) report("supabase/migrations", p);
  for (const f of list) {
    const info = inspect(f, TEXT.test(f));
    if (!info) continue; // deleted in the working tree
    const { size, head, content } = info;
    if (size > MAX_BYTES) report(f, `file is ${(size / 1048576).toFixed(1)} MB (limit 2 MB)`);
    allowed += content.split("\n").filter((l) => ALLOW_MARK.test(l) && ADULT_TERMS.test(l)).length;
    for (const p of checkFile(f, content, head)) report(f, p);
  }
  console.log(
    failures
      ? `${failures} policy problem(s) in ${list.length} files`
      : `policy check: ${list.length} files ok`,
  );
  console.log(`lines using "policy-guard: allow": ${allowed} (each is a reviewed exception)`);
  process.exit(failures ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
