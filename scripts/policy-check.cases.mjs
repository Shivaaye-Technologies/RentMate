// Self-test cases for scripts/policy-check.mjs: what the guard must catch (fail: true) and what it must allow
// (fail: false). Strings that look like secrets are built at runtime so this file never contains one.
const A36 = "A".repeat(36);
const mig = (version, sql) => ({ path: `supabase/migrations/${version}_example.sql`, content: sql });

export const CASES = [
  // ---- Secrets and .env (must catch)
  { path: "a.ts", content: `t = "ghp_${A36}"`, fail: true, note: "real-format GitHub token" },
  {
    path: "a.ts",
    content: `t = "github_pat_${"a1".repeat(41)}"`,
    fail: true,
    note: "fine-grained GitHub token",
  },
  { path: "a.ts", content: `k = "sb_secret_${"x".repeat(30)}"`, fail: true, note: "Supabase secret key" },
  { path: "a.ts", content: `k = "sk_live_${"Z".repeat(24)}"`, fail: true, note: "Stripe live key" },
  { path: "a.ts", content: "-----BEGIN OPENSSH PRIVATE KEY-----", fail: true, note: "private key" },
  {
    path: "a.ts",
    content: `j = "eyJ${"a".repeat(40)}.eyJ${"b".repeat(80)}.${"c".repeat(43)}"`,
    fail: true,
    note: "long JWT (service key)",
  },
  { path: "apps/api/.env.production", content: "A=1", fail: true, note: ".env variant" },
  // Secrets: must allow
  {
    path: "a.ts",
    content: 'const fake = "ghp_ShouldNeverBeLogged";',
    fail: false,
    note: "fake token fixture",
  },
  { path: ".env.example", content: "LIVEKIT_API_KEY=", fail: false, note: ".env.example names only" },

  // ---- Media (must catch, by extension and by content)
  { path: "photo.JPG", fail: true, note: "uppercase image extension" },
  { path: "clip.webm", fail: true, note: "video extension" },
  { path: "notes.bin", bytes: [0xff, 0xd8, 0xff, 0xe0, 0, 0x10], fail: true, note: "JPEG renamed to .bin" },
  { path: "data.dat", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a], fail: true, note: "PNG renamed to .dat" },
  {
    path: "video.txt",
    bytes: [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32],
    fail: true,
    note: "MP4 renamed to .txt",
  },
  { path: "x.svg", content: "<svg><script>alert(1)</script></svg>", fail: true, note: "SVG with script" },
  {
    path: "x.svg",
    content: '<svg><image href="https://x.example/a.png"/></svg>',
    fail: true,
    note: "SVG remote image",
  },
  // Media: must allow
  {
    path: "x.svg",
    content: '<svg><circle r="3"/><text>RM</text></svg>',
    fail: false,
    note: "plain SVG drawing",
  },
  {
    path: "readme.md",
    bytes: [0x23, 0x20, 0x52, 0x4d],
    content: "# RM",
    fail: false,
    note: "ordinary text file",
  },

  // ---- Adult wording (must catch)
  { path: "a.tsx", content: "<h1>Hot porn tonight</h1>", fail: true, note: "porn" },
  { path: "a.tsx", content: "No limits porn here", fail: true, note: "porn after 'no' (old loophole)" },
  {
    path: "a.md",
    content: "Without limits: xxx videos",
    fail: true,
    note: "xxx after 'without' (old loophole)",
  },
  { path: "a.md", content: "Watch p0rn free", fail: true, note: "leetspeak p0rn" },
  { path: "a.md", content: "Best NSFW streams", fail: true, note: "NSFW" },
  { path: "a.md", content: "Book an escort tonight", fail: true, note: "escort advert" },
  { path: "a.md", content: "Join my OnlyFans", fail: true, note: "OnlyFans" },
  { path: "a.md", content: "Send nudes", fail: true, note: "nudes" },
  { path: "a.md", content: "Sexual services available", fail: true, note: "sexual services offer" },
  { path: "a.md", content: "Cash for sex", fail: true, note: "solicitation" },
  // Adult wording: must allow
  {
    path: "a.md",
    content: "RentMate does not support pornographic content.",
    fail: false,
    note: "prohibition",
  },
  {
    path: "a.md",
    content: "Escorting and sexual services are prohibited.",
    fail: false,
    note: "prohibition 2",
  },
  { path: "a.md", content: "We never allow nudity.", fail: false, note: "prohibition 3" },
  { path: "a.md", content: "18+ only · No sexual services of any kind", fail: false, note: "landing rule" },
  { path: "a.md", content: "Live in Essex, love Sussex and Middlesex", fail: false, note: "place names" },
  { path: "a.md", content: "Pornic is a town in France", fail: false, note: "Pornic (word boundary)" },
  { path: "a.md", content: "The xxxl t-shirt size", fail: false, note: "xxxl" },
  {
    path: "a.md",
    content: "| Physical-safety abuse (escorting, trafficking) | Critical |",
    fail: false,
    note: "risk row",
  },

  {
    path: "t.sql",
    content: "update profiles set bio = 'Escort services' -- policy-guard: allow (refusal test)",
    fail: false,
    note: "explicit allow marker on a refusal test",
  },
  {
    path: "t.sql",
    content: `k = 'sb_secret_${"x".repeat(30)}' -- policy-guard: allow`,
    fail: true,
    note: "allow marker never exempts secrets",
  },

  // ---- Migrations (must catch)
  {
    ...mig("20261120000000", "delete from public.content_categories where explicit;"),
    fail: true,
    note: "deletes data",
  },
  { ...mig("20261120000000", "truncate public.messages;"), fail: true, note: "truncate" },
  {
    ...mig("20261120000000", "select 1;  TRUNCATE TABLE public.likes;"),
    fail: true,
    note: "truncate after ;",
  },
  {
    ...mig("20261120000000", "do $$ begin execute 'truncate public.likes'; end $$;"),
    fail: true,
    note: "dynamic truncate",
  },
  {
    ...mig("20261120000000", "do $$ begin execute format('truncate %I', 'likes'); end $$;"),
    fail: true,
    note: "dynamic truncate via format",
  },
  {
    ...mig(
      "20261120000000",
      "revoke truncate, references, trigger on public.likes from anon, authenticated;",
    ),
    fail: false,
    note: "revoking the truncate privilege is allowed",
  },
  { ...mig("20261120000000", "drop table public.reports;"), fail: true, note: "drop table" },
  {
    ...mig("20261120000000", "alter table public.profiles drop column bio;"),
    fail: true,
    note: "drop column",
  },
  {
    ...mig("20261120000000", "alter table public.country_policies drop constraint no_adult_content;"),
    fail: true,
    note: "removes no-adult constraint",
  },
  {
    ...mig("20261120000000", "drop trigger creators_no_adult_content on public.creators;"),
    fail: true,
    note: "removes no-adult trigger",
  },
  {
    ...mig("20261120000000", "update public.content_categories set available = true;"),
    fail: true,
    note: "re-enables adult category",
  },
  {
    ...mig("20261120000000", "alter table public.x disable trigger all;"),
    fail: true,
    note: "disable trigger",
  },
  {
    path: "supabase/migrations/new_thing.sql",
    content: "select 1;",
    fail: true,
    note: "badly named migration",
  },
  {
    set: [
      "supabase/migrations/20261118090000_no_adult_content.sql",
      "supabase/migrations/20261118120000_no_adult_content.sql",
    ],
    fail: true,
    note: "duplicate migration name",
  },
  {
    set: ["supabase/migrations/20261118090000_a.sql", "supabase/migrations/20261118090000_b.sql"],
    fail: true,
    note: "duplicate migration version",
  },
  // Migrations: must allow
  {
    ...mig("20261120000000", "-- Never: delete from or drop table.\ncreate table public.t (id int);"),
    fail: false,
    note: "comment describing forbidden statements",
  },
  {
    ...mig("20261023101049", "delete from public.reports where false;"),
    fail: false,
    note: "older reviewed migration (history)",
  },
  {
    set: ["supabase/migrations/20261118090000_a.sql", "supabase/migrations/20261118100000_b.sql"],
    fail: false,
    note: "unique migrations",
  },
  // Migration order (batches = files added per commit, oldest first)
  {
    order: [
      ["supabase/migrations/20261123100000_integration_secret_strength.sql"],
      ["supabase/migrations/20261121120000_made_today.sql"],
    ],
    fail: true,
    note: "migration added later but dated before an existing one",
  },
  {
    order: [["supabase/migrations/20261123100000_a.sql"], ["supabase/migrations/20261123100000_b.sql"]],
    fail: true,
    note: "migration added later with the same version",
  },
  {
    order: [
      ["supabase/migrations/20261121090000_a.sql", "supabase/migrations/20261121100000_b.sql"],
      ["supabase/migrations/20261123090000_c.sql"],
    ],
    fail: false,
    note: "migrations added in version order (several in one commit)",
  },
  {
    order: [
      ["supabase/migrations/20261121100000_b.sql", "supabase/migrations/20261121090000_a.sql"],
      ["supabase/migrations/20261124000000_d.sql"],
    ],
    fail: false,
    note: "one commit may add several migrations in any listing order",
  },
  // Order derived from `git log --name-status` (renames keep the position of the original addition)
  {
    log: "@@\n\nA\tsupabase/migrations/20261023000000_init.sql\n@@\n\nA\tsupabase/migrations/20261023095502_x.sql\n@@\n\nR100\tsupabase/migrations/20261023000000_init.sql\tsupabase/migrations/20261022210236_init.sql\n",
    all: ["supabase/migrations/20261022210236_init.sql", "supabase/migrations/20261023095502_x.sql"],
    fail: false,
    note: "renamed migration keeps its original position",
  },
  {
    // H-1: demo_mode_public renamed to the version production recorded (20261023165729).
    log: "@@\n\nA\tsupabase/migrations/20261023121400_demo_profiles_testers.sql\n@@\n\nA\tsupabase/migrations/20261023170000_demo_mode_public.sql\n@@\n\nA\tsupabase/migrations/20261024090000_profile_details.sql\n@@\n\nR100\tsupabase/migrations/20261023170000_demo_mode_public.sql\tsupabase/migrations/20261023165729_demo_mode_public.sql\n",
    all: [
      "supabase/migrations/20261023121400_demo_profiles_testers.sql",
      "supabase/migrations/20261023165729_demo_mode_public.sql",
      "supabase/migrations/20261024090000_profile_details.sql",
    ],
    fail: false,
    note: "rename to the production version keeps the order valid",
  },
  {
    log: "@@\n\nA\tsupabase/migrations/20261123100000_a.sql\n",
    all: ["supabase/migrations/20261123100000_a.sql", "supabase/migrations/20261121000000_new.sql"],
    fail: true,
    note: "uncommitted migration dated before the newest committed one",
  },
  {
    log: "@@\n\nA\tsupabase/migrations/20261123100000_a.sql\n",
    all: ["supabase/migrations/20261123100000_a.sql", "supabase/migrations/20261124000000_new.sql"],
    fail: false,
    note: "uncommitted migration dated after the newest committed one",
  },
  // Dependency floors
  {
    lock: { packages: { "node_modules/vite": { version: "6.4.5" } } },
    fail: true,
    note: "vite 6.4.5 (GHSA-p4f5-76q4-ffq7)",
  },
  {
    lock: { packages: { "node_modules/vitest/node_modules/vite": { version: "6.2.0" } } },
    fail: true,
    note: "nested vulnerable vite copy",
  },
  {
    lock: { packages: { "node_modules/vite": { version: "6.4.6" } } },
    fail: false,
    note: "vite 6.4.6",
  },
  {
    lock: { packages: { "node_modules/@vitejs/plugin-react": { version: "4.7.0" } } },
    fail: false,
    note: "different package whose path contains vite",
  },
];
