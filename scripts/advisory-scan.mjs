#!/usr/bin/env node
// Dependabot-equivalent check without GitHub API access. Matches every package copy in package-lock.json (v2/v3, nested
// copies included) against GitHub's *reviewed* npm advisories, the data Dependabot alerts are raised from, read from a
// local copy of github/advisory-database (OSV JSON, advisories/github-reviewed). Version ranges use npm's ordering,
// prereleases included. Exits 1 when anything matches.
//
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/github/advisory-database /tmp/advisory-db
//   git -C /tmp/advisory-db sparse-checkout set advisories/github-reviewed
//   npm run audit:advisories -- /tmp/advisory-db/advisories/github-reviewed package-lock.json
//
// `node scripts/advisory-scan.mjs --self-test` checks the matcher only (part of `npm run test:policy`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------- semver ordering (npm rules, including prereleases) ----------
export function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v).trim());
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] };
}
export function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1;
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1; // release > prerelease
  if (!b.pre.length) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny && +x !== +y) return +x < +y ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** True when `version` is affected by one OSV `affected` entry. */
export function affected(entry, version) {
  const v = parse(version);
  if (!v) return false;
  if ((entry.versions ?? []).includes(version)) return true;
  for (const range of entry.ranges ?? []) {
    if (range.type !== "SEMVER" && range.type !== "ECOSYSTEM") continue;
    // Events are ordered; each `introduced` opens an interval closed by the next `fixed` or `last_affected`.
    let lo = null;
    for (const e of range.events) {
      if (e.introduced !== undefined)
        lo = e.introduced === "0" ? { nums: [0, 0, 0], pre: [] } : parse(e.introduced);
      else if (e.fixed !== undefined && lo) {
        const hi = parse(e.fixed);
        if (cmp(v, lo) >= 0 && hi && cmp(v, hi) < 0) return true;
        lo = null;
      } else if (e.last_affected !== undefined && lo) {
        const hi = parse(e.last_affected);
        if (cmp(v, lo) >= 0 && hi && cmp(v, hi) <= 0) return true;
        lo = null;
      }
    }
    if (lo && cmp(v, lo) >= 0) return true; // introduced, never fixed
  }
  return false;
}

/** Installed packages: name, version, every lockfile path, and whether all copies are dev-only. */
export function installed(lock) {
  const out = [];
  for (const [path, info] of Object.entries(lock.packages ?? {})) {
    if (!path || info.link || !info.version) continue;
    const i = path.lastIndexOf("node_modules/");
    if (i < 0) continue;
    out.push({ name: info.name ?? path.slice(i + 13), version: info.version, path, dev: Boolean(info.dev) });
  }
  return out;
}

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".json")) yield p;
  }
}

function selfTest() {
  const e = (events) => ({ ranges: [{ type: "SEMVER", events }] });
  const cases = [
    [e([{ introduced: "4.0.0" }, { fixed: "6.4.6" }]), "6.4.5", true],
    [e([{ introduced: "4.0.0" }, { fixed: "6.4.6" }]), "6.4.6", false],
    [e([{ introduced: "4.0.0" }, { fixed: "6.4.6" }]), "3.9.9", false],
    [e([{ introduced: "0" }, { fixed: "1.2.3" }]), "0.0.1", true],
    [e([{ introduced: "1.0.0" }, { last_affected: "1.4.0" }]), "1.4.0", true],
    [e([{ introduced: "1.0.0" }, { last_affected: "1.4.0" }]), "1.4.1", false],
    [
      e([{ introduced: "8.0.0" }, { fixed: "8.1.7" }, { introduced: "8.2.0" }, { fixed: "8.2.5" }]),
      "8.2.0",
      true,
    ],
    [
      e([{ introduced: "8.0.0" }, { fixed: "8.1.7" }, { introduced: "8.2.0" }, { fixed: "8.2.5" }]),
      "8.1.9",
      false,
    ],
    [e([{ introduced: "2.0.0" }]), "9.9.9", true],
    [e([{ introduced: "1.0.0" }, { fixed: "1.0.1" }]), "1.0.1-beta.1", true], // prerelease below the fix
    [e([{ introduced: "1.0.0" }, { fixed: "1.0.1" }]), "1.0.0-rc.1", false], // prerelease below introduced
    [{ versions: ["0.3.2"] }, "0.3.2", true],
  ];
  let bad = 0;
  for (const [entry, v, want] of cases)
    if (affected(entry, v) !== want) {
      bad++;
      console.log("self-test FAIL", v, JSON.stringify(entry));
    }
  console.log(`matcher self-test: ${cases.length - bad}/${cases.length} ok`);
  return bad === 0;
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) process.exit(selfTest() ? 0 : 1);
const [dbDir, lockPath = "package-lock.json"] = args;
if (!dbDir) {
  console.error(
    "usage: advisory-scan.mjs <advisories/github-reviewed dir> [package-lock.json] | --self-test",
  );
  process.exit(2);
}
if (!selfTest()) process.exit(1);
const pkgs = installed(JSON.parse(readFileSync(lockPath, "utf8")));
const byName = new Map();
for (const p of pkgs) (byName.get(p.name) ?? byName.set(p.name, []).get(p.name)).push(p);
let advisories = 0;
let npmAdvisories = 0;
const hits = [];
for (const file of walk(dbDir)) {
  advisories++;
  const a = JSON.parse(readFileSync(file, "utf8"));
  if (a.withdrawn) continue;
  for (const entry of a.affected ?? []) {
    if (entry.package?.ecosystem !== "npm") continue;
    npmAdvisories++;
    for (const p of byName.get(entry.package.name) ?? []) {
      if (!affected(entry, p.version)) continue;
      const fixed = (entry.ranges ?? [])
        .flatMap((r) => r.events)
        .filter((x) => x.fixed)
        .map((x) => x.fixed);
      hits.push({
        id: a.id,
        severity: a.database_specific?.severity ?? "?",
        package: p.name,
        version: p.version,
        path: p.path,
        dev: p.dev,
        fixed,
        summary: a.summary,
      });
    }
  }
}
console.log(`advisories read: ${advisories} (reviewed); npm package entries: ${npmAdvisories}`);
console.log(`installed package copies checked: ${pkgs.length} (${byName.size} distinct names)`);
console.log(`matches: ${hits.length}`);
for (const h of hits)
  console.log(
    `  ${h.id} ${h.severity} ${h.package}@${h.version} ${h.dev ? "dev" : "PROD"} ${h.path} fixed:[${h.fixed.join(", ")}] ${h.summary}`,
  );
process.exit(hits.length ? 1 : 0);
