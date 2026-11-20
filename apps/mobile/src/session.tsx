import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabase";

type SessionState = { ready: boolean; session: Session | null };

const SessionContext = createContext<SessionState>({ ready: false, session: null });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ ready: !supabase, session: null });

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ ready: true, session: data.session });
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
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
