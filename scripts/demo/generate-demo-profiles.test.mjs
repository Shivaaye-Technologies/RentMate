import assert from "node:assert/strict";
import { test } from "node:test";
import {
  avatarSvg,
  buildProfiles,
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
  assert.equal((sql.match(/, true\)(,|\n)/g) ?? []).length, 100);
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
