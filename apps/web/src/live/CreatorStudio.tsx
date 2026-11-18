import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAction } from "./useAction";
import {
  creatorApi,
  latestVerification,
  loadCreatorState,
  type CreatorState,
  type StreamRow,
} from "./creatorData";
import {
  categoryAllowedFor,
  COUNTRIES,
  CREATOR_STATUS,
  explainProblems,
  fromMinutes,
  scheduleProblem,
  STREAM_STATUS,
  toMinutes,
  validateCreator,
  WEEKDAYS,
  type CreatorDraft,
  type CreatorErrors,
} from "./liveText";

type Tab = "overview" | "streams" | "consent" | "availability" | "sessions" | "support";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "streams", label: "Streams" },
  { key: "consent", label: "Consent" },
  { key: "availability", label: "Availability" },
  { key: "sessions", label: "Sessions" },
  { key: "support", label: "Support" },
];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not scheduled";

/** Creator application (and editing your details later). */
export function ApplicationForm({
  me,
  state,
  reload,
}: {
  me: string;
  state: CreatorState;
  reload: () => Promise<void>;
}) {
  const c = state.creator;
  const [d, setD] = useState<CreatorDraft>({
    stageName: c?.stage_name ?? "",
    bio: c?.bio ?? "",
    countryCode: c?.country_code ?? "",
    categories: c?.categories ?? [],
  });
  const [errors, setErrors] = useState<CreatorErrors>({});
  const [agree, setAgree] = useState(false);
  const { busy, run, messages } = useAction(reload);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateCreator(d);
    setErrors(errs);
    if (Object.keys(errs).length > 0 || (!c && !agree)) return;
    await run(
      () => (c ? creatorApi.update(me, d) : creatorApi.apply(me, d)),
      c ? "Your details are saved." : "Application sent. Next: verification.",
    );
  }

  const toggle = (key: string) =>
    setD((x) => ({
      ...x,
      categories: x.categories.includes(key) ? x.categories.filter((k) => k !== key) : [...x.categories, key],
    }));

  return (
    <form
      className="panel form"
      onSubmit={submit}
      noValidate
      aria-label={c ? "Your creator details" : "Apply as a creator"}
    >
      <h2 className="display-sm">{c ? "Your creator details" : "Apply to broadcast"}</h2>
      {!c && (
        <ul className="tips">
          <li>You must be 18 or older. Identity and age are checked by a verification partner.</li>
          <li>Only broadcast yourself and people who have given their own recorded consent.</li>
          <li>Never share content you don't own, leaked or stolen videos, or anything involving minors.</li>
        </ul>
      )}
      <label className="field">
        <span>Stage name</span>
        <input
          value={d.stageName}
          maxLength={40}
          onChange={(e) => setD({ ...d, stageName: e.target.value })}
        />
        {errors.stageName && <small className="err">{errors.stageName}</small>}
      </label>
      <label className="field">
        <span>About your streams</span>
        <textarea
          rows={3}
          maxLength={500}
          value={d.bio}
          onChange={(e) => setD({ ...d, bio: e.target.value })}
        />
        <small className="muted">{d.bio.length}/500</small>
      </label>
      <label className="field">
        <span>Country you broadcast from</span>
        <select
          value={d.countryCode}
          disabled={!!c}
          onChange={(e) => {
            const cc = e.target.value;
            setD((x) => ({
              ...x,
              countryCode: cc,
              categories: x.categories.filter((k) =>
                categoryAllowedFor(cc, state.categories.find((cat) => cat.key === k)?.explicit ?? false),
              ),
            }));
          }}
        >
          <option value="">Choose…</option>
          {COUNTRIES.map((x) => (
            <option key={x.code} value={x.code}>
              {x.name}
            </option>
          ))}
        </select>
        {c && (
          <small className="muted">
            Your country is confirmed by verification and can't be changed here.
          </small>
        )}
        {errors.countryCode && <small className="err">{errors.countryCode}</small>}
      </label>
      <fieldset className="field">
        <span>What you'll broadcast</span>
        <div className="chips pick" role="group" aria-label="Categories">
          {state.categories.map((cat) => {
            const allowed = categoryAllowedFor(d.countryCode, cat.explicit);
            const on = d.categories.includes(cat.key);
            return (
              <button
                key={cat.key}
                type="button"
                className={on ? "chip toggle on" : "chip toggle"}
                aria-pressed={on}
                disabled={!allowed && !on}
                onClick={() => toggle(cat.key)}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
        {state.categories.some((x) => x.explicit) && (
          <small className="muted">
            Adult categories are never available in India. Elsewhere they open only in countries where
            RentMate has written legal clearance, and every viewer must pass an age check.
          </small>
        )}
        {errors.categories && <small className="err">{errors.categories}</small>}
      </fieldset>
      {!c && (
        <label className="check-row">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I confirm I am 18 or older and will only broadcast content I own, with the recorded consent of
            everyone who appears.
          </span>
        </label>
      )}
      {messages}
      <button className="btn dark block" disabled={busy || (!c && !agree)}>
        {busy ? "Saving…" : c ? "Save details" : "Send application"}
      </button>
    </form>
  );
}

/** Where your application stands, with the next step. */
export function Overview({ state, reload }: { state: CreatorState; reload: () => Promise<void> }) {
  const c = state.creator!;
  const identity = latestVerification(state.verifications, "identity");
  const age = latestVerification(state.verifications, "age");
  const agreed =
    !!state.agreement && c.agreement_version === state.agreement.version && !!c.agreement_accepted_at;
  const { busy, run, messages } = useAction(reload);
  const steps = [
    { label: "Application", done: true, detail: CREATOR_STATUS[c.status] ?? c.status },
    {
      label: "Creator agreement",
      done: agreed,
      detail: state.agreement
        ? agreed
          ? `Accepted version ${c.agreement_version}`
          : "Not accepted yet"
        : "Not published yet",
    },
    {
      label: "Identity verification",
      done: identity === "passed",
      detail: identity === "none" ? "Not started" : identity,
    },
    { label: "Age verification", done: age === "passed", detail: age === "none" ? "Not started" : age },
    { label: "Approval", done: c.status === "approved", detail: CREATOR_STATUS[c.status] ?? c.status },
  ];
  return (
    <section className="studio-section">
      <div className="panel">
        <h2 className="display-sm">{c.stage_name}</h2>
        <p className="muted">
          Status: <strong>{CREATOR_STATUS[c.status] ?? c.status}</strong>
          {c.status_reason ? ` · ${c.status_reason}` : ""}
        </p>
        <ol className="checklist">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? "done" : ""}>
              <span aria-hidden="true">{s.done ? "✓" : "•"}</span>
              <span>
                <strong>{s.label}</strong>
                <small className="muted">{s.detail}</small>
              </span>
            </li>
          ))}
        </ol>
        {(identity === "none" || age === "none") && (
          <p className="alert info">
            Our team will send you a secure link from our verification partner. We store only the result,
            never photos of your documents.
          </p>
        )}
      </div>
      {state.agreement && !agreed && (
        <div className="panel">
          <h3>{state.agreement.title}</h3>
          <p className="muted small">Version {state.agreement.version}</p>
          <a href={state.agreement.document_url} target="_blank" rel="noreferrer">
            Read the agreement
          </a>
          {messages}
          <button
            className="btn dark block"
            disabled={busy}
            onClick={() =>
              void run(() => creatorApi.acceptAgreement(state.agreement!.version), "Agreement accepted.")
            }
          >
            I've read it and accept
          </button>
        </div>
      )}
    </section>
  );
}

function StreamCard({ s, reload }: { s: StreamRow; reload: () => Promise<void> }) {
  const [problems, setProblems] = useState<string[] | null>(null);
  const { busy, run, messages } = useAction(reload);
  const open = s.status === "scheduled" || s.status === "live";
  return (
    <li className="panel stream-card">
      <div className="row between">
        <strong>{s.title}</strong>
        <span className={`pill status-${s.status}`}>{STREAM_STATUS[s.status] ?? s.status}</span>
      </div>
      <p className="muted small">
        {when(s.scheduled_at)} · {s.category}
        {s.participants.length > 0 ? ` · ${s.participants.length} co-performer(s)` : ""}
      </p>
      {problems && problems.length > 0 && (
        <ul className="tips" aria-label="Before you can go live">
          {explainProblems(problems).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {problems && problems.length === 0 && s.status === "scheduled" && (
        <p className="alert info">Everything is ready.</p>
      )}
      {messages}
      {open && (
        <div className="row-wrap">
          {s.status === "scheduled" && (
            <>
              <button
                className="btn small"
                disabled={busy}
                onClick={() => void run(async () => setProblems(await creatorApi.readiness(s.id)))}
              >
                Check readiness
              </button>
              <button
                className="btn small dark"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const p = await creatorApi.start(s.id);
                    setProblems(p);
                    if (p.length > 0) throw new Error("Not ready to go live yet.");
                  }, "You're live.")
                }
              >
                Go live
              </button>
            </>
          )}
          <button
            className="btn small"
            disabled={busy}
            onClick={() => void run(() => creatorApi.end(s.id), "Stream ended.")}
          >
            {s.status === "live" ? "End stream" : "Cancel"}
          </button>
        </div>
      )}
    </li>
  );
}

function Streams({ me, state, reload }: { me: string; state: CreatorState; reload: () => Promise<void> }) {
  const approved = state.creator?.status === "approved";
  const allowed = state.categories.filter((c) => state.creator?.categories.includes(c.key));
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(allowed[0]?.key ?? "");
  const [at, setAt] = useState("");
  const [partners, setPartners] = useState<string[]>([]);
  const [others, setOthers] = useState<{ user_id: string; stage_name: string }[]>([]);
  const { busy, run, messages, setError } = useAction(reload);

  useEffect(() => {
    if (!approved) return;
    creatorApi
      .approvedCreators()
      .then((list) => setOthers(list.filter((x) => x.user_id !== me)))
      .catch(() => setOthers([]));
  }, [approved, me]);

  async function schedule(e: FormEvent) {
    e.preventDefault();
    const problem =
      title.trim().length < 3 ? "Give your stream a title (3+ characters)." : scheduleProblem(at);
    if (problem || !category) {
      setError(problem ?? "Choose a category.");
      return;
    }
    const ok = await run(
      () =>
        creatorApi.schedule(me, {
          title,
          category,
          scheduledAt: at ? new Date(at).toISOString() : null,
          participants: partners,
        }),
      partners.length > 0
        ? "Scheduled. Each co-performer must now record their consent in their own Consent tab."
        : "Stream scheduled.",
    );
    if (ok) {
      setTitle("");
      setAt("");
      setPartners([]);
    }
  }

  return (
    <section className="studio-section">
      {!approved ? (
        <p className="alert info">You can schedule streams once your account is approved.</p>
      ) : (
        <form className="panel form" onSubmit={schedule} noValidate aria-label="Schedule a stream">
          <h3>Schedule a stream</h3>
          <label className="field">
            <span>Title</span>
            <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {allowed.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Start time (optional)</span>
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </label>
          {others.length > 0 && (
            <fieldset className="field">
              <span>Co-performers (optional, up to 4)</span>
              <div className="chips pick">
                {others.map((o) => {
                  const on = partners.includes(o.user_id);
                  return (
                    <button
                      key={o.user_id}
                      type="button"
                      aria-pressed={on}
                      className={on ? "chip toggle on" : "chip toggle"}
                      disabled={!on && partners.length >= 4}
                      onClick={() =>
                        setPartners((p) => (on ? p.filter((x) => x !== o.user_id) : [...p, o.user_id]))
                      }
                    >
                      {o.stage_name}
                    </button>
                  );
                })}
              </div>
              <small className="muted">
                Only approved, verified creators. Each must record their own consent.
              </small>
            </fieldset>
          )}
          {messages}
          <button className="btn dark block" disabled={busy}>
            {busy ? "Saving…" : "Schedule"}
          </button>
        </form>
      )}
      {state.myStreams.length === 0 ? (
        <p className="muted">No streams yet.</p>
      ) : (
        <ul className="stream-list">
          {state.myStreams.map((s) => (
            <StreamCard key={s.id} s={s} reload={reload} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Streams you were invited to: record or withdraw your own consent. */
export function Consent({
  me,
  state,
  reload,
}: {
  me: string;
  state: CreatorState;
  reload: () => Promise<void>;
}) {
  const [scope, setScope] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState<Record<string, string>>({});
  const { busy, run, messages, setError } = useAction(reload);
  const mine = (id: string) => state.consents.find((c) => c.stream_id === id && c.participant_id === me);

  return (
    <section className="studio-section">
      <p className="muted">
        When another creator invites you to a stream, you record your own consent here. Nobody can give
        consent for you, and you can withdraw it any time before or during the stream.
      </p>
      {messages}
      {state.invitedStreams.length === 0 && <p className="muted">No invitations.</p>}
      <ul className="stream-list">
        {state.invitedStreams.map((s) => {
          const c = mine(s.id);
          const active = c && !c.revoked_at;
          return (
            <li key={s.id} className="panel stream-card">
              <strong>{s.title}</strong>
              <p className="muted small">
                {when(s.scheduled_at)} · {s.category} · {STREAM_STATUS[s.status] ?? s.status}
              </p>
              {active ? (
                <>
                  <p className="alert info">
                    Consent recorded {new Date(c.signed_at).toLocaleString()} ({c.consent_scope}).
                  </p>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => void run(() => creatorApi.revokeConsent(s.id), "Consent withdrawn.")}
                  >
                    Withdraw consent
                  </button>
                </>
              ) : (
                <form
                  className="form"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    const sc = (scope[s.id] ?? "").trim();
                    const d = (doc[s.id] ?? "").trim();
                    if (sc.length < 3 || d.length < 3) {
                      setError("Describe what you agree to and add the signed consent form reference.");
                      return;
                    }
                    void run(() => creatorApi.giveConsent(s.id, sc, d), "Consent recorded.");
                  }}
                >
                  <label className="field">
                    <span>What you agree to</span>
                    <input
                      maxLength={500}
                      placeholder="For example: appearing on camera in this stream"
                      value={scope[s.id] ?? ""}
                      onChange={(e) => setScope({ ...scope, [s.id]: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Signed consent form reference</span>
                    <input
                      maxLength={200}
                      placeholder="Reference from the e-signature email"
                      value={doc[s.id] ?? ""}
                      onChange={(e) => setDoc({ ...doc, [s.id]: e.target.value })}
                    />
                  </label>
                  <button className="btn small dark" disabled={busy}>
                    Record my consent
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Availability({
  me,
  state,
  reload,
}: {
  me: string;
  state: CreatorState;
  reload: () => Promise<void>;
}) {
  const [day, setDay] = useState(1);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("21:00");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  const { busy, run, messages, setError } = useAction(reload);
  const sorted = [...state.availability].sort(
    (a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute,
  );
  return (
    <section className="studio-section">
      <form
        className="panel form"
        noValidate
        aria-label="Add availability"
        onSubmit={(e) => {
          e.preventDefault();
          const s = toMinutes(start);
          const en = toMinutes(end);
          if (s === null || en === null || s >= en) {
            setError("Choose a start time before the end time.");
            return;
          }
          void run(() => creatorApi.addAvailability(me, day, s, en, tz), "Availability added.");
        }}
      >
        <h3>When you're usually available</h3>
        <div className="row">
          <label className="field">
            <span>Day</span>
            <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>From</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <small className="muted">Times are in {tz}.</small>
        {messages}
        <button className="btn dark block" disabled={busy}>
          Add
        </button>
      </form>
      {sorted.length === 0 ? (
        <p className="muted">No availability yet.</p>
      ) : (
        <ul className="plain-list">
          {sorted.map((a) => (
            <li key={a.id}>
              <span>
                {WEEKDAYS[a.weekday]} {fromMinutes(a.start_minute)}–{fromMinutes(a.end_minute)}{" "}
                <small className="muted">{a.timezone}</small>
              </span>
              <button
                className="btn small"
                disabled={busy}
                onClick={() => void run(() => creatorApi.removeAvailability(a.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Sessions({ state, reload }: { state: CreatorState; reload: () => Promise<void> }) {
  const { busy, run, messages } = useAction(reload);
  return (
    <section className="studio-section">
      <p className="muted">Private video and audio sessions people requested with you.</p>
      {messages}
      {state.sessions.length === 0 && <p className="muted">No requests yet.</p>}
      <ul className="plain-list">
        {state.sessions.map((s) => (
          <li key={s.id}>
            <span>
              <strong>{s.mode === "audio" ? "Audio" : "Video"} session</strong>
              <small className="muted">
                {s.category} · {when(s.requested_for)} · {s.status}
              </small>
            </span>
            {s.status === "requested" && (
              <span className="row">
                <button
                  className="btn small dark"
                  disabled={busy}
                  onClick={() => void run(() => creatorApi.answerSession(s.id, true), "Accepted.")}
                >
                  Accept
                </button>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => void run(() => creatorApi.answerSession(s.id, false), "Declined.")}
                >
                  Decline
                </button>
              </span>
            )}
            {(s.status === "accepted" || s.status === "active") && (
              <button
                className="btn small"
                disabled={busy}
                onClick={() => void run(() => creatorApi.endSession(s.id), "Session ended.")}
              >
                End
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Support({ me, state, reload }: { me: string; state: CreatorState; reload: () => Promise<void> }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [statement, setStatement] = useState("");
  const { busy, run, messages, setError } = useAction(reload);
  const canAppeal =
    (state.creator?.status === "suspended" || state.creator?.status === "rejected") &&
    !state.appeals.some((a) => a.status === "open");
  return (
    <section className="studio-section">
      {canAppeal && (
        <form
          className="panel form"
          noValidate
          aria-label="Appeal"
          onSubmit={(e) => {
            e.preventDefault();
            if (statement.trim().length < 10) {
              setError("Explain your appeal in at least 10 characters.");
              return;
            }
            void run(() => creatorApi.appeal(me, statement), "Appeal sent. An admin will review it.").then(
              (ok) => ok && setStatement(""),
            );
          }}
        >
          <h3>Appeal this decision</h3>
          <textarea
            rows={4}
            maxLength={2000}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
          <button className="btn dark block" disabled={busy}>
            Send appeal
          </button>
        </form>
      )}
      {state.appeals.map((a) => (
        <div key={a.id} className="panel">
          <strong>Appeal · {a.status}</strong>
          <p className="small">{a.statement}</p>
          {a.decision_note && <p className="alert info">{a.decision_note}</p>}
        </div>
      ))}
      <form
        className="panel form"
        noValidate
        aria-label="Contact creator support"
        onSubmit={(e) => {
          e.preventDefault();
          if (subject.trim().length < 3 || body.trim().length < 3) {
            setError("Add a subject and a message.");
            return;
          }
          void run(() => creatorApi.openTicket(me, subject, body), "Message sent to creator support.").then(
            (ok) => {
              if (ok) {
                setSubject("");
                setBody("");
              }
            },
          );
        }}
      >
        <h3>Contact creator support</h3>
        <label className="field">
          <span>Subject</span>
          <input maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        {messages}
        <button className="btn dark block" disabled={busy}>
          Send
        </button>
      </form>
      {state.tickets.map((t) => (
        <div key={t.id} className="panel">
          <strong>{t.subject}</strong> <small className="muted">· {t.status}</small>
          <p className="small">{t.body}</p>
          {t.admin_reply && <p className="alert info">Support: {t.admin_reply}</p>}
        </div>
      ))}
    </section>
  );
}

/** RentMate Live creator portal: apply, verify, agree, schedule, consent, support. */
export function CreatorStudio({ me, onExit }: { me: string; onExit: () => void }) {
  const [state, setState] = useState<CreatorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const reload = useCallback(async () => {
    try {
      setState(await loadCreatorState(me));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(
        /creators|content_categories|does not exist|schema cache/i.test(msg)
          ? "RentMate Live isn't switched on yet. Please check back soon."
          : "Couldn't load the creator studio. Please try again.",
      );
    }
  }, [me]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn small" onClick={onExit}>
          ← Back
        </button>
        <span className="brand">RentMate Live · Creator studio</span>
      </header>
      <main className="shell studio">
        {error && (
          <div className="empty small">
            <p className="alert error" role="alert">
              {error}
            </p>
            <button className="btn dark" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        )}
        {!error && !state && (
          <div className="empty">
            <div className="spinner" aria-hidden="true" />
          </div>
        )}
        {state && !state.creator && <ApplicationForm me={me} state={state} reload={reload} />}
        {state?.creator && (
          <>
            <nav className="segmented scroll" role="tablist" aria-label="Creator studio">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? "active" : ""}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === "consent" && state.invitedStreams.length > 0
                    ? ` (${state.invitedStreams.length})`
                    : ""}
                </button>
              ))}
            </nav>
            {tab === "overview" && (
              <>
                <Overview state={state} reload={reload} />
                <ApplicationForm me={me} state={state} reload={reload} />
              </>
            )}
            {tab === "streams" && <Streams me={me} state={state} reload={reload} />}
            {tab === "consent" && <Consent me={me} state={state} reload={reload} />}
            {tab === "availability" && <Availability me={me} state={state} reload={reload} />}
            {tab === "sessions" && <Sessions state={state} reload={reload} />}
            {tab === "support" && <Support me={me} state={state} reload={reload} />}
          </>
        )}
      </main>
    </div>
  );
}
