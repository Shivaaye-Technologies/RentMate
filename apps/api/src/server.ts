import type { Request } from "express";
import { createApp, type ProfileStore } from "./app.js";
import { supabaseVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { MemoryProfileStore } from "./store.js";
import { SupabaseProfileStore } from "./supabaseStore.js";
import { SupabaseAccountDeleter } from "./account.js";
import { buildRegistry } from "./live/providers.js";
import { SupabaseIntegrationStore, SupabaseLiveStore } from "./live/store.js";
import { drainKicks } from "./live/webhook.js";
import { GooglePlayClient, parseServiceAccount } from "./billing/googlePlay.js";
import { SupabaseBillingStore } from "./billing/store.js";

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

const accountFor = supabaseReady
  ? (req: Request) => new SupabaseAccountDeleter(SUPABASE_URL!, SUPABASE_ANON_KEY!, req.accessToken!)
  : undefined;

// Google Play Billing: verified on the server with a service account; the database decides what is credited.
// Fails closed: any missing setting leaves the billing routes answering 503.
const billing =
  supabaseReady &&
  config.GOOGLE_PLAY_PACKAGE_NAME &&
  config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON &&
  config.BILLING_DB_SECRET &&
  config.GOOGLE_PLAY_RTDN_TOKEN
    ? {
        play: new GooglePlayClient(
          config.GOOGLE_PLAY_PACKAGE_NAME,
          parseServiceAccount(config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON),
        ),
        store: new SupabaseBillingStore(SUPABASE_URL!, SUPABASE_ANON_KEY!, config.BILLING_DB_SECRET),
        packageName: config.GOOGLE_PLAY_PACKAGE_NAME,
        rtdnToken: config.GOOGLE_PLAY_RTDN_TOKEN,
      }
    : null;

const app = createApp({
  config,
  verifyToken,
  storeFor,
  live,
  webhook: { providers, integration },
  accountFor,
  billing,
  readinessCheck: async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
    try {
      const response = await fetch(new URL("/auth/v1/health", SUPABASE_URL), {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  },
});

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

const server = app.listen(config.PORT, () => {
  // Logs the port the socket actually bound, not values copied from the configuration.
  const address = server.address();
  console.log(`[api] listening on port ${typeof address === "object" && address ? address.port : "?"}`);
});
