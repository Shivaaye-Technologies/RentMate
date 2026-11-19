import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  classifyHealth,
  explainProblems,
  refusalStatus,
  TOKEN_TTL_SECONDS,
  viewerCountry,
} from "./policy.js";
import { ProviderNotConfigured, type ProviderRegistry } from "./providers.js";
import { LiveStoreError, type LiveStore } from "./store.js";

export interface LiveDeps {
  liveStoreFor: (req: Request) => LiveStore;
  providers: ProviderRegistry;
  /** Lower-case header a trusted proxy/CDN sets with the visitor's country (e.g. "cf-ipcountry"). */
  countryHeader: string | null;
}

const uuid = z.string().uuid();
const JoinBody = z.object({ as: z.enum(["viewer", "broadcaster"]) }).strict();
const ReasonBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const EmergencyBody = z.object({ on: z.boolean(), reason: z.string().trim().min(3).max(500) }).strict();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (h: Handler) => (req: Request, res: Response, next: NextFunction) => h(req, res).catch(next);

function refuse(res: Response, codes: string[]) {
  res.status(refusalStatus(codes)).json({ error: "Not allowed", reasons: explainProblems(codes) });
}

/** /api/v1/live routes. Mounted after authentication. */
export function liveRouter({ liveStoreFor, providers, countryHeader }: LiveDeps) {
  const r = express.Router();
  // Joining issues credentials: keep it tighter than the general API limit.
  const joinLimit = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  const country = (req: Request) => (countryHeader ? viewerCountry(req.headers[countryHeader]) : null);

  const providerFor = (key: string) => {
    const p = providers.get(key);
    if (!p || !p.configured) throw new ProviderNotConfigured(key);
    return p;
  };

  r.get(
    "/streams",
    wrap(async (req, res) => {
      const list = await liveStoreFor(req).listStreams(country(req));
      res.json({ streams: list, country: country(req) });
    }),
  );

  r.post(
    "/streams/:id/join",
    joinLimit,
    wrap(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = JoinBody.safeParse(req.body);
      if (!id.success || !body.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      const broadcaster = body.data.as === "broadcaster";
      const problems = broadcaster
        ? await store.broadcastCheck(id.data)
        : await store.watchCheck(id.data, country(req));
      // A broadcaster may connect before going live; everything else must pass.
      const blocking = broadcaster ? problems.filter((p) => p !== "stream_not_live") : problems;
      if (blocking.length > 0) {
        refuse(res, blocking);
        return;
      }
      const room = await store.streamRoom(id.data);
      if (!room) {
        refuse(res, ["stream_not_found"]);
        return;
      }
      const provider = providerFor(room.providerKey);
      if (!broadcaster) {
        // WebRTC viewers are capped per stream so one SFU room is never pushed past what it can serve.
        const [cap, stats] = await Promise.all([store.viewerCap(), provider.roomStats(room.roomName)]);
        if (stats && stats.participants - stats.publishers >= cap) {
          refuse(res, ["stream_full"]);
          return;
        }
      }
      // Broadcasters publish only the sources the database allows (a host may have muted a guest's camera or mic).
      const sources = broadcaster ? await store.publishSources(id.data) : [];
      const canPublish = broadcaster && sources.length > 0;
      const token = await provider.issueToken({
        room: room.roomName,
        identity: req.user!.id,
        canPublish,
        ...(canPublish ? { publishSources: sources } : {}),
        ttlSeconds: TOKEN_TTL_SECONDS,
      });
      res.set("Cache-Control", "no-store");
      res.json({ ...token, room: room.roomName, canPublish, publishSources: sources });
    }),
  );

  r.post(
    "/sessions/:id/join",
    joinLimit,
    wrap(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      const problems = await store.sessionCheck(id.data, country(req));
      if (problems.length > 0) {
        refuse(res, problems);
        return;
      }
      const room = await store.sessionRoom(id.data);
      if (!room) {
        refuse(res, ["session_not_found"]);
        return;
      }
      const token = await providerFor(room.providerKey).issueToken({
        room: room.roomName,
        identity: req.user!.id,
        canPublish: true,
        audioOnly: room.mode === "audio",
        ttlSeconds: TOKEN_TTL_SECONDS,
      });
      res.set("Cache-Control", "no-store");
      res.json({ ...token, room: room.roomName, mode: room.mode });
    }),
  );

  r.get(
    "/streams/:id/stats",
    wrap(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      const room = await store.streamRoom(id.data);
      // Only people who could watch (or the creator) see the count.
      const problems =
        room && room.creatorId === req.user!.id ? [] : await store.watchCheck(id.data, country(req));
      if (!room || problems.length > 0) {
        refuse(res, room ? problems : ["stream_not_found"]);
        return;
      }
      const provider = providers.get(room.providerKey);
      const stats = provider?.configured ? await provider.roomStats(room.roomName).catch(() => null) : null;
      res.set("Cache-Control", "no-store");
      res.json({
        status: room.status,
        viewers: stats ? Math.max(0, stats.participants - stats.publishers) : null,
      });
    }),
  );

  // ---- Creator ends their stream: everyone leaves the room ----

  r.post(
    "/streams/:id/end",
    wrap(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      const room = await store.streamRoom(id.data);
      if (!room || room.creatorId !== req.user!.id) {
        res.status(403).json({ error: "Only the creator can end this stream." });
        return;
      }
      await store.endStream(id.data);
      const provider = providers.get(room.providerKey);
      const roomClosed = provider?.configured
        ? await provider
            .closeRoom(room.roomName)
            .then(() => true)
            .catch(() => false)
        : false;
      res.json({ ended: true, roomClosed });
    }),
  );

  // ---- Host controls (creator of the stream, or a moderator) ----

  const GuestParams = z.object({ id: uuid, user: uuid });
  const MuteBody = z.object({ kind: z.enum(["audio", "video"]), muted: z.boolean().default(true) }).strict();

  r.post(
    "/streams/:id/guests/:user/mute",
    wrap(async (req, res) => {
      const params = GuestParams.safeParse(req.params);
      const body = MuteBody.safeParse(req.body);
      if (!params.success || !body.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      if (!(await store.hostCheck(params.data.id))) {
        res.status(403).json({ error: "Only the host or a moderator can do that." });
        return;
      }
      const room = await store.streamRoom(params.data.id);
      if (!room) {
        refuse(res, ["stream_not_found"]);
        return;
      }
      // The database records the mute (it survives reconnects and new tokens); the media server then enforces it.
      const sources = await store.setGuestMute(
        params.data.id,
        params.data.user,
        body.data.kind,
        body.data.muted,
      );
      const provider = providerFor(room.providerKey);
      // Mute what is live now, then take the source away so a camera published a moment later, a reconnect or the
      // guest's own unmute cannot bring it back. Unmuting only gives the permission back: the guest turns the device on.
      const muted = body.data.muted
        ? await provider.muteParticipant(room.roomName, params.data.user, body.data.kind)
        : 0;
      const inRoom = await provider.setPublishSources(room.roomName, params.data.user, sources);
      res.json({ muted, hostMuted: body.data.muted, sources, inRoom });
    }),
  );

  r.post(
    "/streams/:id/guests/:user/remove",
    wrap(async (req, res) => {
      const params = GuestParams.safeParse(req.params);
      if (!params.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      // The database checks the role, removes the guest from the stream and queues the room removal.
      await store.removeGuest(params.data.id, params.data.user);
      const room = await store.streamRoom(params.data.id);
      let disconnected = false;
      const provider = room ? providers.get(room.providerKey) : undefined;
      if (room && provider?.configured) {
        // Also remove them right now; the queue is the safety net if this call fails.
        disconnected = await provider
          .removeParticipant(room.roomName, params.data.user)
          .then(() => true)
          .catch(() => false);
      }
      res.json({ removed: true, disconnected });
    }),
  );

  // ---- Moderation ----

  r.post(
    "/streams/:id/terminate",
    wrap(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = ReasonBody.safeParse(req.body);
      if (!id.success || !body.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      // Database first (role check, blocks rejoining), then close the provider room.
      await store.terminateStream(id.data, body.data.reason);
      const room = await store.streamRoom(id.data);
      let roomClosed = false;
      if (room) {
        const provider = providers.get(room.providerKey);
        if (provider?.configured) {
          await provider.closeRoom(room.roomName);
          roomClosed = true;
        }
      }
      res.json({ terminated: true, roomClosed });
    }),
  );

  r.post(
    "/sessions/:id/terminate",
    wrap(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = ReasonBody.safeParse(req.body);
      if (!id.success || !body.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      await store.terminateSession(id.data, body.data.reason);
      res.json({ terminated: true });
    }),
  );

  r.post(
    "/emergency-stop",
    wrap(async (req, res) => {
      const body = EmergencyBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const store = liveStoreFor(req);
      // Remember which rooms are live before the database ends them.
      const live = body.data.on ? (await store.adminStreams()).filter((s) => s.status === "live") : [];
      await store.setEmergencyStop(body.data.on, body.data.reason);
      let closed = 0;
      const failed: string[] = [];
      for (const s of live) {
        const provider = providers.get(s.providerKey);
        if (!provider?.configured) continue;
        try {
          await provider.closeRoom(s.roomName);
          closed++;
        } catch {
          failed.push(s.id);
        }
      }
      res.json({ emergencyStop: body.data.on, roomsClosed: closed, roomsFailed: failed });
    }),
  );

  r.get(
    "/admin/health",
    wrap(async (req, res) => {
      const store = liveStoreFor(req);
      const streams = await store.adminStreams();
      const findings = [];
      for (const s of streams.filter((x) => x.status === "live")) {
        const provider = providers.get(s.providerKey);
        const stats = provider?.configured ? await provider.roomStats(s.roomName).catch(() => null) : null;
        findings.push({
          ...classifyHealth(s.id, stats, Boolean(provider?.configured), s.problems),
          title: s.title,
          stageName: s.stageName,
        });
      }
      res.set("Cache-Control", "no-store");
      res.json({ checkedAt: new Date().toISOString(), streams: findings });
    }),
  );

  r.get(
    "/admin/providers",
    wrap(async (req, res) => {
      const roles = await liveStoreFor(req).roles();
      if (!roles.includes("admin")) {
        res.status(403).json({ error: "You don't have permission to do that." });
        return;
      }
      // Only whether credentials are present, never the values.
      res.json({
        providers: [...providers.values()].map((p) => ({ key: p.key, configured: p.configured })),
      });
    }),
  );

  r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof LiveStoreError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof ProviderNotConfigured) {
      res.status(503).json({ error: "This streaming service isn't set up on the server yet." });
      return;
    }
    next(err);
  });

  return r;
}
