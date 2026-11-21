import { useEffect, useState } from "react";
import { liveApi, type GuestInvite, type StreamListing } from "./liveData";

/** Live now: streams this member may watch (the server applies country, block and policy rules). */
export function LiveDiscover({ me, onExit }: { me: string; onExit: () => void }) {
  const [streams, setStreams] = useState<StreamListing[] | null>(null);
  const [invites, setInvites] = useState<GuestInvite[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const [s, i] = await Promise.all([liveApi.list(), liveApi.myInvites(me)]);
        if (stop) return;
        setStreams(s);
        setInvites(i);
        setError(null);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : "Couldn't load live streams.");
      }
    };
    void load();
    const t = setInterval(load, 10000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [me]);

  async function answer(inv: GuestInvite, accept: boolean) {
    try {
      if (accept) {
        await liveApi.acceptInvite(inv);
        window.location.hash = `#broadcast/${inv.stream_id}`;
      } else {
        await liveApi.declineInvite(inv);
        setInvites((l) => l.filter((x) => x.id !== inv.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't answer the invitation.");
    }
  }

  const live = (streams ?? []).filter((s) => s.status === "live");
  const soon = (streams ?? []).filter((s) => s.status === "scheduled");
  return (
    <main className="live-discover">
      <header className="live-head">
        <button className="btn small" onClick={onExit}>
          ← Back
        </button>
        <strong>Live</strong>
        <a className="btn small dark" href="#creator" aria-label="Open creator studio">
          Start a live
        </a>
      </header>
      {invites.length > 0 && (
        <section className="panel">
          <h3>Invitations to go live</h3>
          {invites.map((i) => (
            <div key={i.id} className="row between">
              <span>You're invited as a guest. Nothing is recorded.</span>
              <span className="row">
                <button className="btn small" onClick={() => void answer(i, false)}>
                  Decline
                </button>
                <button className="btn small dark" onClick={() => void answer(i, true)}>
                  Accept
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
      {error && <p className="alert error">{error}</p>}
      {!streams && !error && <div className="spinner" aria-hidden="true" />}
      {streams && live.length === 0 && <p className="muted">Nobody is live right now. Check back soon.</p>}
      <ul className="plain-list live-list">
        {live.map((s) => (
          <li key={s.id}>
            <a className="menu-row" href={`#live/${s.id}`} data-testid="live-stream-link">
              <span className="live-pill on">LIVE</span> <strong>{s.title}</strong>
              <span className="muted small">
                {s.stageName} · {s.category}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {soon.length > 0 && (
        <>
          <h3>Coming up</h3>
          <ul className="plain-list">
            {soon.map((s) => (
              <li key={s.id} className="muted">
                {s.title} · {s.stageName}
                {s.scheduledAt ? ` · ${new Date(s.scheduledAt).toLocaleString()}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
