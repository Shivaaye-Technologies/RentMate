import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { requireAuth, type TokenVerifier } from "./auth.js";
import type { AppConfig } from "./config.js";
import { rankMatches, type MatchProfile } from "./matching.js";
import { MessageInput, ProfileInput } from "./validation.js";

/** Data access the routes depend on. Swap in a Supabase-backed store in production. */
export interface ProfileStore {
  upsertProfile(userId: string, profile: ProfileInput): Promise<void>;
  getProfile(userId: string): Promise<MatchProfile | null>;
  listCandidates(userId: string): Promise<MatchProfile[]>;
}

export interface AppDeps {
  config: AppConfig;
  verifyToken: TokenVerifier | null;
  store: ProfileStore;
}

export function createApp({ config, verifyToken, store }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "soulmate-api", authConfigured: verifyToken !== null });
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
      await store.upsertProfile(req.user!.id, parsed.data);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  api.get("/matches", async (req, res, next) => {
    try {
      const me = await store.getProfile(req.user!.id);
      if (!me) {
        res.status(404).json({ error: "Create your profile first" });
        return;
      }
      const candidates = await store.listCandidates(req.user!.id);
      res.json({ matches: rankMatches(me, candidates) });
    } catch (err) {
      next(err);
    }
  });

  api.post("/messages", (req, res) => {
    const parsed = MessageInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid message", issues: parsed.error.issues });
      return;
    }
    // Messages are written directly to Supabase by the client under RLS.
    // This endpoint validates payloads for clients that route through the API.
    res.status(202).json({ accepted: true });
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
