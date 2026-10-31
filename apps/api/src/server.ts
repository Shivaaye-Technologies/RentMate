import type { Request } from "express";
import { createApp, type ProfileStore } from "./app.js";
import { supabaseVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { MemoryProfileStore } from "./store.js";
import { SupabaseProfileStore } from "./supabaseStore.js";
import { buildRegistry } from "./live/providers.js";
import { SupabaseLiveStore } from "./live/store.js";

const config = loadConfig();
const { SUPABASE_URL, SUPABASE_ANON_KEY } = config;
const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const verifyToken = supabaseReady ? supabaseVerifier(SUPABASE_URL!, SUPABASE_ANON_KEY!) : null;

if (!supabaseReady) {
  console.warn("[api] Supabase not configured; /api/v1 routes will return 503.");
}

// Development only: without Supabase every protected route returns 503 anyway,
// so this in-memory store is reachable only from tests or a patched local setup.
const memory = new MemoryProfileStore();

const storeFor = (req: Request): ProfileStore =>
  supabaseReady && req.accessToken
    ? new SupabaseProfileStore(SUPABASE_URL!, SUPABASE_ANON_KEY!, req.accessToken)
    : memory;

// SOULMATE LIVE: provider credentials come only from server environment variables.
const providers = buildRegistry(config);
const live = supabaseReady
  ? {
      providers,
      countryHeader: config.LIVE_COUNTRY_HEADER ?? null,
      liveStoreFor: (req: Request) =>
        new SupabaseLiveStore(SUPABASE_URL!, SUPABASE_ANON_KEY!, req.accessToken!),
    }
  : undefined;

const app = createApp({ config, verifyToken, storeFor, live });

app.listen(config.PORT, () => {
  console.log(`[api] listening on port ${config.PORT} (${config.NODE_ENV})`);
});
