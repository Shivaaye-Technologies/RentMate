import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  avatarSvg,
  buildAllProfiles,
  buildExtraProfiles,
  buildProfiles,
  MAX_DEMO_PROFILES,
  trimSql,
  DEFAULTS,
  demoId,
  MAX_AGE,
  MIN_AGE,
  seedSql,
} from "./generate-demo-profiles.mjs";

const profiles = buildProfiles();

test("100 profiles, 50 female and 50 male by default", () => {
  assert.equal(profiles.length, 100);
  assert.equal(profiles.filter((p) => p.gender === "female").length, 50);
  assert.equal(profiles.filter((p) => p.gender === "male").length, 50);
});

test("everyone is an adult between 18 and 45, with a valid age range", () => {
  for (const p of profiles) {
    assert.ok(p.age >= MIN_AGE && p.age <= MAX_AGE, `${p.displayName} is ${p.age}`);
    assert.ok(p.ageMin >= 18 && p.ageMin <= p.ageMax && p.ageMax <= 100);
  }
});

test("names, ids, emails, bios and photos are unique", () => {
  for (const key of ["displayName", "id", "email", "bio", "photoPath"]) {
    assert.equal(new Set(profiles.map((p) => p[key])).size, profiles.length, key);
  }
});

test("fields satisfy the database constraints", () => {
  for (const p of profiles) {
    assert.ok(p.displayName.length >= 2 && p.displayName.length <= 40);
    assert.ok(p.bio.length > 0 && p.bio.length <= 500);
    assert.ok(p.interests.length >= 3 && p.interests.length <= 6);
    assert.ok(["relationship", "friendship", "casual"].includes(p.lookingFor));
    assert.ok(p.photoPath.length <= 200);
    assert.match(p.email, /@demo\.soulmate\.invalid$/);
  }
});

test("locations stay near the chosen city", () => {
  for (const p of profiles) {
    assert.ok(Math.abs(p.lat - DEFAULTS.lat) < 0.2 && Math.abs(p.lng - DEFAULTS.lng) < 0.2);
  }
});

test("the mix is configurable and output is deterministic", () => {
  const custom = buildProfiles({ female: 30, male: 20 });
  assert.equal(custom.length, 50);
  assert.equal(custom.filter((p) => p.gender === "male").length, 20);
  assert.deepEqual(buildProfiles(), profiles);
  assert.equal(demoId(1), demoId(1));
  assert.match(demoId(1), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("seed SQL marks every profile as demo and is repeatable", () => {
  const sql = seedSql(profiles);
  assert.equal((sql.match(/, true, null\)(,|\n)/g) ?? []).length, 100);
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /on conflict \(id\) do update set/);
  assert.doesNotMatch(sql, /encrypted_password/);
});

test("avatars are self-contained SVGs", () => {
  const svg = avatarSvg(profiles[0]);
  assert.match(svg, /^<svg/);
  // No external images or links are loaded; the license credit stays in the metadata.
  assert.doesNotMatch(svg, /<image|href=|<script/i);
  assert.match(svg, /CC BY 4\.0/);
});

// The first 100 are live in production; generating more must never change them.
// Checksum verified against the production database on 2026-10-23.
test("the base 100 never change", () => {
  const rows = [...buildAllProfiles({ count: 300 }).slice(0, 100)].sort((a, b) => (a.id < b.id ? -1 : 1));
  const text = rows
    .map((x) =>
      [
        x.id,
        x.displayName,
        x.age,
        x.bio,
        x.interests.join(","),
        x.lookingFor,
        x.ageMin,
        x.ageMax,
        x.photoPath,
        x.lat.toFixed(2),
        x.lng.toFixed(2),
        String(x.verified),
      ].join("|"),
    )
    .join("\n");
  assert.equal(createHash("md5").update(text).digest("hex"), "413befef40b7ae5e5e02de2125a6d246");
});

test("extra profiles are appended without duplicates and stay stable", () => {
  const all = buildAllProfiles();
  assert.equal(all.length, DEFAULTS.count);
  for (const key of ["id", "email", "displayName", "bio", "photoPath"]) {
    assert.equal(new Set(all.map((p) => p[key])).size, all.length, key);
  }
  const bigger = buildAllProfiles({ count: 220 });
  assert.deepEqual(bigger.slice(0, all.length), all);
  for (const p of all.slice(100)) {
    assert.ok(p.age >= MIN_AGE && p.age <= MAX_AGE);
    assert.match(p.displayName, /^[A-Z][a-z]+ [A-Z]\.$/);
    assert.ok(p.interests.length >= 3 && p.bio.length <= 500);
  }
});

test("extra profiles are released a few per day from the start date", () => {
  const extra = buildExtraProfiles(buildProfiles(), { count: 112, perDay: 5, start: "2026-11-01" });
  assert.equal(extra.length, 12);
  assert.deepEqual(
    [...new Set(extra.map((p) => p.releaseAt))],
    ["2026-11-01T06:30:00.000Z", "2026-11-02T06:30:00.000Z", "2026-11-03T06:30:00.000Z"],
  );
  assert.ok(buildProfiles().every((p) => p.releaseAt === null));
});

test("limits are enforced", () => {
  const base = buildProfiles();
  assert.throws(() => buildExtraProfiles(base, { count: MAX_DEMO_PROFILES + 1 }), /--count/);
  assert.throws(() => buildExtraProfiles(base, { count: 99 }), /--count/);
  assert.throws(() => buildExtraProfiles(base, { perDay: 0 }), /--per-day/);
  assert.throws(() => buildExtraProfiles(base, { start: "soon" }), /--start/);
  assert.throws(() => buildExtraProfiles(base, { femaleShare: 2 }), /--female-share/);
});

test("trim SQL only matches reserved demo accounts above the limit", () => {
  const sql = trimSql(120);
  assert.ok(sql.includes("@demo\\.soulmate\\.invalid$'"));
  assert.match(sql, /::int > 120/);
  assert.match(sql, /p\.is_demo/);
});
