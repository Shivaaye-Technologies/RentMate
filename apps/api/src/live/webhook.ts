import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type { LiveKitProvider, ProviderRegistry } from "./providers.js";
import type { IntegrationStore } from "./store.js";

export interface WebhookDeps {
  providers: ProviderRegistry;
  /** Null when LIVE_WEBHOOK_DB_SECRET is not set: the endpoint then answers 503. */
  integration: IntegrationStore | null;
}

const asLiveKit = (providers: ProviderRegistry) => providers.get("livekit") as LiveKitProvider | undefined;

/**
 * POST /api/v1/live/webhook: LiveKit's signed event stream (participant joined/left, room finished). Mounted BEFORE
 * the JSON body parser, because the signature covers the exact raw bytes. Unsigned or tampered requests get 401 and
 * nothing is stored. A joining identity the database no longer allows is removed from the room immediately.
 */
export function webhookRouter({ providers, integration }: WebhookDeps) {
  const r = express.Router();
  r.post(
    "/",
    rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false }),
    express.raw({ type: () => true, limit: "64kb" }),
    (req: Request, res: Response) => {
      void (async () => {
        const lk = asLiveKit(providers);
        if (!lk?.configured || !integration) {
          res.status(503).json({ error: "Webhooks are not set up on this server." });
          return;
        }
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const event = lk.webhookEvent(body, req.header("authorization"));
        if (!event) {
          res.status(401).json({ error: "Invalid webhook signature" });
          return;
        }
        try {
          const result = await integration.ingest(event);
          const room = (event.room as { name?: string } | undefined)?.name;
          const identity = (event.participant as { identity?: string } | undefined)?.identity;
          if (result.kick && room && identity) {
            await lk.removeParticipant(room, identity);
          }
          res.json({ ok: true, duplicate: result.duplicate, kicked: result.kick });
        } catch (err) {
          console.error("[api] webhook ingest failed:", err instanceof Error ? err.message : err);
          // 500 makes LiveKit retry; the event id makes the retry safe.
          res.status(500).json({ error: "Could not record the event" });
        }
      })();
    },
  );
  return r;
}

/**
 * Removes people the database has queued for removal (blocked, suspended, unmatched, guest removed) from their
 * rooms. Runs on a timer in the server process; safe to run in several processes (claims are exclusive).
 */
export async function drainKicks(
  providers: ProviderRegistry,
  integration: IntegrationStore,
): Promise<number> {
  const lk = providers.get("livekit");
  if (!lk?.configured) return 0;
  const kicks = await integration.claimKicks(100);
  const done: number[] = [];
  for (const k of kicks) {
    try {
      await lk.removeParticipant(k.roomName, k.identity);
      done.push(k.id);
    } catch {
      // Left claimed; it becomes claimable again after a minute and is retried.
    }
  }
  await integration.doneKicks(done);
  return done.length;
}
