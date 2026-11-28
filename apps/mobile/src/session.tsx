import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabase";
import { record } from "./lib/diagnostics";

type SessionState = { ready: boolean; session: Session | null };

const SessionContext = createContext<SessionState>({ ready: false, session: null });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ ready: !supabase, session: null });

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      record("auth", s ? "session restored" : "no stored session", {
        expiresInMin: s?.expires_at ? Math.round((s.expires_at * 1000 - Date.now()) / 60_000) : 0,
      });
      if (active) setState({ ready: true, session: s });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Event names only (SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT, …); the session itself is never recorded.
      record("auth", event);
      setState({ ready: true, session });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
