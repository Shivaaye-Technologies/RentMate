import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAction } from "../live/useAction";
import { FinancialConfigAdmin } from "./FinancialConfigAdmin";
import type { Booking, Review } from "./marketData";
import { BOOKING_STATUS, COMPANION_STATUS, formatINR, marketError } from "./marketText";

type Section = "overview" | "companions" | "bookings" | "reviews" | "accounts" | "payments" | "pricing";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "companions", label: "Companions" },
  { key: "bookings", label: "Bookings & disputes" },
  { key: "reviews", label: "Reviews" },
  { key: "accounts", label: "Suspensions & appeals" },
  { key: "payments", label: "Payment accounts" },
  { key: "pricing", label: "Token pricing & tax" },
];

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(marketError(error));
  return data as T;
}

interface AdminCompanion {
  user_id: string;
  display_name: string;
  headline: string;
  city: string;
  status: string;
  verified: boolean;
  services: number;
  completed_bookings: number;
  rating: number | null;
  open_reports: number;
}

/** RentMate marketplace administration. Every action is authorised and logged by the database. */
export function MarketAdmin({ onExit }: { onExit: () => void }) {
  const [roles, setRoles] = useState<string[] | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    rpc<string[]>("my_live_roles")
      .then((r) => setRoles(r ?? []))
      .catch((e: Error) => setError(e.message));
  }, []);
  const allowed = !!roles && (roles.includes("admin") || roles.includes("moderator"));
  const isAdmin = !!roles?.includes("admin");
  return (
    <div className="app">
      <header className="topbar market-top">
        <button className="btn small" onClick={onExit}>
          ← Back
        </button>
        <span className="brand">RentMate · Marketplace admin</span>
      </header>
      <main className="shell studio market">
        {error && <p className="alert error">{error}</p>}
        {!roles && !error && <div className="spinner" aria-hidden="true" />}
        {roles && !allowed && (
          <p className="alert error" role="alert">
            This area is for RentMate moderators and admins.
          </p>
        )}
        {allowed && (
          <>
            <nav className="segmented scroll" role="tablist" aria-label="Marketplace admin">
              {SECTIONS.map((s) => (
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
            {section === "overview" && <Overview isAdmin={isAdmin} />}
            {section === "companions" && <Companions />}
            {section === "bookings" && <Bookings />}
            {section === "reviews" && <Reviews />}
            {section === "accounts" && <Accounts />}
            {section === "payments" && isAdmin && <PaymentAccounts />}
            {section === "payments" && !isAdmin && <p className="alert error">Payment configuration is restricted to administrators.</p>}
            {section === "pricing" && isAdmin && <FinancialConfigAdmin />}
            {section === "pricing" && !isAdmin && <p className="alert error">Financial configuration is restricted to administrators.</p>}
          </>
        )}
      </main>
    </div>
  );
}

function Overview({ isAdmin }: { isAdmin: boolean }) {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [pct, setPct] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setStats(await rpc<Record<string, unknown>>("admin_marketplace_stats"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load statistics.");
    }
  }, []);
  const { busy, run, messages } = useAction(reload);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (error) return <p className="alert error">{error}</p>;
  if (!stats) return <div className="spinner" aria-hidden="true" />;
  const obj = (k: string) => (stats[k] ?? {}) as Record<string, number>;
  return (
    <section className="studio-section">
      <div className="panel stat-grid">
        <div>
          <strong>{String(stats.members)}</strong>
          <span className="muted small">members</span>
        </div>
        <div>
          <strong>{obj("companions").approved ?? 0}</strong>
          <span className="muted small">approved companions ({obj("companions").pending ?? 0} waiting)</span>
        </div>
        <div>
          <strong>{obj("bookings").completed ?? 0}</strong>
          <span className="muted small">completed bookings</span>
        </div>
        <div>
          <strong>{String(stats.open_disputes)}</strong>
          <span className="muted small">open disputes</span>
        </div>
        <div>
          <strong>{formatINR(Number(stats.completed_booked_value_inr))}</strong>
          <span className="muted small">booked value (not payments)</span>
        </div>
        <div>
          <strong>{formatINR(Number(stats.estimated_commission_inr))}</strong>
          <span className="muted small">estimated commission</span>
        </div>
        <div>
          <strong>{String(stats.active_suspensions)}</strong>
          <span className="muted small">active suspensions</span>
        </div>
      </div>
      <p className="alert info small">
        Payments are {stats.payments_enabled ? "on" : "off"}. Revenue figures are estimates from completed
        bookings until a payment provider is approved and connected.
      </p>
      {isAdmin && (
        <form
          className="panel form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => rpc("admin_set_commission", { p_pct: Number(pct) }),
              "Commission updated for new bookings.",
            );
          }}
        >
          <h3>Platform commission</h3>
          <label className="field">
            <span>Commission on new bookings (%; 0–50)</span>
            <input
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          </label>
          {messages}
          <button className="btn dark" disabled={busy || pct === ""}>
            Save commission
          </button>
        </form>
      )}
    </section>
  );
}

function Companions() {
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState<AdminCompanion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setRows(await rpc<AdminCompanion[]>("admin_list_companions", { p_status: filter || null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load companions.");
    }
  }, [filter]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <section className="studio-section">
      <label className="field">
        <span>Show</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option>
          {Object.entries(COMPANION_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="alert error">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">Nothing here.</p>}
      <ul className="admin-list">
        {rows?.map((c) => (
          <CompanionRow key={c.user_id} c={c} reload={reload} />
        ))}
      </ul>
    </section>
  );
}

function CompanionRow({ c, reload }: { c: AdminCompanion; reload: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState(c.verified);
  const { busy, run, messages } = useAction(reload);
  const decide = (status: string) =>
    void run(
      () =>
        rpc("admin_review_companion", {
          p_user: c.user_id,
          p_status: status,
          p_verified: verified,
          p_reason: note || null,
        }),
      `Saved: ${COMPANION_STATUS[status] ?? status}.`,
    );
  return (
    <li>
      <div className="row between">
        <strong>{c.display_name}</strong>
        <span className="pill">{COMPANION_STATUS[c.status] ?? c.status}</span>
      </div>
      <p className="small">
        {c.headline} · {c.city}
      </p>
      <p className="muted small">
        {c.services} activities · {c.completed_bookings} completed ·{" "}
        {c.rating ? `★ ${c.rating}` : "no rating"} · {c.open_reports} reports
      </p>
      <label className="check-row">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        <span>Identity and age verified (result from the verification partner)</span>
      </label>
      <input
        aria-label="Note"
        placeholder="Note to the companion (logged)"
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {messages}
      <div className="row-wrap">
        <button className="btn dark small" disabled={busy} onClick={() => decide("approved")}>
          Approve
        </button>
        <button className="btn small" disabled={busy} onClick={() => decide("rejected")}>
          Reject
        </button>
        <button className="btn small danger" disabled={busy} onClick={() => decide("suspended")}>
          Suspend listing
        </button>
      </div>
    </li>
  );
}

function Bookings() {
  const [filter, setFilter] = useState("disputed");
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setRows(await rpc<Booking[]>("admin_list_bookings", { p_status: filter || null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load bookings.");
    }
  }, [filter]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <section className="studio-section">
      <label className="field">
        <span>Show</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option>
          {Object.entries(BOOKING_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="alert error">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">Nothing here.</p>}
      <ul className="admin-list">
        {rows?.map((b) => (
          <BookingRow key={b.id} b={b} reload={reload} />
        ))}
      </ul>
    </section>
  );
}

function BookingRow({
  b,
  reload,
}: {
  b: Booking & { dispute_reason?: string | null };
  reload: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const { busy, run, messages } = useAction(reload);
  return (
    <li>
      <div className="row between">
        <strong>
          {b.reference} · {b.service_title}
        </strong>
        <span className="pill">{BOOKING_STATUS[b.status] ?? b.status}</span>
      </div>
      <p className="small">
        {new Date(b.starts_at).toLocaleString()} · {b.meeting_point} · {formatINR(b.price_inr)} (
        {b.commission_pct}% commission)
      </p>
      {b.dispute_reason && <p className="muted small">Dispute: {b.dispute_reason}</p>}
      {b.status === "disputed" && (
        <>
          <input
            aria-label="Resolution note"
            placeholder="Resolution note (sent to both, logged)"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {messages}
          <div className="row-wrap">
            <button
              className="btn dark small"
              disabled={busy || !note.trim()}
              onClick={() =>
                void run(
                  () =>
                    rpc("admin_resolve_dispute", { p_booking: b.id, p_outcome: "completed", p_note: note }),
                  "Resolved: booking stands.",
                )
              }
            >
              Booking stands
            </button>
            <button
              className="btn small"
              disabled={busy || !note.trim()}
              onClick={() =>
                void run(
                  () =>
                    rpc("admin_resolve_dispute", { p_booking: b.id, p_outcome: "cancelled", p_note: note }),
                  "Resolved: cancelled.",
                )
              }
            >
              Cancel booking
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function Reviews() {
  const [rows, setRows] = useState<(Review & { hidden_reason?: string | null })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setRows(await rpc("admin_list_reviews", { p_status: null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load reviews.");
    }
  }, []);
  const { busy, run, messages } = useAction(reload);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (error) return <p className="alert error">{error}</p>;
  if (!rows) return <div className="spinner" aria-hidden="true" />;
  if (rows.length === 0) return <p className="muted">No reviews yet.</p>;
  return (
    <section className="studio-section">
      {messages}
      <ul className="admin-list">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="row between">
              <strong>{"★".repeat(r.rating)}</strong>
              <span className="pill">{r.status}</span>
            </div>
            {r.comment && <p>{r.comment}</p>}
            <button
              className="btn small"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  rpc("admin_set_review_status", {
                    p_review: r.id,
                    p_visible: r.status !== "visible",
                    p_reason: r.status === "visible" ? "Hidden by moderator" : null,
                  }),
                )
              }
            >
              {r.status === "visible" ? "Hide review" : "Show review"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Accounts() {
  const [user, setUser] = useState("");
  const [reason, setReason] = useState("");
  const [appeals, setAppeals] = useState<
    { id: string; user_id: string; statement: string; status: string }[] | null
  >(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const reload = useCallback(async () => {
    setAppeals(await rpc("admin_list_account_appeals"));
  }, []);
  const { busy, run, messages } = useAction(reload);
  useEffect(() => {
    void reload().catch(() => setAppeals([]));
  }, [reload]);
  const validId = /^[0-9a-f-]{36}$/i.test(user.trim());
  return (
    <section className="studio-section">
      <div className="panel form">
        <h3>Suspend or restore an account</h3>
        <label className="field">
          <span>User id</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="From a report or booking"
          />
        </label>
        <label className="field">
          <span>Reason (shown to the person, logged)</span>
          <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
        </label>
        {messages}
        <div className="row-wrap">
          <button
            className="btn small danger"
            disabled={busy || !validId || reason.trim().length < 3}
            onClick={() =>
              void run(
                () => rpc("admin_suspend_account", { p_user: user.trim(), p_reason: reason.trim() }),
                "Account suspended; upcoming bookings cancelled.",
              )
            }
          >
            Suspend
          </button>
          <button
            className="btn small"
            disabled={busy || !validId}
            onClick={() =>
              void run(
                () => rpc("admin_lift_suspension", { p_user: user.trim(), p_note: reason.trim() || null }),
                "Suspension lifted.",
              )
            }
          >
            Lift suspension
          </button>
        </div>
      </div>
      <div className="panel">
        <h3>Appeals</h3>
        {!appeals ? (
          <div className="spinner" aria-hidden="true" />
        ) : appeals.length === 0 ? (
          <p className="muted">No appeals.</p>
        ) : (
          <ul className="admin-list">
            {appeals.map((a) => (
              <li key={a.id}>
                <div className="row between">
                  <strong className="small">{a.user_id}</strong>
                  <span className="pill">{a.status}</span>
                </div>
                <p>{a.statement}</p>
                {a.status === "open" && (
                  <>
                    <input
                      aria-label="Decision note"
                      placeholder="Decision note (sent and logged)"
                      value={notes[a.id] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                    />
                    <div className="row-wrap">
                      <button
                        className="btn dark small"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              rpc("admin_decide_account_appeal", {
                                p_appeal: a.id,
                                p_overturn: true,
                                p_note: notes[a.id] ?? null,
                              }),
                            "Overturned; account restored.",
                          )
                        }
                      >
                        Overturn
                      </button>
                      <button
                        className="btn small"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              rpc("admin_decide_account_appeal", {
                                p_appeal: a.id,
                                p_overturn: false,
                                p_note: notes[a.id] ?? null,
                              }),
                            "Suspension upheld.",
                          )
                        }
                      >
                        Uphold
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ReturningAccounts />
    </section>
  );
}

/**
 * F-20: sign-ups whose email matches an account deleted while suspended. Shown for review only: nobody is suspended
 * automatically, and no email or hash is ever shown.
 */
function ReturningAccounts() {
  const [flags, setFlags] = useState<
    | {
        match_id: number;
        user_id: string;
        display_name: string | null;
        matched_at: string;
        previous_suspension_at: string;
        previous_account_deleted_at: string;
        reviewed_at: string | null;
      }[]
    | null
  >(null);
  const reload = useCallback(async () => {
    setFlags(await rpc("admin_list_retention_matches"));
  }, []);
  const { busy, run, messages } = useAction(reload);
  useEffect(() => {
    void reload().catch(() => setFlags([]));
  }, [reload]);
  const day = (iso: string) => new Date(iso).toLocaleDateString();
  return (
    <div className="panel">
      <h3>Returning accounts</h3>
      <p className="muted small">
        New sign-ups whose email matches an account that was deleted while suspended. Review the person&apos;s
        activity; suspend only if there is new cause. Records expire after the retention period.
      </p>
      {messages}
      {!flags ? (
        <div className="spinner" aria-hidden="true" />
      ) : flags.length === 0 ? (
        <p className="muted">No returning accounts.</p>
      ) : (
        <ul className="admin-list">
          {flags.map((f) => (
            <li key={f.match_id}>
              <div className="row between">
                <strong className="small">{f.display_name ?? "Deleted account"}</strong>
                <span className="pill">{f.reviewed_at ? "reviewed" : "needs review"}</span>
              </div>
              <p className="small">
                User id {f.user_id} · signed up {day(f.matched_at)} · earlier account suspended{" "}
                {day(f.previous_suspension_at)}, deleted {day(f.previous_account_deleted_at)}
              </p>
              {!f.reviewed_at && (
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => rpc("admin_review_retention_match", { p_match: f.match_id }),
                      "Marked as reviewed.",
                    )
                  }
                >
                  Mark reviewed
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        className="btn small"
        disabled={busy}
        onClick={() =>
          void run(
            () => rpc<number>("admin_purge_expired_retention"),
            "Expired records purged (their identifying hashes were erased).",
          )
        }
      >
        Purge expired records
      </button>
    </div>
  );
}
