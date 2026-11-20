import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { explainProblems, refusalStatus, TOKEN_TTL_SECONDS } from "./policy.js";
import { ProviderNotConfigured, type ProviderRegistry } from "./providers.js";
import { LiveStoreError, type LiveStore } from "./store.js";

/** Calls use the LiveKit provider (one-to-one rooms, short-lived tokens). */
const CALL_PROVIDER = "livekit";

export interface CallDeps {
  liveStoreFor: (req: Request) => LiveStore;
  providers: ProviderRegistry;
}

const uuid = z.string().uuid();
type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (h: Handler) => (req: Request, res: Response, next: NextFunction) => h(req, res).catch(next);

/**
 * /api/v1/calls routes. Mounted after authentication. Ringing, answering and the call record live in the database
 * (call_start / call_answer, read through RLS by the app); the API only issues room tokens after the database allows
 * it, and closes the room when someone hangs up.
 */
export function callsRouter({ liveStoreFor, providers }: CallDeps) {
  const r = express.Router();
  const joinLimit = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  const provider = () => {
    const p = providers.get(CALL_PROVIDER);
    if (!p || !p.configured) throw new ProviderNotConfigured(CALL_PROVIDER);
    return p;
  };

  r.post(
    "/:id/join",
    joinLimit,
    wrap(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      const problems = await store.callCheck(id.data);
      if (problems.length > 0) {
        res
          .status(refusalStatus(problems))
          .json({ error: "Not allowed", reasons: explainProblems(problems) });
        return;
      }
      const room = await store.callRoom(id.data);
      if (!room) {
        res.status(404).json({ error: "Not allowed", reasons: explainProblems(["call_not_found"]) });
        return;
      }
      const token = await provider().issueToken({
        room: room.roomName,
        identity: req.user!.id,
        canPublish: true,
        // Voice calls may publish the microphone only; the token enforces it, not the app.
        audioOnly: room.mode === "voice",
        ttlSeconds: TOKEN_TTL_SECONDS,
      });
      res.set("Cache-Control", "no-store");
      res.json({ ...token, room: room.roomName, mode: room.mode });
    }),
  );

  r.post(
    "/:id/end",
    wrap(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const roomName = await liveStoreFor(req).callHangup(id.data);
      // Close the room for both people. A room nobody joined yet does not exist, which is fine.
      let roomClosed = false;
      const p = providers.get(CALL_PROVIDER);
      if (roomName && p?.configured) {
        roomClosed = await p
          .closeRoom(roomName)
          .then(() => true)
          .catch(() => false);
      }
      res.json({ ended: true, roomClosed });
    }),
  );

  r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof LiveStoreError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof ProviderNotConfigured) {
      res.status(503).json({ error: "Calls aren't set up on the server yet." });
      return;
    }
    next(err);
  });
  return r;
}
