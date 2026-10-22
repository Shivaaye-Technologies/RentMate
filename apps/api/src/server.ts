import { createApp } from "./app.js";
import { supabaseVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { MemoryProfileStore } from "./store.js";

const config = loadConfig();
const verifyToken =
  config.SUPABASE_URL && config.SUPABASE_ANON_KEY
    ? supabaseVerifier(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
    : null;

if (!verifyToken) {
  console.warn("[api] Supabase auth not configured; /api/v1 routes will return 503.");
}

const app = createApp({ config, verifyToken, store: new MemoryProfileStore() });

app.listen(config.PORT, () => {
  console.log(`[api] listening on port ${config.PORT} (${config.NODE_ENV})`);
});
