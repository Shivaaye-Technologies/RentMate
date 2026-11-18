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
  LIVEKIT_API_SECRET: z.string().min(16).optional(),
  /**
   * Header a trusted CDN/proxy sets with the visitor's country (e.g. cf-ipcountry).
   * Without it every viewer's country is unknown and country-limited content stays hidden.
   */
  LIVE_COUNTRY_HEADER: z
    .string()
    .regex(/^[a-z0-9-]{2,40}$/, "must be a lower-case header name")
    .optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

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
  return config;
}
