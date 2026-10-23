#!/usr/bin/env node
// Generates the fictional demo profiles used for testing SOULMATE.AI.
//
//   node scripts/demo/generate-demo-profiles.mjs [--female 50] [--male 50]
//        [--lat 28.61] [--lng 77.21] [--radius-km 15] [--seed 42]
//
// Writes (all deterministic for the same options):
//   apps/web/public/demo/avatars/NNN.svg     illustrated portraits ("Personas" by Draftbit, CC BY 4.0)
//   supabase/seed/demo_profiles.sql          repeatable seed (safe to run again)
//
// Every person here is invented. No photo or detail comes from a real person.
// Demo profiles are visible only to tester accounts (see the demo migration).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAvatar } from "@dicebear/core";
import * as personas from "@dicebear/personas";

export const DEFAULTS = { female: 50, male: 50, lat: 28.61, lng: 77.21, radiusKm: 15, seed: 42 };
export const MIN_AGE = 18;
export const MAX_AGE = 45;

const FEMALE_NAMES = [
  "Aanya",
  "Priya",
  "Meera",
  "Ishita",
  "Kavya",
  "Riya",
  "Sara",
  "Zoya",
  "Nisha",
  "Tara",
  "Ananya",
  "Diya",
  "Neha",
  "Pooja",
  "Simran",
  "Aisha",
  "Fatima",
  "Noor",
  "Leela",
  "Maya",
  "Elena",
  "Sofia",
  "Chloe",
  "Emma",
  "Olivia",
  "Hana",
  "Yuki",
  "Mei",
  "Lina",
  "Amara",
  "Zara",
  "Ines",
  "Clara",
  "Nadia",
  "Laila",
  "Ritu",
  "Sneha",
  "Tanvi",
  "Kiara",
  "Myra",
  "Anjali",
  "Shreya",
  "Rhea",
  "Pari",
  "Jasmine",
  "Grace",
  "Isla",
  "Leah",
  "Naina",
  "Sana",
];
const MALE_NAMES = [
  "Arjun",
  "Rohan",
  "Kabir",
  "Vivaan",
  "Aditya",
  "Karan",
  "Rahul",
  "Ishaan",
  "Dev",
  "Aarav",
  "Nikhil",
  "Siddharth",
  "Varun",
  "Yash",
  "Kunal",
  "Aman",
  "Rehan",
  "Imran",
  "Zayan",
  "Omar",
  "Samir",
  "Farhan",
  "Neil",
  "Ryan",
  "Ethan",
  "Lucas",
  "Noah",
  "Leo",
  "Mateo",
  "Daniel",
  "Kenji",
  "Hiro",
  "Wei",
  "Jin",
  "Arman",
  "Tariq",
  "Vikram",
  "Manav",
  "Harsh",
  "Pranav",
  "Abhay",
  "Rishi",
  "Ayaan",
  "Vihaan",
  "Gabriel",
  "Adrian",
  "Kian",
  "Elias",
  "Sahil",
  "Jai",
];

export const INTERESTS = [
  "Hiking",
  "Music",
  "Travel",
  "Cooking",
  "Movies",
  "Photography",
  "Yoga",
  "Gaming",
  "Books",
  "Coffee",
  "Dancing",
  "Cricket",
  "Football",
  "Art",
  "Fitness",
  "Street food",
  "Startups",
  "Anime",
  "Dogs",
  "Cats",
  "Running",
  "Live music",
  "Poetry",
  "Board games",
  "Cycling",
  "Gardening",
  "Fashion",
  "Tech",
  "Stand-up comedy",
  "Road trips",
  "Baking",
  "Swimming",
];

const OPENERS = [
  "Weekend explorer and weekday planner.",
  "Part-time optimist, full-time snack enthusiast.",
  "Recently moved to the city and saying yes to new things.",
  "Engineer by day, amateur chef by night.",
  "I teach during the week and wander on weekends.",
  "Designer who notices fonts on restaurant menus.",
  "Morning person, apparently a rare species.",
  "Doctor in training, so coffee is a personality trait.",
  "Marketing by profession, storyteller by habit.",
  "Small-town roots, big-city curiosity.",
  "Finance job, creative soul.",
  "I write code and terrible puns.",
  "Lawyer who argues mostly about the best biryani.",
  "Fresh graduate figuring life out one cafe at a time.",
  "Architect who sketches strangers' houses on trains.",
  "Nurse with a soft spot for old songs.",
  "Startup founder who still makes time for sunsets.",
  "Musician on weekends, accountant on weekdays.",
  "Introvert with an extrovert's playlist.",
  "Bookworm who reads the last page first.",
  "Product manager with too many browser tabs open.",
  "Photographer chasing golden hour.",
  "Student of everything, master of nothing yet.",
  "Data analyst who keeps a spreadsheet of favourite dosas.",
  "Physiotherapist who will fix your posture on the first date.",
];
const MIDDLES = [
  "You'll usually find me into {a} or talking about {b}.",
  "Big fan of {a}, and lately I can't stop talking about {b}.",
  "My perfect Sunday involves {a}, {b}, and zero alarms.",
  "Ask me about {a} — fair warning, I might not stop.",
  "Currently learning more about {b} and loving {a}.",
  "Nothing beats {a}, and {b} is a close second.",
  "I'm happiest with {a}, good company and a bit of {b}.",
  "Looking for someone who'd join me for {a} or show me more {b}.",
  "Two things I'd never give up: {a} and {b}.",
  "If there's {a} involved, count me in. {b} too.",
];
const CLOSERS = [
  "Let's swap recommendations.",
  "Tell me your go-to comfort food.",
  "Bonus points if you can make me laugh.",
  "Kindness and good conversation over everything.",
  "Looking for real conversations, not small talk.",
  "Let's find the best chai in town together.",
  "I'll judge you only on your playlist.",
  "Say hi with your favourite movie.",
  "Here for honest, easy-going vibes.",
  "Let's plan something spontaneous.",
  "Good listener, better storyteller.",
  "First coffee is on whoever replies faster.",
];

const FEMALE_HAIR = [
  "long",
  "bobCut",
  "curlyBun",
  "bobBangs",
  "extraLong",
  "straightBun",
  "curly",
  "bunUndercut",
  "pigtails",
];
const MALE_HAIR = [
  "shortCombover",
  "curlyHighTop",
  "buzzcut",
  "fade",
  "sideShave",
  "shortComboverChops",
  "curly",
  "balding",
  "beanie",
  "cap",
];
// Mostly natural shades (dark, brown, auburn), with a few dyed colours.
const HAIR_COLORS = [
  "362c47",
  "362c47",
  "362c47",
  "6c4545",
  "6c4545",
  "6c4545",
  "f29c65",
  "e15c66",
  "f27d65",
  "e16381",
];
const BACKGROUNDS = ["f3e9dc", "e6dcf7", "d9efe2", "fbe8b5", "f7d9d9", "dbe7f6"];

/** Small seeded PRNG (mulberry32), so output is identical for the same seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
function sample(r, list, n) {
  const copy = [...list];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
  return out;
}

/** Stable UUID for demo profile number n, so re-running the seed updates the same rows. */
export function demoId(n) {
  const h = createHash("sha1").update(`soulmate-ai-demo-profile-${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Ages 18–45: about 70% between 21 and 34, the rest anywhere in the range. */
function pickAge(r) {
  return r() < 0.7 ? 21 + Math.floor(r() * 14) : MIN_AGE + Math.floor(r() * (MAX_AGE - MIN_AGE + 1));
}

/** Random point within radiusKm of the center, rounded to 2 decimals (~1 km) like real profiles. */
function pickLocation(r, lat, lng, radiusKm) {
  const d = radiusKm * Math.sqrt(r());
  const theta = 2 * Math.PI * r();
  const dLat = (d / 111.32) * Math.cos(theta);
  const dLng = (d / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(theta);
  return { lat: Math.round((lat + dLat) * 100) / 100, lng: Math.round((lng + dLng) * 100) / 100 };
}

export function buildProfiles(options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (o.female > FEMALE_NAMES.length || o.male > MALE_NAMES.length) {
    throw new Error(`At most ${FEMALE_NAMES.length} female and ${MALE_NAMES.length} male profiles`);
  }
  const r = rng(o.seed);
  const genders = [...Array(o.female).fill("female"), ...Array(o.male).fill("male")];
  // Interleave so the card stack alternates naturally.
  const order = sample(
    r,
    genders.map((g, i) => ({ g, i })),
    genders.length,
  );
  const femaleNames = sample(r, FEMALE_NAMES, o.female);
  const maleNames = sample(r, MALE_NAMES, o.male);
  const bios = new Set();

  return order.map(({ g }, idx) => {
    const n = idx + 1;
    const name = g === "female" ? femaleNames.pop() : maleNames.pop();
    const age = pickAge(r);
    const interests = sample(r, INTERESTS, 3 + Math.floor(r() * 4));
    let bio;
    do {
      const [a, b] = sample(r, interests, 2).map((s) => s.toLowerCase());
      const middle = pick(r, MIDDLES).replace("{a}", a).replace("{b}", b);
      bio = `${pick(r, OPENERS)} ${middle.charAt(0).toUpperCase() + middle.slice(1)} ${pick(r, CLOSERS)}`;
    } while (bios.has(bio));
    bios.add(bio);
    const roll = r();
    const lookingFor = roll < 0.5 ? "relationship" : roll < 0.8 ? "friendship" : "casual";
    return {
      n,
      id: demoId(n),
      email: `demo-${String(n).padStart(3, "0")}@demo.soulmate.invalid`,
      gender: g,
      displayName: name,
      age,
      bio,
      interests,
      lookingFor,
      ageMin: Math.max(MIN_AGE, age - 8),
      ageMax: Math.min(60, age + 10),
      ...pickLocation(r, o.lat, o.lng, o.radiusKm),
      verified: r() < 0.3,
      joinedHoursAgo: Math.floor(r() * 24 * 30),
      seenMinutesAgo: Math.floor(r() * 60 * 24 * 3),
      photoPath: `demo/avatars/${String(n).padStart(3, "0")}.svg`,
      avatar: {
        hair: pick(r, g === "female" ? FEMALE_HAIR : MALE_HAIR),
        facialHair: g === "male" && r() < 0.45,
        skin: Math.floor(r() * 7),
        background: pick(r, BACKGROUNDS),
        hairColor: age >= 40 && r() < 0.4 ? "dee1f5" : pick(r, HAIR_COLORS),
        eyes: r() < 0.2 ? "glasses" : pick(r, ["open", "happy", "open", "wink"]),
        mouth: pick(r, g === "female" ? ["smile", "bigSmile", "lips"] : ["smile", "bigSmile", "smirk"]),
      },
    };
  });
}

const SKIN = ["eeb4a4", "e7a391", "e5a07e", "d78774", "b16a5b", "92594b", "623d36"];

export function avatarSvg(p) {
  return createAvatar(personas, {
    seed: p.id,
    hair: [p.avatar.hair],
    facialHairProbability: p.avatar.facialHair ? 100 : 0,
    skinColor: [SKIN[p.avatar.skin]],
    hairColor: [p.avatar.hairColor],
    mouth: [p.avatar.mouth],
    eyes: [p.avatar.eyes],
    nose: ["smallRound", "mediumRound"],
    backgroundColor: [p.avatar.background],
  }).toString();
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const textArray = (items) => `array[${items.map(q).join(", ")}]::text[]`;

export function seedSql(profiles, o = DEFAULTS) {
  const users = profiles
    .map(
      (p) =>
        `  (${q(p.id)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${q(p.email)}, ` +
        `'{"provider":"email","providers":["email"],"demo":true}'::jsonb, '{}'::jsonb, ` +
        `now() - interval '${p.joinedHoursAgo} hours', now(), '', '', '', '')`,
    )
    .join(",\n");
  const rows = profiles
    .map(
      (p) =>
        `  (${q(p.id)}, ${q(p.displayName)}, ${p.age}, ${q(p.bio)}, ${textArray(p.interests)}, ${q(p.lookingFor)}, ` +
        `${p.ageMin}, ${p.ageMax}, ${q(p.photoPath)}, ${p.lat}, ${p.lng}, ` +
        `now() - interval '${p.seenMinutesAgo} minutes', ${p.verified}, now() - interval '${p.joinedHoursAgo} hours', true)`,
    )
    .join(",\n");
  return `-- GENERATED by scripts/demo/generate-demo-profiles.mjs — do not edit by hand.
-- ${profiles.length} fictional demo profiles (${profiles.filter((p) => p.gender === "female").length} female, ${profiles.filter((p) => p.gender === "male").length} male), ages ${MIN_AGE}-${MAX_AGE},
-- around ${o.lat}, ${o.lng} (radius ${o.radiusKm} km). Visible only to tester accounts.
-- Safe to run more than once: rows are matched on fixed ids and updated.
-- Demo accounts have no password and an undeliverable email, so nobody can sign in as them.
-- Run in the Supabase SQL Editor (or psql) as the database owner. Remove with demo_cleanup.sql.
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
${users}
on conflict (id) do nothing;

insert into public.profiles (id, display_name, age, bio, interests, looking_for, age_min, age_max,
  photo_path, lat, lng, last_seen_at, verified, created_at, is_demo)
values
${rows}
on conflict (id) do update set
  display_name = excluded.display_name, age = excluded.age, bio = excluded.bio,
  interests = excluded.interests, looking_for = excluded.looking_for,
  age_min = excluded.age_min, age_max = excluded.age_max, photo_path = excluded.photo_path,
  lat = excluded.lat, lng = excluded.lng, last_seen_at = excluded.last_seen_at,
  verified = excluded.verified, created_at = excluded.created_at, is_demo = true;

commit;

select count(*) as demo_profiles from public.profiles where is_demo;
`;
}

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  const keys = {
    "--female": "female",
    "--male": "male",
    "--lat": "lat",
    "--lng": "lng",
    "--radius-km": "radiusKm",
    "--seed": "seed",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys[argv[i]];
    const value = Number(argv[i + 1]);
    if (!key || !Number.isFinite(value))
      throw new Error(`Unknown or invalid option: ${argv[i]} ${argv[i + 1] ?? ""}`);
    o[key] = value;
  }
  return o;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const o = parseArgs(process.argv.slice(2));
  const profiles = buildProfiles(o);
  const avatarDir = join(root, "apps/web/public/demo/avatars");
  mkdirSync(avatarDir, { recursive: true });
  for (const p of profiles) writeFileSync(join(root, "apps/web/public", p.photoPath), avatarSvg(p));
  mkdirSync(join(root, "supabase/seed"), { recursive: true });
  writeFileSync(join(root, "supabase/seed/demo_profiles.sql"), seedSql(profiles, o));
  console.log(`Wrote ${profiles.length} demo profiles and avatars.`);
}
