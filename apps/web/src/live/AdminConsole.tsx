import { useCallback, useEffect, useState } from "react";
import {
  adminApi,
  parseCountries,
  policyBlockers,
  providerBlockers,
  type AdminCreator,
  type AdminStreamRow,
  type AppealRow,
  type CountryPolicy,
  type HealthRow,
  type LogRow,
  type ProviderRow,
  type ReportRow,
  type TicketRow,
} from "./adminData";
import { CREATOR_STATUS, explainProblems, STREAM_STATUS } from "./liveText";
import { useAction } from "./useAction";

type Section = "compliance" | "streams" | "creators" | "providers";

const REASONS: Record<string, string> = {
  minor: "Possible minor",
  non_consensual: "Non-consensual content",
  trafficking_or_coercion: "Trafficking or coercion",
  leaked_or_stolen: "Leaked or stolen content",
  violence: "Violence",
  harassment: "Harassment",
  hate: "Hate",
  spam_or_scam: "Spam or scam",
  illegal_in_my_country: "Illegal in reporter's country",
  other: "Other",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

/** Loads data for a section and reloads on demand. */
function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this section.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

function Loading({ error, retry }: { error: string | null; retry: () => void }) {
  return error ? (
    <div className="empty small">
      <p className="alert error" role="alert">
        {error}
      </p>
      <button className="btn" onClick={retry}>
        Try again
      </button>
    </div>
  ) : (
    <div className="empty small">
      <div className="spinner" aria-hidden="true" />
    </div>
  );
}

// ---------- Compliance and moderation ----------

function EmergencyStop() {
  const { data, error, reload } = useLoad(() => adminApi.settings());
  const [reason, setReason] = useState("");
  const { busy, run, messages, setError } = useAction(reload);
  if (!data) return <Loading error={error} retry={() => void reload()} />;
  const on = data.emergency_stop;
  return (
    <div className={on ? "panel emergency on" : "panel emergency"}>
      <h3>Emergency stop</h3>
      <p className="muted small">
        {on
          ? `ON since ${when(data.updated_at)}${data.emergency_reason ? `: ${data.emergency_reason}` : ""}. Nobody can go live, watch or join a session.`
          : "Ends every live stream and active session immediately, closes the provider rooms and refuses new joins until switched off."}
      </p>
      <label className="field">
        <span>Reason (logged)</span>
        <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {messages}
      <button
        className={on ? "btn block" : "btn block danger-solid"}
        disabled={busy}
        onClick={() => {
          if (reason.trim().length < 3) {
            setError("Give a reason (3+ characters).");
            return;
          }
          void run(
            async () => {
              const r = await adminApi.emergencyStop(!on, reason.trim());
              if (r.roomsFailed.length > 0) {
                throw new Error(
                  `${r.roomsFailed.length} provider room(s) couldn't be closed. Check the streaming dashboard.`,
                );
              }
            },
            on ? "Emergency stop switched off." : "Emergency stop is ON.",
          ).then((ok) => ok && setReason(""));
        }}
      >
        {busy ? "Working…" : on ? "Switch emergency stop off" : "Stop all live activity now"}
      </button>
    </div>
  );
}

function Reports() {
  const { data, error, reload } = useLoad(() => adminApi.reports());
  const [note, setNote] = useState<Record<string, string>>({});
  const { busy, run, messages } = useAction(reload);
  if (!data) return <Loading error={error} retry={() => void reload()} />;
  const open = data.filter((r) => r.status === "open");
  return (
    <div className="panel">
      <h3>Reports ({open.length} open)</h3>
      {messages}
      {data.length === 0 && <p className="muted">No reports.</p>}
      <ul className="admin-list">
        {data.map((r: ReportRow) => (
          <li key={r.id} className={r.priority === "urgent" && r.status === "open" ? "urgent" : ""}>
            <div className="row between">
              <strong>
                {r.priority === "urgent" && r.status === "open" ? "URGENT · " : ""}
                {REASONS[r.reason] ?? r.reason}
              </strong>
              <small className="muted">{r.status}</small>
            </div>
            <small className="muted">
              {when(r.created_at)} · {r.stream_id ? "stream" : r.session_id ? "private session" : "creator"}
            </small>
            {r.details && <p className="small">{r.details}</p>}
            {r.status === "open" ? (
              <>
                <input
                  aria-label="Handling note"
                  placeholder="What did you do? (logged)"
                  maxLength={1000}
                  value={note[r.id] ?? ""}
                  onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                />
                <div className="row-wrap">
                  <button
                    className="btn small dark"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => adminApi.resolveReport(r.id, "actioned", note[r.id] ?? ""),
                        "Marked as actioned.",
                      )
                    }
                  >
                    Actioned
                  </button>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => adminApi.resolveReport(r.id, "dismissed", note[r.id] ?? ""),
                        "Dismissed.",
                      )
                    }
                  >
                    Dismiss
                  </button>
                </div>
              </>
            ) : (
              r.handling_note && <small className="muted">Note: {r.handling_note}</small>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PolicyEditor({ p, onSaved }: { p: CountryPolicy; onSaved: () => Promise<void> }) {
  const [d, setD] = useState(p);
  const { busy, run, messages, setError } = useAction(onSaved);
  const blockers = policyBlockers(d);
  return (
    <li>
      <div className="row between">
        <strong>{d.country_code || "New country"}</strong>
        {d.explicit_allowed && <span className="pill status-live">Adult content on</span>}
      </div>
      {!p.country_code && (
        <input
          aria-label="Country code"
          placeholder="Two-letter code, e.g. GB"
          maxLength={2}
          value={d.country_code}
          onChange={(e) => setD({ ...d, country_code: e.target.value.toUpperCase() })}
        />
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={d.live_allowed}
          onChange={(e) => setD({ ...d, live_allowed: e.target.checked })}
        />
        <span>Live streams allowed</span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={d.private_sessions_allowed}
          onChange={(e) => setD({ ...d, private_sessions_allowed: e.target.checked })}
        />
        <span>Private video/audio sessions allowed</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={false} disabled readOnly />
        <span>
          Adult (explicit) content
          <small className="muted"> · not supported on RentMate</small>
        </span>
      </label>
      {d.explicit_allowed && (
        <label className="field">
          <span>Written legal clearance reference (required)</span>
          <input
            maxLength={200}
            placeholder="e.g. legal opinion number and date"
            value={d.legal_clearance_ref ?? ""}
            onChange={(e) => setD({ ...d, legal_clearance_ref: e.target.value })}
          />
        </label>
      )}
      <label className="field">
        <span>Notes</span>
        <input
          maxLength={1000}
          value={d.notes ?? ""}
          onChange={(e) => setD({ ...d, notes: e.target.value })}
        />
      </label>
      {blockers.length > 0 && (
        <ul className="tips">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {messages}
      <button
        className="btn small dark"
        disabled={busy}
        onClick={() => {
          if (blockers.length > 0) {
            setError("Fix the items above first.");
            return;
          }
          void run(() => adminApi.savePolicy(d), `${d.country_code} saved.`);
        }}
      >
        Save {d.country_code}
      </button>
    </li>
  );
}

function CountryPolicies() {
  const { data, error, reload } = useLoad(() => adminApi.policies());
  const [adding, setAdding] = useState(false);
  if (!data) return <Loading error={error} retry={() => void reload()} />;
  const blank: CountryPolicy = {
    country_code: "",
    live_allowed: false,
    private_sessions_allowed: false,
    explicit_allowed: false,
    legal_clearance_ref: null,
    notes: null,
  };
  return (
    <div className="panel">
      <h3>Country policies</h3>
      <p className="muted small">
        Countries not listed allow nothing. RentMate does not support adult or sexually explicit content in
        any country. Every change is logged.
      </p>
      <ul className="admin-list">
        {data.map((p) => (
          <PolicyEditor key={p.country_code} p={p} onSaved={reload} />
        ))}
        {adding && (
          <PolicyEditor
            p={blank}
            onSaved={async () => {
              setAdding(false);
              await reload();
            }}
          />
        )}
      </ul>
      {!adding && (
        <button className="btn small" onClick={() => setAdding(true)}>
          Add a country
        </button>
      )}
    </div>
  );
}

function AuditLog() {
  const { data, error, reload } = useLoad(() => adminApi.log());
  if (!data) return <Loading error={error} retry={() => void reload()} />;
  return (
    <div className="panel">
      <div className="row between">
        <h3>Moderation log</h3>
        <button className="btn small" onClick={() => void reload()}>
          Refresh
        </button>
      </div>
      {data.length === 0 && <p className="muted">Nothing logged yet.</p>}
      <ul className="admin-list compact">
        {data.map((l: LogRow) => (
          <li key={l.id}>
            <strong>{l.action.replace(/_/g, " ")}</strong>{" "}
            <small className="muted">
              {l.target_type}
              {l.target_id ? ` ${l.target_id.slice(0, 8)}` : ""} · {when(l.created_at)}
            </small>
            {l.reason && <small className="muted"> · {l.reason}</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Age results from the verification partner (RentMate is 18+). */
function ViewerAgeCheck() {
  const [d, setD] = useState({
    user: "",
    provider: "",
    reference: "",
    status: "passed",
    country: "",
    over18: true,
  });
  const { busy, run, messages, setError } = useAction(async () => undefined);
  return (
    <div className="panel">
      <h3>Viewer age checks</h3>
      <p className="muted small">
        Record a verification partner's age result for a viewer. RentMate is for adults (18+) only.
      </p>
      <div className="row-wrap">
        <input
          aria-label="Viewer user id"
          placeholder="Viewer's user id"
          value={d.user}
          onChange={(e) => setD({ ...d, user: e.target.value.trim() })}
        />
        <input
          aria-label="Provider"
          placeholder="Provider"
          value={d.provider}
          onChange={(e) => setD({ ...d, provider: e.target.value })}
        />
        <input
          aria-label="Case reference"
          placeholder="Case reference"
          value={d.reference}
          onChange={(e) => setD({ ...d, reference: e.target.value })}
        />
        <input
          aria-label="Verified country"
          placeholder="Country"
          maxLength={2}
          value={d.country}
          onChange={(e) => setD({ ...d, country: e.target.value.toUpperCase() })}
        />
        <select aria-label="Result" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })}>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <label className="check-row">
          <input
            type="checkbox"
            checked={d.over18}
            onChange={(e) => setD({ ...d, over18: e.target.checked })}
          />
          <span>Confirmed 18 or older</span>
        </label>
      </div>
      {messages}
      <button
        className="btn small"
        disabled={busy}
        onClick={() => {
          if (
            !/^[0-9a-f-]{36}$/i.test(d.user) ||
            d.provider.trim().length < 2 ||
            d.reference.trim().length < 3
          ) {
            setError("Add the viewer's user id, the provider and its case reference.");
            return;
          }
          void run(
            () => adminApi.recordViewerAge(d.user, d.provider, d.reference, d.status, d.country, d.over18),
            "Recorded.",
          );
        }}
      >
        Record result
      </button>
    </div>
  );
}

// ---------- Streaming management ----------

function StreamsDashboard() {
  const streams = useLoad(() => adminApi.streams());
  const health = useLoad(() => adminApi.health());
  const [reason, setReason] = useState<Record<string, string>>({});
  const reload = async () => {
    await Promise.all([streams.reload(), health.reload()]);
  };
  const { busy, run, messages, setError } = useAction(reload);
  if (!streams.data) return <Loading error={streams.error} retry={() => void streams.reload()} />;
  const byId = new Map((health.data?.streams ?? []).map((h: HealthRow) => [h.streamId, h]));
  const live = streams.data.filter((s) => s.status === "live");
  return (
    <section className="studio-section">
      <div className="row between">
        <h3>{live.length} live now</h3>
        <button className="btn small" onClick={() => void reload()}>
          Refresh
        </button>
      </div>
      {health.error && <p className="alert error">Health check: {health.error}</p>}
      {messages}
      {streams.data.length === 0 && <p className="muted">No streams in the last 7 days.</p>}
      <ul className="stream-list">
        {streams.data.map((s: AdminStreamRow) => {
          const h = byId.get(s.id);
          return (
            <li key={s.id} className="panel stream-card">
              <div className="row between">
                <strong>{s.title}</strong>
                <span className={`pill status-${s.status}`}>{STREAM_STATUS[s.status] ?? s.status}</span>
              </div>
              <small className="muted">
                {s.stage_name} · {s.category}
                {s.explicit ? " · adult" : ""} · {when(s.started_at ?? s.scheduled_at)}
              </small>
              {s.status === "live" && (
                <p className="small">
                  Viewers: <strong>{h?.viewers ?? "—"}</strong> · Health:{" "}
                  <strong className={h && h.status !== "ok" ? "err" : ""}>
                    {h ? h.status.replace(/_/g, " ") : "unknown"}
                  </strong>
                </p>
              )}
              {s.problems.filter((p) => p !== "stream_not_open").length > 0 && (
                <ul className="tips">
                  {explainProblems(s.problems.filter((p) => p !== "stream_not_open")).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {(s.status === "live" || s.status === "scheduled") && (
                <div className="row">
                  <input
                    aria-label={`Reason to end ${s.title}`}
                    placeholder="Reason (logged)"
                    maxLength={500}
                    value={reason[s.id] ?? ""}
                    onChange={(e) => setReason({ ...reason, [s.id]: e.target.value })}
                  />
                  <button
                    className="btn small danger-solid"
                    disabled={busy}
                    onClick={() => {
                      const r = (reason[s.id] ?? "").trim();
                      if (r.length < 3) {
                        setError("Give a reason to end the stream.");
                        return;
                      }
                      void run(async () => {
                        const res = await adminApi.terminate(s.id, r);
                        if (!res.roomClosed)
                          throw new Error("Stream ended, but the provider room couldn't be closed.");
                      }, "Stream ended.");
                    }}
                  >
                    End now
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- Creator administration ----------

function CreatorRow({ c, reload }: { c: AdminCreator; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [v, setV] = useState({
    kind: "identity" as "identity" | "age",
    provider: "",
    reference: "",
    status: "passed",
    country: c.country_code,
    over18: true,
  });
  const [pct, setPct] = useState(c.revenue_share_pct?.toString() ?? "");
  const { busy, run, messages, setError } = useAction(reload);
  return (
    <li>
      <button className="row between admin-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <strong>{c.stage_name}</strong>{" "}
          <small className="muted">
            {c.country_code} · {CREATOR_STATUS[c.status] ?? c.status}
          </small>
        </span>
        <small>
          ID {c.identity_verified ? "✓" : "✗"} · Age {c.age_verified ? "✓" : "✗"}
        </small>
      </button>
      {open && (
        <div className="admin-detail">
          <p className="small muted">
            Categories: {c.categories.join(", ") || "—"} · Agreement: {c.agreement_version ?? "not accepted"}{" "}
            · Revenue share: {c.revenue_share_pct ?? "—"}%
          </p>
          <h4>Record a verification result</h4>
          <div className="row-wrap">
            <select
              aria-label="Kind"
              value={v.kind}
              onChange={(e) => setV({ ...v, kind: e.target.value as "identity" | "age" })}
            >
              <option value="identity">Identity</option>
              <option value="age">Age</option>
            </select>
            <select
              aria-label="Result"
              value={v.status}
              onChange={(e) => setV({ ...v, status: e.target.value })}
            >
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </select>
            <input
              aria-label="Verification provider"
              placeholder="Provider"
              value={v.provider}
              onChange={(e) => setV({ ...v, provider: e.target.value })}
            />
            <input
              aria-label="Case reference"
              placeholder="Case reference"
              value={v.reference}
              onChange={(e) => setV({ ...v, reference: e.target.value })}
            />
            <input
              aria-label="Verified country"
              placeholder="Country"
              maxLength={2}
              value={v.country}
              onChange={(e) => setV({ ...v, country: e.target.value.toUpperCase() })}
            />
            {v.kind === "age" && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={v.over18}
                  onChange={(e) => setV({ ...v, over18: e.target.checked })}
                />
                <span>Confirmed 18 or older</span>
              </label>
            )}
          </div>
          <button
            className="btn small"
            disabled={busy}
            onClick={() => {
              if (v.provider.trim().length < 2 || v.reference.trim().length < 3) {
                setError("Add the provider and its case reference (no document numbers).");
                return;
              }
              void run(() => adminApi.recordVerification(c.user_id, v), "Verification recorded.");
            }}
          >
            Record result
          </button>
          <h4>Decision</h4>
          <input
            aria-label="Reason"
            placeholder="Reason (shown to the creator, logged)"
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="row-wrap">
            <button
              className="btn small dark"
              disabled={busy || !c.identity_verified || !c.age_verified}
              onClick={() => void run(() => adminApi.review(c.user_id, "approved", reason), "Approved.")}
            >
              Approve
            </button>
            <button
              className="btn small"
              disabled={busy}
              onClick={() =>
                void run(() => adminApi.review(c.user_id, "verifying", reason), "Marked as verifying.")
              }
            >
              Verifying
            </button>
            <button
              className="btn small"
              disabled={busy}
              onClick={() => void run(() => adminApi.review(c.user_id, "rejected", reason), "Rejected.")}
            >
              Reject
            </button>
            <button
              className="btn small danger-solid"
              disabled={busy}
              onClick={() =>
                void run(
                  () => adminApi.review(c.user_id, "suspended", reason),
                  "Suspended. Their streams were ended.",
                )
              }
            >
              Suspend
            </button>
          </div>
          {(!c.identity_verified || !c.age_verified) && (
            <small className="muted">Approval needs passed identity and age checks.</small>
          )}
          <h4>Revenue share</h4>
          <div className="row">
            <input
              aria-label="Creator share percent"
              inputMode="decimal"
              placeholder="Creator %"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
            <button
              className="btn small"
              disabled={busy}
              onClick={() => {
                const n = Number(pct);
                if (!Number.isFinite(n) || n < 0 || n > 100) {
                  setError("Enter a percentage from 0 to 100.");
                  return;
                }
                void run(() => adminApi.revenueShare(c.user_id, n), "Revenue share saved.");
              }}
            >
              Save
            </button>
          </div>
          <small className="muted">
            Configuration only. No payouts happen until a payment provider is connected.
          </small>
          {messages}
        </div>
      )}
    </li>
  );
}

function TicketsAndAppeals() {
  const tickets = useLoad(() => adminApi.tickets());
  const appeals = useLoad(() => adminApi.appeals().catch(() => [] as AppealRow[]));
  const [reply, setReply] = useState<Record<string, string>>({});
  const reload = async () => {
    await Promise.all([tickets.reload(), appeals.reload()]);
  };
  const { busy, run, messages } = useAction(reload);
  return (
    <div className="panel">
      <h3>Support tickets and appeals</h3>
      {messages}
      {(appeals.data ?? [])
        .filter((a) => a.status === "open")
        .map((a: AppealRow) => (
          <div key={a.id} className="admin-detail">
            <strong>Appeal</strong> <small className="muted">{when(a.created_at)}</small>
            <p className="small">{a.statement}</p>
            <input
              aria-label="Decision note"
              placeholder="Decision note (logged)"
              value={reply[a.id] ?? ""}
              onChange={(e) => setReply({ ...reply, [a.id]: e.target.value })}
            />
            <div className="row-wrap">
              <button
                className="btn small dark"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => adminApi.decideAppeal(a.id, true, reply[a.id] ?? ""),
                    "Overturned: creator is back to verification.",
                  )
                }
              >
                Overturn
              </button>
              <button
                className="btn small"
                disabled={busy}
                onClick={() =>
                  void run(() => adminApi.decideAppeal(a.id, false, reply[a.id] ?? ""), "Upheld.")
                }
              >
                Uphold
              </button>
            </div>
          </div>
        ))}
      {(tickets.data ?? []).map((t: TicketRow) => (
        <div key={t.id} className="admin-detail">
          <strong>{t.subject}</strong>{" "}
          <small className="muted">
            {t.status} · {when(t.created_at)}
          </small>
          <p className="small">{t.body}</p>
          {t.admin_reply && <p className="alert info">Replied: {t.admin_reply}</p>}
          {t.status !== "closed" && (
            <>
              <textarea
                aria-label="Reply"
                rows={2}
                maxLength={2000}
                value={reply[t.id] ?? ""}
                onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })}
              />
              <div className="row-wrap">
                <button
                  className="btn small dark"
                  disabled={busy || !(reply[t.id] ?? "").trim()}
                  onClick={() =>
                    void run(() => adminApi.replyTicket(t.id, reply[t.id], false), "Reply sent.")
                  }
                >
                  Reply
                </button>
                <button
                  className="btn small"
                  disabled={busy || !(reply[t.id] ?? "").trim()}
                  onClick={() =>
                    void run(() => adminApi.replyTicket(t.id, reply[t.id], true), "Replied and closed.")
                  }
                >
                  Reply and close
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      {tickets.data?.length === 0 && (appeals.data ?? []).every((a) => a.status !== "open") && (
        <p className="muted">Nothing waiting.</p>
      )}
    </div>
  );
}

function AgreementAndRoles({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("Creator agreement");
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [role, setRole] = useState<"admin" | "moderator">("moderator");
  const { busy, run, messages, setError } = useAction(async () => undefined);
  if (!isAdmin) return null;
  return (
    <div className="panel">
      <h3>Creator agreement</h3>
      <div className="row-wrap">
        <input
          aria-label="Version"
          placeholder="Version, e.g. 2026.1"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
        />
        <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input
          aria-label="Document link"
          placeholder="https://… (the signed-off agreement)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <button
        className="btn small dark"
        disabled={busy}
        onClick={() => {
          if (!/^[0-9A-Za-z._-]{1,20}$/.test(version) || !/^https:\/\//.test(url)) {
            setError("Use a short version like 2026.1 and an https:// link.");
            return;
          }
          void run(
            () => adminApi.setAgreement(version, title, url, true),
            "Published. Creators must accept it before going live again.",
          );
        }}
      >
        Publish as current version
      </button>
      <h3>Team roles</h3>
      <div className="row-wrap">
        <input
          aria-label="User id"
          placeholder="Member's user id"
          value={user}
          onChange={(e) => setUser(e.target.value.trim())}
        />
        <select
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "moderator")}
        >
          <option value="moderator">Moderator</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div className="row-wrap">
        <button
          className="btn small"
          disabled={busy || !user}
          onClick={() => void run(() => adminApi.setRole(user, role, true), "Role granted.")}
        >
          Grant
        </button>
        <button
          className="btn small"
          disabled={busy || !user}
          onClick={() => void run(() => adminApi.setRole(user, role, false), "Role removed.")}
        >
          Remove
        </button>
      </div>
      {messages}
    </div>
  );
}

function CreatorsDashboard({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, reload } = useLoad(() => adminApi.creators());
  const [filter, setFilter] = useState("all");
  if (!data) return <Loading error={error} retry={() => void reload()} />;
  const shown = filter === "all" ? data : data.filter((c) => c.status === filter);
  return (
    <section className="studio-section">
      <div className="panel">
        <div className="row between">
          <h3>Creators ({data.length})</h3>
          <select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option>
            {Object.entries(CREATOR_STATUS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {shown.length === 0 && <p className="muted">No creators here.</p>}
        <ul className="admin-list">
          {shown.map((c) => (
            <CreatorRow key={c.user_id} c={c} reload={reload} />
          ))}
        </ul>
      </div>
      <TicketsAndAppeals />
      <AgreementAndRoles isAdmin={isAdmin} />
    </section>
  );
}

// ---------- Provider configuration ----------

const BLANK_PROVIDER: ProviderRow = {
  key: "",
  name: "",
  kind: "webrtc_sfu",
  api_endpoint: "wss://",
  credential_env: "LIVEKIT",
  supported_countries: [],
  permitted_categories: [],
  commercial_use: false,
  monetisation: false,
  contract_status: "none",
  contract_reference: null,
  terms_authorize_model: false,
  terms_reviewed_at: null,
  integration_status: "disabled",
  notes: null,
};

export function ProviderForm({
  initial,
  configured,
  onSaved,
}: {
  initial: ProviderRow;
  configured: boolean | null;
  onSaved: () => Promise<void>;
}) {
  const [p, setP] = useState(initial);
  const [countries, setCountries] = useState(initial.supported_countries.join(", "));
  const [categories, setCategories] = useState(initial.permitted_categories.join(", "));
  const [reviewed, setReviewed] = useState(false);
  const { busy, run, messages, setError } = useAction(onSaved);
  const parsed = parseCountries(countries);
  const draft = {
    ...p,
    supported_countries: parsed.codes,
    permitted_categories: categories.split(/[\s,]+/).filter(Boolean),
  };
  const blockers = [
    ...providerBlockers(draft, reviewed),
    ...(parsed.bad.length ? [`Not country codes: ${parsed.bad.join(", ")}`] : []),
  ];
  const isNew = !initial.key;
  return (
    <form
      className="panel form"
      noValidate
      aria-label={isNew ? "Add a provider" : `Provider ${initial.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!/^[a-z0-9_-]{2,30}$/.test(p.key) || p.name.trim().length < 2) {
          setError("Give it a short key (lower-case, e.g. livekit) and a name.");
          return;
        }
        if (blockers.length > 0) {
          setError("Fix the items listed above first.");
          return;
        }
        void run(() => adminApi.saveProvider(draft, reviewed), "Provider saved.");
      }}
    >
      <div className="row between">
        <h3>{isNew ? "Add a provider" : p.name}</h3>
        {!isNew && (
          <span className={`pill status-${p.integration_status === "enabled" ? "live" : "scheduled"}`}>
            {p.integration_status}
          </span>
        )}
      </div>
      {!isNew && (
        <p className="small">
          Server credentials:{" "}
          <strong>
            {configured === null ? "unknown" : configured ? "set on the server" : "not set on the server"}
          </strong>
        </p>
      )}
      <div className="row">
        <label className="field">
          <span>Key</span>
          <input
            value={p.key}
            disabled={!isNew}
            onChange={(e) => setP({ ...p, key: e.target.value.toLowerCase() })}
          />
        </label>
        <label className="field">
          <span>Name</span>
          <input value={p.name} maxLength={60} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>Type</span>
        <select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as ProviderRow["kind"] })}>
          <option value="webrtc_sfu">Live video service (WebRTC)</option>
          <option value="white_label">White-label streaming partner</option>
          <option value="affiliate">Affiliate partner</option>
        </select>
      </label>
      <label className="field">
        <span>API endpoint</span>
        <input
          value={p.api_endpoint}
          maxLength={200}
          onChange={(e) => setP({ ...p, api_endpoint: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Credentials setting name</span>
        <input
          value={p.credential_env ?? ""}
          maxLength={40}
          onChange={(e) => setP({ ...p, credential_env: e.target.value.toUpperCase() })}
        />
        <small className="muted">
          Never type an API key or secret here. Enter the secret values only in the Render settings for
          soulmate-api (for LiveKit: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).
        </small>
      </label>
      <label className="field">
        <span>Supported countries (codes, blank = provider's default)</span>
        <input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="IN, GB, US" />
      </label>
      <label className="field">
        <span>Permitted content categories</span>
        <input
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
          placeholder="talk, qa, music"
        />
      </label>
      <label className="field">
        <span>Contract status</span>
        <select
          value={p.contract_status}
          onChange={(e) => setP({ ...p, contract_status: e.target.value as ProviderRow["contract_status"] })}
        >
          <option value="none">None</option>
          <option value="negotiating">Negotiating</option>
          <option value="signed">Signed</option>
          <option value="expired">Expired</option>
          <option value="terminated">Terminated</option>
        </select>
      </label>
      <label className="field">
        <span>Contract reference</span>
        <input
          value={p.contract_reference ?? ""}
          maxLength={200}
          onChange={(e) => setP({ ...p, contract_reference: e.target.value })}
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={p.commercial_use}
          onChange={(e) => setP({ ...p, commercial_use: e.target.checked })}
        />
        <span>Terms permit commercial use</span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={p.monetisation}
          onChange={(e) => setP({ ...p, monetisation: e.target.checked })}
        />
        <span>Terms permit monetisation</span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={p.terms_authorize_model}
          onChange={(e) => setP({ ...p, terms_authorize_model: e.target.checked })}
        />
        <span>Written terms authorise our business model</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        <span>
          I have reviewed the terms now
          {p.terms_reviewed_at && (
            <small className="muted"> · last reviewed {when(p.terms_reviewed_at)}</small>
          )}
        </span>
      </label>
      <label className="field">
        <span>Integration status</span>
        <select
          value={p.integration_status}
          onChange={(e) =>
            setP({ ...p, integration_status: e.target.value as ProviderRow["integration_status"] })
          }
        >
          <option value="disabled">Disabled</option>
          <option value="testing">Testing</option>
          <option value="enabled">Enabled</option>
        </select>
      </label>
      <label className="field">
        <span>Notes</span>
        <input
          value={p.notes ?? ""}
          maxLength={1000}
          onChange={(e) => setP({ ...p, notes: e.target.value })}
        />
      </label>
      {blockers.length > 0 && (
        <ul className="tips" aria-label="Before saving">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {messages}
      <button className="btn dark block" disabled={busy}>
        {busy ? "Saving…" : "Save provider"}
      </button>
    </form>
  );
}

function ProvidersDashboard() {
  const { data, error, reload } = useLoad(() => adminApi.providers());
  const status = useLoad(() => adminApi.providerStatus().catch(() => ({ providers: [] })));
  const [adding, setAdding] = useState(false);
  if (!data) return <Loading error={error} retry={() => void reload()} />;
  const configured = (key: string) => {
    if (!status.data) return null;
    return status.data.providers.find((x) => x.key === key)?.configured ?? false;
  };
  return (
    <section className="studio-section">
      <p className="alert info">
        Only connect licensed providers whose written terms authorise our business model. Never use scraped
        streams or unofficial feeds.
      </p>
      {data.map((p) => (
        <ProviderForm key={p.key} initial={p} configured={configured(p.key)} onSaved={reload} />
      ))}
      {adding ? (
        <ProviderForm
          initial={BLANK_PROVIDER}
          configured={null}
          onSaved={async () => {
            setAdding(false);
            await reload();
          }}
        />
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          Add a provider
        </button>
      )}
    </section>
  );
}

// ---------- Shell ----------

export function AdminConsole({ onExit }: { onExit: () => void }) {
  const [roles, setRoles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("compliance");

  useEffect(() => {
    adminApi
      .roles()
      .then(setRoles)
      .catch(() => setError("RentMate Live isn't switched on yet, or you aren't signed in."));
  }, []);

  const isAdmin = roles?.includes("admin") ?? false;
  const isMod = isAdmin || (roles?.includes("moderator") ?? false);
  const sections: { key: Section; label: string; admin?: boolean }[] = [
    { key: "compliance", label: "Compliance" },
    { key: "streams", label: "Streams" },
    { key: "creators", label: "Creators" },
    { key: "providers", label: "Providers", admin: true },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn small" onClick={onExit}>
          ← Back
        </button>
        <span className="brand">RentMate Live · Admin</span>
      </header>
      <main className="shell studio admin">
        {error && <p className="alert error">{error}</p>}
        {!error && !roles && (
          <div className="empty">
            <div className="spinner" aria-hidden="true" />
          </div>
        )}
        {roles && !isMod && (
          <div className="empty small">
            <p className="alert error" role="alert">
              You don't have access to the admin console.
            </p>
          </div>
        )}
        {isMod && (
          <>
            <nav className="segmented scroll" role="tablist" aria-label="Admin sections">
              {sections
                .filter((s) => !s.admin || isAdmin)
                .map((s) => (
                  <button
                    key={s.key}
                    role="tab"
                    aria-selected={section === s.key}
                    className={section === s.key ? "active" : ""}
                    onClick={() => setSection(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
            </nav>
            {section === "compliance" && (
              <section className="studio-section">
                <EmergencyStop />
                <Reports />
                {isAdmin && <CountryPolicies />}
                {isAdmin && <ViewerAgeCheck />}
                <AuditLog />
              </section>
            )}
            {section === "streams" && <StreamsDashboard />}
            {section === "creators" && <CreatorsDashboard isAdmin={isAdmin} />}
            {section === "providers" && isAdmin && <ProvidersDashboard />}
          </>
        )}
      </main>
    </div>
  );
}
