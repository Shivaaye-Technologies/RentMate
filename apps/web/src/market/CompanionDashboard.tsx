import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAction } from "../live/useAction";
import { BookingsList } from "./BookingsList";
import { MarketChat } from "./MarketChat";
import {
  marketApi,
  namesFor,
  type Availability,
  type Booking,
  type Category,
  type CompanionProfile,
  type Review,
  type Service,
  type Settings,
} from "./marketData";
import {
  COMPANION_STATUS,
  formatINR,
  fromMinutes,
  MARKET_RULES,
  minutesLabel,
  splitList,
  toMinutes,
  validateCompanion,
  validateService,
  WEEKDAYS,
  type CompanionDraft,
  type ServiceDraft,
} from "./marketText";

type Tab = "overview" | "requests" | "services" | "availability" | "messages" | "profile";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "requests", label: "Bookings" },
  { key: "services", label: "Activities & prices" },
  { key: "availability", label: "Availability" },
  { key: "messages", label: "Messages" },
  { key: "profile", label: "Profile" },
];

interface State {
  profile: CompanionProfile | null;
  categories: Category[];
  services: Service[];
  availability: Availability[];
  bookings: Booking[];
  names: Record<string, string>;
  reviews: Review[];
  earnings: Awaited<ReturnType<typeof marketApi.earnings>>;
  settings: Settings | null;
}

/** Companion side of the marketplace. */
export function CompanionDashboard({ me, onExit }: { me: string; onExit: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const reload = useCallback(async () => {
    try {
      const [profile, categories, settings] = await Promise.all([
        marketApi.companion(me),
        marketApi.categories(),
        marketApi.settings(),
      ]);
      if (!profile) {
        setState({
          profile: null,
          categories,
          services: [],
          availability: [],
          bookings: [],
          names: {},
          reviews: [],
          earnings: {
            completed_bookings: 0,
            booked_value_inr: 0,
            commission_inr: 0,
            estimated_earnings_inr: 0,
          },
          settings,
        });
        return;
      }
      const [services, availability, all, reviews, earnings] = await Promise.all([
        marketApi.services(me, false),
        marketApi.availability(me),
        marketApi.myBookings(),
        marketApi.myReviews(me),
        marketApi.earnings(),
      ]);
      const bookings = all.filter((b) => b.companion_id === me);
      setState({
        profile,
        categories,
        services,
        availability,
        bookings,
        names: await namesFor(bookings.map((b) => b.member_id)),
        reviews,
        earnings,
        settings,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your dashboard.");
    }
  }, [me]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const open = state?.bookings.filter((b) => b.status === "requested" || b.status === "pending").length ?? 0;

  return (
    <div className="app">
      <header className="topbar market-top">
        <button className="btn small" onClick={onExit}>
          ← Back
        </button>
        <span className="brand">RentMate · Companion dashboard</span>
        <a className="btn small" href="#companions">
          Find companions
        </a>
      </header>
      <main className="shell studio market">
        <p className="alert info small">{MARKET_RULES}</p>
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
        {state && !state.profile && <CompanionForm me={me} profile={null} reload={reload} />}
        {state?.profile && (
          <>
            <nav className="segmented scroll" role="tablist" aria-label="Companion dashboard">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? "active" : ""}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === "requests" && open > 0 ? ` (${open})` : ""}
                </button>
              ))}
            </nav>
            {tab === "overview" && <Overview state={state} reload={reload} />}
            {tab === "requests" && (
              <BookingsList
                bookings={state.bookings}
                me={me}
                names={state.names}
                reviews={state.reviews}
                reload={reload}
                empty="No booking requests yet. Members find you once you're approved and have activities and availability."
              />
            )}
            {tab === "services" && <Services me={me} state={state} reload={reload} />}
            {tab === "availability" && (
              <AvailabilityEditor me={me} rows={state.availability} reload={reload} />
            )}
            {tab === "messages" && <MarketChat me={me} />}
            {tab === "profile" && <CompanionForm me={me} profile={state.profile} reload={reload} />}
          </>
        )}
      </main>
    </div>
  );
}

function Overview({ state, reload }: { state: State; reload: () => Promise<void> }) {
  const p = state.profile!;
  const { busy, run, messages } = useAction(reload);
  const visibleReviews = state.reviews.filter((r) => r.companion_id === p.user_id && r.status === "visible");
  const avg = visibleReviews.length
    ? Math.round((visibleReviews.reduce((s, r) => s + r.rating, 0) / visibleReviews.length) * 10) / 10
    : null;
  const steps = [
    { done: true, label: "Profile created" },
    { done: p.status === "approved" || p.status === "paused", label: "Approved by RentMate moderators" },
    { done: p.verified, label: "Identity and age verified" },
    { done: state.services.some((s) => s.active), label: "At least one active activity" },
    { done: state.availability.length > 0, label: "Weekly availability set" },
  ];
  return (
    <section className="studio-section">
      <div className="panel">
        <h2 className="display-sm">Status: {COMPANION_STATUS[p.status] ?? p.status}</h2>
        {p.status_reason && <p className="muted">Moderator note: {p.status_reason}</p>}
        <ul className="checklist">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? "check-row done" : "check-row"}>
              <span aria-hidden="true">{s.done ? "✓" : "•"}</span> {s.label}
            </li>
          ))}
        </ul>
        {!p.verified && (
          <p className="alert info small">
            Verification is done by RentMate with a verification partner. We store only the result, never
            photos of your documents.
          </p>
        )}
        {messages}
        {(p.status === "approved" || p.status === "paused") && (
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(
                () => marketApi.setPaused(p.status === "approved"),
                p.status === "approved" ? "You're hidden from search." : "You're visible again.",
              )
            }
          >
            {p.status === "approved" ? "Pause my listing" : "Resume my listing"}
          </button>
        )}
      </div>
      <div className="panel">
        <h3>Earnings (estimate)</h3>
        <p>
          {state.earnings.completed_bookings} completed bookings · booked value{" "}
          {formatINR(state.earnings.booked_value_inr)}
        </p>
        <p>
          Platform commission {formatINR(state.earnings.commission_inr)} · your share{" "}
          <strong>{formatINR(state.earnings.estimated_earnings_inr)}</strong>
        </p>
        <p className="muted small">
          Payments and payouts are not active in RentMate yet. These figures are estimates from completed
          bookings, not money received.
        </p>
        <p className="small">
          Rating:{" "}
          {avg !== null
            ? `★ ${avg} from ${visibleReviews.length} review${visibleReviews.length === 1 ? "" : "s"}`
            : "no reviews yet"}
        </p>
      </div>
    </section>
  );
}

function CompanionForm({
  me,
  profile,
  reload,
}: {
  me: string;
  profile: CompanionProfile | null;
  reload: () => Promise<void>;
}) {
  const [d, setD] = useState<CompanionDraft>({
    headline: profile?.headline ?? "",
    about: profile?.about ?? "",
    city: profile?.city ?? "",
    area: profile?.area ?? "",
    languages: profile?.languages.join(", ") ?? "",
    interests: profile?.interests.join(", ") ?? "",
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateCompanion>>({});
  const [agree, setAgree] = useState(!!profile);
  const { busy, run, messages } = useAction(reload);
  const set = (k: keyof CompanionDraft) => (v: string) => setD((x) => ({ ...x, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateCompanion(d);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const row = {
      headline: d.headline.trim(),
      about: d.about.trim(),
      city: d.city.trim(),
      area: d.area.trim(),
      languages: splitList(d.languages, 8),
      interests: splitList(d.interests, 12),
    };
    void run(
      () => (profile ? marketApi.updateCompanion(me, row) : marketApi.applyCompanion(me, row)),
      profile ? "Profile saved." : "Application sent. A moderator will review it.",
    );
  }

  return (
    <form className="panel form" onSubmit={submit} noValidate>
      <h2 className="display-sm">{profile ? "Your companion profile" : "Become a RentMate companion"}</h2>
      {!profile && (
        <p className="muted">
          Offer friendly company for public activities: coffee, meals, events, city walks and more. You must
          be 18 or older and pass identity and age verification.
        </p>
      )}
      <label className="field">
        <span>Headline</span>
        <input value={d.headline} maxLength={80} onChange={(e) => set("headline")(e.target.value)} />
        {errors.headline && <small className="err">{errors.headline}</small>}
      </label>
      <label className="field">
        <span>About you</span>
        <textarea rows={4} maxLength={1500} value={d.about} onChange={(e) => set("about")(e.target.value)} />
        {errors.about && <small className="err">{errors.about}</small>}
      </label>
      <label className="field">
        <span>City</span>
        <input value={d.city} maxLength={60} onChange={(e) => set("city")(e.target.value)} />
        {errors.city && <small className="err">{errors.city}</small>}
      </label>
      <label className="field">
        <span>Neighbourhood (optional)</span>
        <input
          value={d.area}
          maxLength={80}
          placeholder="e.g. Baner"
          onChange={(e) => set("area")(e.target.value)}
        />
        <small className="muted">Never your home address or PIN code.</small>
        {errors.area && <small className="err">{errors.area}</small>}
      </label>
      <label className="field">
        <span>Languages (comma separated)</span>
        <input value={d.languages} onChange={(e) => set("languages")(e.target.value)} />
        {errors.languages && <small className="err">{errors.languages}</small>}
      </label>
      <label className="field">
        <span>Interests (comma separated)</span>
        <input value={d.interests} onChange={(e) => set("interests")(e.target.value)} />
        {errors.interests && <small className="err">{errors.interests}</small>}
      </label>
      {!profile && (
        <label className="check-row">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I'm 18 or older. I'll offer only non-sexual companionship in public places and follow the Terms
            and Safety guidelines.
          </span>
        </label>
      )}
      {messages}
      <button className="btn dark" disabled={busy || !agree}>
        {profile ? "Save profile" : "Send application"}
      </button>
    </form>
  );
}

const EMPTY_SERVICE: ServiceDraft = {
  category: "",
  title: "",
  description: "",
  pricing: "hourly",
  price: "",
  minMinutes: "60",
  maxMinutes: "180",
};

function Services({ me, state, reload }: { me: string; state: State; reload: () => Promise<void> }) {
  const [d, setD] = useState<ServiceDraft>(EMPTY_SERVICE);
  const [errors, setErrors] = useState<ReturnType<typeof validateService>>({});
  const { busy, run, messages } = useAction(reload);
  const labels = Object.fromEntries(state.categories.map((c) => [c.key, c.label]));
  const set = (k: keyof ServiceDraft) => (v: string) => setD((x) => ({ ...x, [k]: v }));

  return (
    <section className="studio-section">
      <div className="panel">
        <h3>Your activities</h3>
        {state.services.length === 0 ? (
          <p className="muted">No activities yet. Add one below.</p>
        ) : (
          <ul className="plain-list">
            {state.services.map((s) => (
              <li key={s.id} className="service-row">
                <div>
                  <strong>{s.title}</strong>{" "}
                  <span className="muted small">· {labels[s.category] ?? s.category}</span>
                  <div className="small">
                    {formatINR(s.price_inr)} {s.pricing === "hourly" ? "per hour" : "per session"} ·{" "}
                    {minutesLabel(s.min_minutes)}–{minutesLabel(s.max_minutes)}
                    {!s.active && " · hidden"}
                  </div>
                </div>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => marketApi.setServiceActive(s.id, !s.active),
                      s.active ? "Hidden." : "Shown again.",
                    )
                  }
                >
                  {s.active ? "Hide" : "Show"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="panel form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const errs = validateService(d);
          setErrors(errs);
          if (Object.keys(errs).length) return;
          void run(
            () =>
              marketApi.addService(me, {
                category: d.category,
                title: d.title.trim(),
                description: d.description.trim(),
                pricing: d.pricing,
                price_inr: Number(d.price),
                min_minutes: Number(d.minMinutes),
                max_minutes: Number(d.maxMinutes),
                active: true,
              }),
            "Activity added.",
          ).then((ok) => ok && setD(EMPTY_SERVICE));
        }}
      >
        <h3>Add an activity</h3>
        <label className="field">
          <span>Activity</span>
          <select value={d.category} onChange={(e) => set("category")(e.target.value)}>
            <option value="">Choose…</option>
            {state.categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          {errors.category && <small className="err">{errors.category}</small>}
        </label>
        <label className="field">
          <span>Title</span>
          <input value={d.title} maxLength={80} onChange={(e) => set("title")(e.target.value)} />
          {errors.title && <small className="err">{errors.title}</small>}
        </label>
        <label className="field">
          <span>Description (optional)</span>
          <textarea
            rows={3}
            maxLength={800}
            value={d.description}
            onChange={(e) => set("description")(e.target.value)}
          />
          {errors.description && <small className="err">{errors.description}</small>}
        </label>
        <label className="field">
          <span>Pricing</span>
          <select value={d.pricing} onChange={(e) => set("pricing")(e.target.value)}>
            <option value="hourly">Per hour</option>
            <option value="session">Per session (fixed)</option>
          </select>
        </label>
        <label className="field">
          <span>Price (₹)</span>
          <input
            type="number"
            min={100}
            max={100000}
            inputMode="numeric"
            value={d.price}
            onChange={(e) => set("price")(e.target.value)}
          />
          {errors.price && <small className="err">{errors.price}</small>}
        </label>
        <div className="row-wrap">
          <label className="field">
            <span>Shortest (minutes)</span>
            <input
              type="number"
              min={30}
              max={480}
              value={d.minMinutes}
              onChange={(e) => set("minMinutes")(e.target.value)}
            />
            {errors.minMinutes && <small className="err">{errors.minMinutes}</small>}
          </label>
          <label className="field">
            <span>Longest (minutes)</span>
            <input
              type="number"
              min={30}
              max={720}
              value={d.maxMinutes}
              onChange={(e) => set("maxMinutes")(e.target.value)}
            />
            {errors.maxMinutes && <small className="err">{errors.maxMinutes}</small>}
          </label>
        </div>
        <p className="muted small">
          RentMate keeps a {state.settings?.commission_pct ?? 15}% platform commission on completed bookings
          (once payments are switched on).
        </p>
        {messages}
        <button className="btn dark" disabled={busy}>
          Add activity
        </button>
      </form>
    </section>
  );
}

function AvailabilityEditor({
  me,
  rows,
  reload,
}: {
  me: string;
  rows: Availability[];
  reload: () => Promise<void>;
}) {
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("21:00");
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, run, messages } = useAction(reload);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  return (
    <section className="studio-section">
      <div className="panel">
        <h3>Weekly availability</h3>
        {rows.length === 0 ? (
          <p className="muted">Members can only request times inside these windows.</p>
        ) : (
          <ul className="plain-list">
            {rows.map((a) => (
              <li key={a.id} className="row between">
                <span>
                  {WEEKDAYS[a.weekday]} {fromMinutes(a.start_minute)}–{fromMinutes(a.end_minute)}{" "}
                  <span className="muted small">({a.timezone})</span>
                </span>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => void run(() => marketApi.removeAvailability(a.id), "Removed.")}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          const s = toMinutes(start);
          const en = toMinutes(end);
          if (s === null || en === null || en <= s) {
            setProblem("Choose a start and an end time later the same day.");
            return;
          }
          setProblem(null);
          void run(() => marketApi.addAvailability(me, weekday, s, en, tz), "Availability added.");
        }}
      >
        <h3>Add a window</h3>
        <label className="field">
          <span>Day</span>
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <div className="row-wrap">
          <label className="field">
            <span>From</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <p className="muted small">Time zone: {tz}</p>
        {problem && <p className="alert error">{problem}</p>}
        {messages}
        <button className="btn dark" disabled={busy}>
          Add window
        </button>
      </form>
    </section>
  );
}
