import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAction } from "../live/useAction";
import { Photo } from "../components/Photo";
import { BookingsList } from "./BookingsList";
import { MarketChat } from "./MarketChat";
import {
  EMPTY_FILTERS,
  marketApi,
  namesFor,
  newIdempotencyKey,
  type Availability,
  type Booking,
  type Category,
  type CompanionCard,
  type CompanionProfile,
  type Review,
  type SearchFilters,
  type Service,
  type Settings,
} from "./marketData";
import {
  bookingProblem,
  formatINR,
  fromMinutes,
  MARKET_RULES,
  minutesLabel,
  priceEstimate,
  WEEKDAYS,
} from "./marketText";

type Tab = "find" | "shortlist" | "bookings" | "messages" | "alerts";
const TABS: { key: Tab; label: string }[] = [
  { key: "find", label: "Find companions" },
  { key: "shortlist", label: "Shortlist" },
  { key: "bookings", label: "Bookings" },
  { key: "messages", label: "Messages" },
  { key: "alerts", label: "Notifications" },
];

/** Member side of the RentMate companionship marketplace. */
export function Marketplace({ me, onExit }: { me: string; onExit: () => void }) {
  const [tab, setTab] = useState<Tab>("find");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [suspension, setSuspension] = useState<{ id: string; reason: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [chatWith, setChatWith] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [s, c, sl, sus] = await Promise.all([
        marketApi.settings(),
        marketApi.categories(),
        marketApi.shortlist(me),
        marketApi.suspension(me),
      ]);
      setSettings(s);
      setCategories(c);
      setShortlist(sl);
      setSuspension(sus);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the marketplace.");
    }
  }, [me]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const labels = useMemo(() => Object.fromEntries(categories.map((c) => [c.key, c.label])), [categories]);

  return (
    <div className="app">
      <header className="topbar market-top">
        <button className="btn small" onClick={onExit}>
          ← Back
        </button>
        <span className="brand">RentMate · Companions</span>
        <a className="btn small" href="#companion">
          Companion dashboard
        </a>
      </header>
      <main className="shell studio market">
        <p className="alert info small">{MARKET_RULES}</p>
        {suspension && <SuspendedBanner reason={suspension.reason} reload={reload} />}
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
        {!error && !settings && (
          <div className="empty">
            <div className="spinner" aria-hidden="true" />
          </div>
        )}
        {settings && viewing && (
          <CompanionView
            me={me}
            id={viewing}
            settings={settings}
            labels={labels}
            shortlisted={shortlist.includes(viewing)}
            onBack={() => setViewing(null)}
            onChanged={reload}
            onMessage={(conv) => {
              setChatWith(conv);
              setViewing(null);
              setTab("messages");
            }}
            onBooked={() => {
              setViewing(null);
              setTab("bookings");
            }}
          />
        )}
        {settings && !viewing && (
          <>
            <nav className="segmented scroll" role="tablist" aria-label="Marketplace">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? "active" : ""}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            {tab === "find" && <FindCompanions categories={categories} labels={labels} onOpen={setViewing} />}
            {tab === "shortlist" && <ShortlistView ids={shortlist} onOpen={setViewing} />}
            {tab === "bookings" && <MyBookings me={me} />}
            {tab === "messages" && <MarketChat me={me} initial={chatWith} />}
            {tab === "alerts" && <Alerts me={me} />}
          </>
        )}
      </main>
    </div>
  );
}

function SuspendedBanner({ reason, reload }: { reason: string; reload: () => Promise<void> }) {
  const { busy, run, messages } = useAction(reload);
  const [text, setText] = useState("");
  return (
    <section className="panel">
      <h2 className="display-sm">Your account is suspended</h2>
      <p className="muted">Reason: {reason}</p>
      <p className="small muted">While suspended you can't book, list services or message companions.</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => marketApi.appeal(text), "Appeal sent. A moderator will review it.");
        }}
      >
        <label className="field">
          <span>Appeal (at least 10 characters)</span>
          <textarea
            rows={3}
            minLength={10}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {messages}
        <button className="btn dark" disabled={busy || text.trim().length < 10}>
          Send appeal
        </button>
      </form>
    </section>
  );
}

export function CompanionCards({
  list,
  labels,
  onOpen,
}: {
  list: CompanionCard[];
  labels: Record<string, string>;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="companion-grid">
      {list.map((c) => (
        <li key={c.user_id}>
          <button className="companion-card" onClick={() => onOpen(c.user_id)}>
            <Photo
              id={c.user_id}
              path={c.photo_path}
              name={c.display_name}
              className="companion-photo"
              textSize={28}
            />
            <span className="companion-body">
              <strong>
                {c.display_name}
                {c.verified && <span className="pill status-accepted"> Verified</span>}
              </strong>
              <span>{c.headline}</span>
              <span className="muted small">
                {c.city}
                {c.area ? ` · ${c.area}` : ""}
              </span>
              <span className="small">
                From {formatINR(c.min_price_inr)} ·{" "}
                {c.review_count > 0 ? `★ ${c.rating} (${c.review_count})` : "No reviews yet"}
              </span>
              <span className="muted small">{c.categories.map((k) => labels[k] ?? k).join(" · ")}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FindCompanions({
  categories,
  labels,
  onOpen,
}: {
  categories: Category[];
  labels: Record<string, string>;
  onOpen: (id: string) => void;
}) {
  const [f, setF] = useState<SearchFilters>(EMPTY_FILTERS);
  const [results, setResults] = useState<CompanionCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (filters: SearchFilters) => {
    setBusy(true);
    try {
      setResults(await marketApi.search(filters));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void search(EMPTY_FILTERS);
  }, [search]);

  const set = (k: keyof SearchFilters) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  return (
    <section>
      <form
        className="panel filters"
        onSubmit={(e) => {
          e.preventDefault();
          void search(f);
        }}
      >
        <div className="filter-grid">
          <label className="field">
            <span>City</span>
            <input
              value={f.city}
              maxLength={60}
              placeholder="e.g. Pune"
              onChange={(e) => set("city")(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Activity</span>
            <select value={f.category} onChange={(e) => set("category")(e.target.value)}>
              <option value="">Any activity</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Max price (₹)</span>
            <input
              type="number"
              min={100}
              step={100}
              inputMode="numeric"
              value={f.maxPrice}
              onChange={(e) => set("maxPrice")(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Available on</span>
            <input type="date" value={f.onDate} onChange={(e) => set("onDate")(e.target.value)} />
          </label>
          <label className="field">
            <span>Language</span>
            <input
              value={f.language}
              maxLength={30}
              placeholder="e.g. Hindi"
              onChange={(e) => set("language")(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Interest</span>
            <input
              value={f.interest}
              maxLength={30}
              placeholder="e.g. Museums"
              onChange={(e) => set("interest")(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Minimum rating</span>
            <select value={f.minRating} onChange={(e) => set("minRating")(e.target.value)}>
              <option value="">Any</option>
              <option value="3">3★ and up</option>
              <option value="4">4★ and up</option>
              <option value="4.5">4.5★ and up</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={f.verifiedOnly}
              onChange={(e) => set("verifiedOnly")(e.target.checked)}
            />
            <span>Verified profiles only</span>
          </label>
        </div>
        <div className="row-wrap">
          <button className="btn dark" disabled={busy}>
            {busy ? "Searching…" : "Search"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setF(EMPTY_FILTERS);
              void search(EMPTY_FILTERS);
            }}
          >
            Clear filters
          </button>
        </div>
      </form>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {results && results.length === 0 && (
        <p className="muted">No companions match these filters yet. Try another city or fewer filters.</p>
      )}
      {results && results.length > 0 && <CompanionCards list={results} labels={labels} onOpen={onOpen} />}
    </section>
  );
}

function ShortlistView({ ids, onOpen }: { ids: string[]; onOpen: (id: string) => void }) {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void namesFor(ids)
      .then(setNames)
      .catch(() => setNames({}));
  }, [ids]);
  if (ids.length === 0)
    return <p className="muted">Your shortlist is empty. Tap “Shortlist” on a companion's profile.</p>;
  return (
    <ul className="plain-list">
      {ids.map((id) => (
        <li key={id}>
          <button className="menu-row" onClick={() => onOpen(id)}>
            <strong>{names[id] ?? "Companion"}</strong>
            <span className="muted small">Open profile</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MyBookings({ me }: { me: string }) {
  const [state, setState] = useState<{
    bookings: Booking[];
    names: Record<string, string>;
    reviews: Review[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const bookings = (await marketApi.myBookings()).filter((b) => b.member_id === me);
      const [names, reviews] = await Promise.all([
        namesFor(bookings.map((b) => b.companion_id)),
        marketApi.myReviews(me),
      ]);
      setState({ bookings, names, reviews });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load bookings.");
    }
  }, [me]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (error) return <p className="alert error">{error}</p>;
  if (!state) return <div className="spinner" aria-hidden="true" />;
  return (
    <BookingsList
      bookings={state.bookings}
      me={me}
      names={state.names}
      reviews={state.reviews}
      reload={reload}
      empty="You haven't requested any bookings yet."
    />
  );
}

function Alerts({ me }: { me: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof marketApi.notifications>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setRows(await marketApi.notifications());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load notifications.");
    }
  }, []);
  const { busy, run } = useAction(reload);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (error) return <p className="alert error">{error}</p>;
  if (!rows) return <div className="spinner" aria-hidden="true" />;
  if (rows.length === 0) return <p className="muted">No notifications yet.</p>;
  const unread = rows.filter((r) => !r.read_at).length;
  return (
    <section>
      {unread > 0 && (
        <button
          className="btn small"
          disabled={busy}
          onClick={() => void run(() => marketApi.markNotificationsRead(me))}
        >
          Mark {unread} as read
        </button>
      )}
      <ul className="plain-list">
        {rows.map((n) => (
          <li key={n.id} className={n.read_at ? "" : "unread"}>
            <strong>{n.title}</strong>
            {n.body && <span className="muted small"> · {n.body}</span>}
            <div className="muted small">{new Date(n.created_at).toLocaleString()}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface CompanionDetail {
  profile: CompanionProfile;
  name: string;
  services: Service[];
  availability: Availability[];
  rating: { rating: number | null; review_count: number };
  reviews: Review[];
  reviewerNames: Record<string, string>;
}

function CompanionView({
  me,
  id,
  settings,
  labels,
  shortlisted,
  onBack,
  onChanged,
  onMessage,
  onBooked,
}: {
  me: string;
  id: string;
  settings: Settings;
  labels: Record<string, string>;
  shortlisted: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onMessage: (conversation: string) => void;
  onBooked: () => void;
}) {
  const [d, setD] = useState<CompanionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const profile = await marketApi.companion(id);
      if (!profile) {
        setError("This companion isn't available.");
        return;
      }
      const [names, services, availability, rating, reviews] = await Promise.all([
        namesFor([id]),
        marketApi.services(id),
        marketApi.availability(id),
        marketApi.rating(id),
        marketApi.reviewsFor(id),
      ]);
      setD({
        profile,
        name: names[id] ?? "Companion",
        services,
        availability,
        rating,
        reviews,
        reviewerNames: await namesFor(reviews.map((r) => r.reviewer_id)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this profile.");
    }
  }, [id]);
  const { busy, run, messages } = useAction(async () => {
    await onChanged();
    await load();
  });
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="companion-view">
      <button className="btn small" onClick={onBack}>
        ← All companions
      </button>
      {error && <p className="alert error">{error}</p>}
      {!d && !error && <div className="spinner" aria-hidden="true" />}
      {d && (
        <>
          <div className="panel">
            <h2 className="display-sm">
              {d.name} {d.profile.verified && <span className="pill status-accepted">Verified</span>}
            </h2>
            <p>{d.profile.headline}</p>
            <p className="muted small">
              {d.profile.city}
              {d.profile.area ? ` · ${d.profile.area}` : ""} ·{" "}
              {d.rating.review_count > 0
                ? `★ ${d.rating.rating} from ${d.rating.review_count} review${d.rating.review_count === 1 ? "" : "s"}`
                : "No reviews yet"}
            </p>
            {d.profile.about && <p>{d.profile.about}</p>}
            {d.profile.languages.length > 0 && (
              <p className="small">Languages: {d.profile.languages.join(", ")}</p>
            )}
            {d.profile.interests.length > 0 && (
              <div className="chips">
                {d.profile.interests.map((i) => (
                  <span key={i} className="chip">
                    {i}
                  </span>
                ))}
              </div>
            )}
            {messages}
            {d.profile.user_id !== me && (
              <div className="row-wrap">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      shortlisted ? marketApi.removeShortlist(me, id) : marketApi.addShortlist(me, id),
                    )
                  }
                >
                  {shortlisted ? "★ Shortlisted" : "☆ Shortlist"}
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      onMessage(await marketApi.openConversation(id));
                    })
                  }
                >
                  Message
                </button>
              </div>
            )}
          </div>

          <div className="panel">
            <h3>Activities and prices</h3>
            {d.services.length === 0 ? (
              <p className="muted">No activities listed right now.</p>
            ) : (
              <ul className="plain-list">
                {d.services.map((s) => (
                  <li key={s.id} className="service-row">
                    <div>
                      <strong>{s.title}</strong>{" "}
                      <span className="muted small">· {labels[s.category] ?? s.category}</span>
                      <div className="small">
                        {formatINR(s.price_inr)} {s.pricing === "hourly" ? "per hour" : "per session"} ·{" "}
                        {minutesLabel(s.min_minutes)}–{minutesLabel(s.max_minutes)}
                      </div>
                      {s.description && <p className="muted small">{s.description}</p>}
                    </div>
                    {d.profile.user_id !== me && (
                      <button className="btn dark small" onClick={() => setService(s.id)}>
                        Book
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {service && (
            <BookingForm
              service={d.services.find((s) => s.id === service)!}
              settings={settings}
              onCancel={() => setService(null)}
              onBooked={onBooked}
            />
          )}

          <div className="panel">
            <h3>Usual availability</h3>
            {d.availability.length === 0 ? (
              <p className="muted">No weekly availability set.</p>
            ) : (
              <ul className="plain-list small">
                {d.availability.map((a) => (
                  <li key={a.id}>
                    {WEEKDAYS[a.weekday]} {fromMinutes(a.start_minute)}–{fromMinutes(a.end_minute)}{" "}
                    <span className="muted">({a.timezone})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <h3>Reviews</h3>
            {d.reviews.length === 0 ? (
              <p className="muted">No reviews yet. Only members with a completed booking can review.</p>
            ) : (
              <ul className="plain-list">
                {d.reviews.map((r) => (
                  <li key={r.id}>
                    <strong>{"★".repeat(r.rating)}</strong>{" "}
                    <span className="muted small">
                      {r.reviewer_id ? (d.reviewerNames[r.reviewer_id] ?? "Member") : "Former member"} ·{" "}
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                    {r.comment && <p>{r.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function BookingForm({
  service,
  settings,
  onCancel,
  onBooked,
}: {
  service: Service;
  settings: Settings;
  onCancel: () => void;
  onBooked: () => void;
}) {
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState(service.min_minutes);
  const [meeting, setMeeting] = useState("");
  const [note, setNote] = useState("");
  const [agree, setAgree] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, run, messages } = useAction(async () => undefined);
  const durations: number[] = [];
  for (let m = service.min_minutes; m <= service.max_minutes; m += 30) durations.push(m);
  if (!durations.includes(service.max_minutes)) durations.push(service.max_minutes);
  const estimate = priceEstimate(service.pricing, service.price_inr, minutes);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = bookingProblem(start, minutes, meeting, {
      minMinutes: service.min_minutes,
      maxMinutes: service.max_minutes,
      minNoticeHours: settings.min_notice_hours,
    });
    setProblem(p);
    if (p) return;
    const ok = await run(
      () =>
        marketApi.requestBooking({
          service: service.id,
          startsAt: new Date(start).toISOString(),
          minutes,
          meetingPoint: meeting,
          note,
          key,
        }),
      "Request sent. The companion will accept or decline.",
    );
    if (ok) onBooked();
  }

  return (
    <form className="panel form booking-form" onSubmit={submit}>
      <h3>Request: {service.title}</h3>
      <label className="field">
        <span>Date and time (your local time)</span>
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
      </label>
      <label className="field">
        <span>Duration</span>
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {durations.map((m) => (
            <option key={m} value={m}>
              {minutesLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Public meeting place</span>
        <input
          value={meeting}
          maxLength={120}
          placeholder="e.g. Cafe Goodluck, FC Road"
          onChange={(e) => setMeeting(e.target.value)}
          required
        />
        <small className="muted">A cafe, restaurant or venue. Never a home or hotel room.</small>
      </label>
      <label className="field">
        <span>Note for the companion (optional)</span>
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="price-summary">
        <span>Estimated price</span>
        <strong>{formatINR(estimate)}</strong>
        <small className="muted">
          {service.pricing === "hourly"
            ? `${formatINR(service.price_inr)} per hour × ${minutesLabel(minutes)}`
            : "Fixed price per session"}
          . The final price is calculated by RentMate when you send the request. Payment is not taken in the
          app.
        </small>
      </div>
      <p className="small muted">
        Free cancellation until {settings.free_cancel_hours} hours before the start; later cancellations are
        recorded as late.
      </p>
      <label className="check-row">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          I understand this is non-sexual social companionship in a public place, and I agree to the Terms.
        </span>
      </label>
      {problem && (
        <p className="alert error" role="alert">
          {problem}
        </p>
      )}
      {messages}
      <div className="row-wrap">
        <button className="btn dark" disabled={busy || !agree}>
          {busy ? "Sending…" : "Send booking request"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
