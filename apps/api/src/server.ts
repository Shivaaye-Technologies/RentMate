import type { Request } from "express";
import { createApp, type ProfileStore } from "./app.js";
import { supabaseVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { MemoryProfileStore } from "./store.js";
import { SupabaseProfileStore } from "./supabaseStore.js";
import { buildRegistry } from "./live/providers.js";
import { SupabaseIntegrationStore, SupabaseLiveStore } from "./live/store.js";
import { drainKicks } from "./live/webhook.js";

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

// LiveKit webhooks and the room-removal queue: a narrow database capability, never a privileged key.
const integration =
  supabaseReady && config.LIVE_WEBHOOK_DB_SECRET
    ? new SupabaseIntegrationStore(SUPABASE_URL!, SUPABASE_ANON_KEY!, config.LIVE_WEBHOOK_DB_SECRET)
    : null;

const app = createApp({ config, verifyToken, storeFor, live, webhook: { providers, integration } });

// Remove blocked, suspended or removed people from rooms they are already in (every 3 seconds).
if (integration && providers.get("livekit")?.configured) {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    drainKicks(providers, integration)
      .catch((err) => console.error("[api] room removal failed:", err instanceof Error ? err.message : err))
      .finally(() => {
        running = false;
      });
  }, 3000).unref();
}

app.listen(config.PORT, () => {
  console.log(`[api] listening on port ${config.PORT} (${config.NODE_ENV})`);
});
