import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  /**
   * Proxy hops in front of the API (Render adds one). Lets rate limiting see each
   * visitor's own address instead of putting everyone in one shared bucket.
   * Defaults to 1 in production and 0 elsewhere.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).optional(),
  /** LiveKit (SOULMATE LIVE). The URL is public; the key and secret stay on the server. */
  LIVEKIT_URL: z
    .string()
    .regex(/^(wss|https):\/\/\S+$/, "must start with wss:// or https://")
    .optional(),
  LIVEKIT_API_KEY: z.string().min(1).optional(),
  /**
   * Signs every LiveKit token, and every member receives a token, so a guessable secret could be recovered offline and
   * used to forge admin tokens. LiveKit generates 43-character secrets; require 32+ characters, no whitespace and at
   * least 12 distinct characters. Messages never include the value.
   */
  LIVEKIT_API_SECRET: z
    .string()
    .min(32, "must be at least 32 characters (use the secret LiveKit generated)")
    .refine((s) => !/\s/.test(s), "must not contain whitespace")
    .refine((s) => new Set(s).size >= 12, "is too repetitive to be a generated secret")
    .optional(),
  /**
   * Secret the API presents to the database for LiveKit webhooks and the room-removal queue. Must match the value
   * stored with private.set_integration_secret('livekit_webhook', ...). Without it the webhook route returns 503.
   */
  LIVE_WEBHOOK_DB_SECRET: z.string().min(32).optional(),
  /**
   * Header a trusted CDN/proxy sets with the visitor's country (e.g. cf-ipcountry).
   * Without it every viewer's country is unknown and country-limited content stays hidden.
   */
  LIVE_COUNTRY_HEADER: z
    .string()
    .regex(/^[a-z0-9-]{2,40}$/, "must be a lower-case header name")
    .optional(),
  /**
   * Google Play Billing (sandbox first; docs/PLAY_BILLING_IMPLEMENTATION.md). All four are needed or the billing routes
   * answer 503. The service-account JSON and the two secrets never leave the server.
   */
  GOOGLE_PLAY_PACKAGE_NAME: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "must be an Android package name")
    .optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  /** Must match private.set_integration_secret('play_billing', ...). */
  BILLING_DB_SECRET: z.string().min(32).optional(),
  /** Token in the Pub/Sub push endpoint URL (?token=...) for Real-time Developer Notifications. */
  GOOGLE_PLAY_RTDN_TOKEN: z
    .string()
    .min(32)
    .regex(/^[A-Za-z0-9_-]+$/, "must be URL-safe (letters, digits, - and _)")
    .optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

/** Settings whose values must never appear in logs, error reports or serialised output. */
export const SECRET_KEYS = [
  "SUPABASE_ANON_KEY",
  "LIVEKIT_API_SECRET",
  "LIVE_WEBHOOK_DB_SECRET",
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "BILLING_DB_SECRET",
  "GOOGLE_PLAY_RTDN_TOKEN",
] as const;

/**
 * Makes the config safe to log by accident: `JSON.stringify(config)`, `console.log(config)` and `util.inspect` all
 * show "[redacted]" for secret settings. Property access (config.LIVEKIT_API_SECRET) is unchanged.
 */
function redactWhenPrinted(config: AppConfig): AppConfig {
  const printable = () =>
    Object.fromEntries(
      Object.entries(config).map(([k, v]) => [
        k,
        (SECRET_KEYS as readonly string[]).includes(k) && v !== undefined ? "[redacted]" : v,
      ]),
    );
  Object.defineProperty(config, "toJSON", { value: printable, enumerable: false });
  Object.defineProperty(config, Symbol.for("nodejs.util.inspect.custom"), {
    value: printable,
    enumerable: false,
  });
  return config;
}

/**
 * Parses and validates environment variables. Throws with a readable list of
 * problems instead of starting the server with a broken configuration.
 * Secret values are never included in the error message.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === "production" && (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY)) {
    throw new Error(
      "Invalid environment configuration:\n- SUPABASE_URL and SUPABASE_ANON_KEY are required in production",
    );
  }
  return redactWhenPrinted(config);
}
