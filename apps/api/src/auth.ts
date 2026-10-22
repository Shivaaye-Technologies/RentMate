import type { NextFunction, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
}

/** Resolves a bearer token to a user, or null if the token is invalid. */
export type TokenVerifier = (token: string) => Promise<AuthUser | null>;

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

/** Verifies tokens against Supabase Auth. */
export function supabaseVerifier(url: string, anonKey: string): TokenVerifier {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return async (token) => {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  };
}

/** Fails closed: when no verifier is configured, every protected route returns 503. */
export function requireAuth(verify: TokenVerifier | null) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!verify) {
      res.status(503).json({ error: "Authentication is not configured" });
      return;
    }
    const header = req.header("authorization") ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    try {
      const user = await verify(match[1]);
      if (!user) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
