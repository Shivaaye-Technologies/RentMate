import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createRequire } from "node:module";
import { requireAuth, type TokenVerifier } from "./auth.js";
import type { AppConfig } from "./config.js";
import { displayDistanceKm, isOnline, rankMatches, summarize, type MatchProfile } from "./matching.js";
import { DeleteAccountInput, ProfileInput } from "./validation.js";
import { AccountDeletionError, type AccountDeleter } from "./account.js";
import { AgeAttestationRequiredError } from "./profileErrors.js";
import { liveRouter, type LiveDeps } from "./live/routes.js";
import { callsRouter } from "./live/calls.js";
import { webhookRouter, type WebhookDeps } from "./live/webhook.js";

// apps/api/package.json sits one level above both src/ (tests) and dist/ (production).
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export const SERVICE_NAME = "rentmate-api";

/** Public route documentation served at GET /. Keep in sync with the routes below. */
export const ROUTES = [
  { method: "GET", path: "/", auth: false, description: "API information and available routes" },
  {
    method: "GET",
    path: "/health",
    auth: false,
    description: "Liveness check: 200 while the server is running",
  },
  {
    method: "GET",
    path: "/ready",
    auth: false,
    description: "Readiness check: 200 only when Supabase is reachable",
  },
  { method: "PUT", path: "/api/v1/profile", auth: true, description: "Create or update your profile" },
  { method: "GET", path: "/api/v1/matches", auth: true, description: "Ranked people for you to discover" },
  {
    method: "GET",
    path: "/api/v1/live/streams",
    auth: true,
    description: "Live and upcoming streams you may watch",
  },
  {
    method: "POST",
    path: "/api/v1/live/streams/:id/join",
    auth: true,
    description: "Short-lived room token after policy checks",
  },
  { method: "GET", path: "/api/v1/live/streams/:id/stats", auth: true, description: "Live viewer count" },
  {
    method: "POST",
    path: "/api/v1/live/sessions/:id/join",
    auth: true,
    description: "Join a private session",
  },
  {
    method: "POST",
    path: "/api/v1/live/streams/:id/terminate",
    auth: true,
    description: "Moderators: end a stream now",
  },
  {
    method: "POST",
    path: "/api/v1/live/sessions/:id/terminate",
    auth: true,
    description: "Moderators: end a session now",
  },
  {
    method: "POST",
    path: "/api/v1/live/emergency-stop",
    auth: true,
    description: "Moderators: stop all live",
  },
  { method: "GET", path: "/api/v1/live/admin/health", auth: true, description: "Moderators: stream health" },
  { method: "GET", path: "/api/v1/live/admin/providers", auth: true, description: "Admins: provider setup" },
  {
    method: "POST",
    path: "/api/v1/live/streams/:id/end",
    auth: true,
    description: "Creator: end the stream",
  },
  {
    method: "POST",
    path: "/api/v1/live/streams/:id/guests/:user/mute",
    auth: true,
    description: "Host: mute a guest's microphone or camera",
  },
  {
    method: "POST",
    path: "/api/v1/live/streams/:id/guests/:user/remove",
    auth: true,
    description: "Host: remove a guest now",
  },
  {
    method: "POST",
    path: "/api/v1/calls/:id/join",
    auth: true,
    description: "Room token for a voice or video call",
  },
  {
    method: "POST",
    path: "/api/v1/calls/:id/end",
    auth: true,
    description: "Hang up and close the call room",
  },
  {
    method: "POST",
    path: "/api/v1/live/webhook",
    auth: false,
    description: "LiveKit signed webhooks (signature checked)",
  },
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
  /** SOULMATE LIVE (optional: without it the live routes return 503). */
  live?: LiveDeps;
  /** LiveKit webhooks (optional: without them the webhook route returns 503). */
  webhook?: WebhookDeps;
  /** Server-side account deletion (optional: without it DELETE /api/v1/account returns 503). */
  accountFor?: (req: Request) => AccountDeleter;
  /** Checks the external dependency required to serve authenticated requests. */
  readinessCheck?: () => Promise<boolean>;
}

export function createApp({ config, verifyToken, storeFor, live, webhook, accountFor, readinessCheck }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY ?? (config.NODE_ENV === "production" ? 1 : 0));
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS }));
  // Before the JSON parser: the webhook signature covers the raw body. Not behind requireAuth: LiveKit signs it.
  app.use(
    "/api/v1/live/webhook",
    webhookRouter(webhook ?? { providers: live?.providers ?? new Map(), integration: null }),
  );
  app.use(express.json({ limit: "100kb" }));

  // Root: what this service is and how to use it. Never includes configuration values.
  app.get("/", (_req, res) => {
    res.json({
      name: "RentMate API",
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

  // Readiness is separate from liveness: do not restart a healthy process for a
  // temporary dependency outage, but let the platform stop routing traffic to it.
  app.get("/ready", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (!verifyToken || !readinessCheck) {
      res.status(503).json({ status: "not_ready", service: SERVICE_NAME });
      return;
    }
    try {
      if (!(await readinessCheck())) {
        res.status(503).json({ status: "not_ready", service: SERVICE_NAME });
        return;
      }
      res.status(200).json({ status: "ready", service: SERVICE_NAME });
    } catch {
      res.status(503).json({ status: "not_ready", service: SERVICE_NAME });
    }
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
      if (err instanceof AgeAttestationRequiredError) {
        // Database-level age attestation (P2-03): record the date of birth and 18+ confirmation first.
        res.status(422).json({ error: err.message, code: "age_attestation_required" });
        return;
      }
      next(err);
    }
  });

  // Deletes the caller's photos and then their account, entirely on the server (P2-05). Safe to repeat: a retry
  // removes whatever is left. The database refuses the account step while any photo remains.
  api.delete("/account", async (req, res, next) => {
    if (!accountFor) {
      res.status(503).json({ error: "Account deletion is not configured" });
      return;
    }
    const parsed = DeleteAccountInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Type "DELETE" to confirm' });
      return;
    }
    try {
      const { photosRemoved } = await accountFor(req).deleteAccount(req.user!.id);
      res.status(200).json({ deleted: true, photosRemoved });
    } catch (err) {
      if (err instanceof AccountDeletionError) {
        res.status(502).json({
          error: `${err.message} Your account was not deleted; please try again.`,
          stage: err.stage,
        });
        return;
      }
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
          details: c.details ?? {},
          photos: c.photos ?? [],
        };
      });
      res.json({ matches, summary: summarize(me, candidates) });
    } catch (err) {
      next(err);
    }
  });

  if (live) {
    api.use("/live", liveRouter(live));
    api.use("/calls", callsRouter(live));
  } else {
    api.use("/live", (_req, res) => {
      res.status(503).json({ error: "Live streaming is not configured" });
    });
    api.use("/calls", (_req, res) => {
      res.status(503).json({ error: "Calls are not configured" });
    });
  }

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
