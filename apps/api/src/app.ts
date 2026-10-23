import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createRequire } from "node:module";
import { requireAuth, type TokenVerifier } from "./auth.js";
import type { AppConfig } from "./config.js";
import { displayDistanceKm, isOnline, rankMatches, summarize, type MatchProfile } from "./matching.js";
import { ProfileInput } from "./validation.js";

// apps/api/package.json sits one level above both src/ (tests) and dist/ (production).
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export const SERVICE_NAME = "soulmate-api";

/** Public route documentation served at GET /. Keep in sync with the routes below. */
export const ROUTES = [
  { method: "GET", path: "/", auth: false, description: "API information and available routes" },
  {
    method: "GET",
    path: "/health",
    auth: false,
    description: "Liveness check: 200 while the server is running",
  },
  { method: "PUT", path: "/api/v1/profile", auth: true, description: "Create or update your profile" },
  { method: "GET", path: "/api/v1/matches", auth: true, description: "Ranked people for you to discover" },
] as const;

/** Data access the routes depend on. */
export interface ProfileStore {
  upsertProfile(userId: string, profile: ProfileInput): Promise<void>;
  getProfile(userId: string): Promise<MatchProfile | null>;
  /** Other users' profiles, excluding anyone the user already liked or passed on. */
  listCandidates(userId: string): Promise<MatchProfile[]>;
}

export interface AppDeps {
  config: AppConfig;
  verifyToken: TokenVerifier | null;
  /** Returns the store for an authenticated request (Supabase uses the caller's token). */
  storeFor: (req: Request) => ProfileStore;
}

export function createApp({ config, verifyToken, storeFor }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY ?? (config.NODE_ENV === "production" ? 1 : 0));
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(express.json({ limit: "100kb" }));

  // Root: what this service is and how to use it. Never includes configuration values.
  app.get("/", (_req, res) => {
    res.json({
      name: "SOULMATE.AI API",
      service: SERVICE_NAME,
      version,
      status: "ok",
      authentication: "Routes under /api/v1 need the header Authorization: Bearer <Supabase access token>.",
      routes: ROUTES,
    });
  });

  // Liveness for Render's health check: answers 200 whenever the process is up.
  // Deliberately does not call Supabase, so a database hiccup does not restart the server.
  app.get("/health", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ status: "ok", service: SERVICE_NAME, authConfigured: verifyToken !== null });
  });

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
  api.use(requireAuth(verifyToken));

  api.put("/profile", async (req, res, next) => {
    try {
      const parsed = ProfileInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid profile", issues: parsed.error.issues });
        return;
      }
      await storeFor(req).upsertProfile(req.user!.id, parsed.data);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  api.get("/matches", async (req, res, next) => {
    try {
      const store = storeFor(req);
      const me = await store.getProfile(req.user!.id);
      if (!me) {
        res.status(404).json({ error: "Create your profile first" });
        return;
      }
      const candidates = await store.listCandidates(req.user!.id);
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const matches = rankMatches(me, candidates).map((m) => {
        const c = byId.get(m.id)!;
        return {
          ...m,
          displayName: c.displayName ?? "",
          age: c.age,
          bio: c.bio ?? "",
          interests: c.interests,
          lookingFor: c.lookingFor,
          photoPath: c.photoPath ?? null,
          verified: c.verified ?? false,
          // Supabase returns these precomputed; the in-memory test store does not.
          online: c.online ?? isOnline(c.lastSeenAt),
          distanceKm: c.distanceKm !== undefined ? c.distanceKm : displayDistanceKm(me, c),
          joinedAt: c.joinedAt ?? null,
        };
      });
      res.json({ matches, summary: summarize(me, candidates) });
    } catch (err) {
      next(err);
    }
  });

  app.use("/api/v1", api);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api] unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
