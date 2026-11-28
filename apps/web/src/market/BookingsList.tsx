import { useState } from "react";
import { useAction } from "../live/useAction";
import { marketApi, type Booking, type Review } from "./marketData";
import {
  BOOKING_STATUS,
  bookingActions,
  checkInStep,
  formatINR,
  minutesLabel,
  normaliseCheckInCode,
} from "./marketText";

const when = (iso: string, tz: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

/** Meetup check-in: the member shows a one-time code, the companion enters it (the server checks everything). */
export function CheckInPanel({ b, me, reload }: { b: Booking; me: string; reload: () => Promise<void> }) {
  const { busy, run, messages } = useAction(reload);
  const [code, setCode] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const step = checkInStep(b, me);
  if (!step) return null;
  return (
    <div className="checkin">
      <strong className="small">Meetup check-in</strong>
      {step === "not_yet" && (
        <p className="muted small">Check-in opens 30 minutes before the start, at the meeting place.</p>
      )}
      {step === "checked_in" && <p className="muted small">Checked in at the meetup.</p>}
      {step === "show_code" && (
        <>
          <p className="muted small">
            When you meet, show this code to your companion. Never share it before you are together.
          </p>
          {code && (
            <p className="checkin-code" aria-label={`Check-in code ${code.split("").join(" ")}`}>
              {code.slice(0, 3)} {code.slice(3)}
            </p>
          )}
          <button
            className={code ? "btn small" : "btn dark small"}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setCode(await marketApi.checkInCode(b.id));
              })
            }
          >
            {code ? "Get a new code" : "Show my check-in code"}
          </button>
        </>
      )}
      {step === "enter_code" && (
        <form
          className="row-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            const digits = normaliseCheckInCode(input);
            void run(async () => {
              if (!digits) throw new Error("Enter the 6-digit code shown in the member's app.");
              await marketApi.checkIn(b.id, digits);
              setInput("");
            }, "Checked in. Enjoy the meetup.");
          }}
        >
          <label className="small">
            Check-in code{" "}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          <button className="btn dark small" disabled={busy} type="submit">
            Check in
          </button>
        </form>
      )}
      {messages}
    </div>
  );
}

/** One booking with the actions this person may take now (the server enforces the same rules). */
export function BookingCard({
  b,
  me,
  names,
  reviewed,
  reload,
}: {
  b: Booking;
  me: string;
  names: Record<string, string>;
  reviewed: boolean;
  reload: () => Promise<void>;
}) {
  const { busy, run, messages } = useAction(reload);
  const [mode, setMode] = useState<null | "cancel" | "dispute" | "review" | "reject">(null);
  const [text, setText] = useState("");
  const [rating, setRating] = useState(5);
  const can = bookingActions(b, me);
  const isCompanion = b.companion_id === me;
  const other = isCompanion ? b.member_id : b.companion_id;
  const canReview = !isCompanion && b.status === "completed" && !reviewed;

  return (
    <li className="booking-card">
      <div className="row between">
        <strong>{b.service_title}</strong>
        <span className={`pill status-${b.status}`}>{BOOKING_STATUS[b.status] ?? b.status}</span>
      </div>
      <p className="muted small">
        {b.reference} · {isCompanion ? "Member" : "Companion"}:{" "}
        {other ? (names[other] ?? "Member") : "Deleted account"}
      </p>
      <p>
        {when(b.starts_at, b.timezone)} · {minutesLabel(b.duration_minutes)} · {b.meeting_point}
      </p>
      <p>
        <strong>{formatINR(b.price_inr)}</strong>{" "}
        <span className="muted small">
          {b.pricing === "session" ? "fixed price" : "hourly rate × duration"} · payment not collected in the
          app
        </span>
      </p>
      {b.note && <p className="muted small">Note: {b.note}</p>}
      {b.late_cancellation && <p className="muted small">Cancelled inside the free-cancellation window.</p>}
      <details>
        <summary className="small">Cancellation policy</summary>
        <p className="small muted">{b.cancellation_policy}</p>
      </details>

      <CheckInPanel b={b} me={me} reload={reload} />

      {messages}

      {mode === null && (
        <div className="row-wrap">
          {can.respond && b.status === "requested" && (
            <button
              className="btn small"
              disabled={busy}
              onClick={() =>
                void run(() => marketApi.respond(b.id, "pending"), "Marked as being considered.")
              }
            >
              Considering
            </button>
          )}
          {can.respond && (
            <button
              className="btn dark small"
              disabled={busy}
              onClick={() => void run(() => marketApi.respond(b.id, "accept"), "Booking accepted.")}
            >
              Accept
            </button>
          )}
          {can.respond && (
            <button className="btn small" disabled={busy} onClick={() => setMode("reject")}>
              Decline
            </button>
          )}
          {can.cancel && (
            <button className="btn small danger" disabled={busy} onClick={() => setMode("cancel")}>
              Cancel booking
            </button>
          )}
          {can.complete && (
            <button
              className="btn dark small"
              disabled={busy}
              onClick={() => void run(() => marketApi.complete(b.id), "Marked as completed.")}
            >
              Mark completed
            </button>
          )}
          {can.dispute && (
            <button className="btn small" disabled={busy} onClick={() => setMode("dispute")}>
              Report a problem
            </button>
          )}
          {canReview && (
            <button className="btn dark small" disabled={busy} onClick={() => setMode("review")}>
              Write a review
            </button>
          )}
        </div>
      )}

      {(mode === "cancel" || mode === "reject" || mode === "dispute") && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const fn =
              mode === "cancel"
                ? () => marketApi.cancel(b.id, text)
                : mode === "reject"
                  ? () => marketApi.respond(b.id, "reject", text)
                  : () => marketApi.dispute(b.id, text);
            void run(fn, mode === "dispute" ? "Sent to RentMate moderators." : "Done.").then(
              (ok) => ok && setMode(null),
            );
          }}
        >
          <label className="field">
            <span>
              {mode === "cancel"
                ? "Reason for cancelling (optional)"
                : mode === "reject"
                  ? "Message to the member (optional)"
                  : "What happened? Moderators will review it."}
            </span>
            <textarea
              rows={3}
              maxLength={mode === "dispute" ? 1000 : 500}
              value={text}
              required={mode === "dispute"}
              minLength={mode === "dispute" ? 10 : undefined}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="row-wrap">
            <button className={mode === "dispute" ? "btn dark small" : "btn small danger"} disabled={busy}>
              {mode === "cancel"
                ? "Yes, cancel booking"
                : mode === "reject"
                  ? "Decline booking"
                  : "Send to moderators"}
            </button>
            <button type="button" className="btn small" onClick={() => setMode(null)}>
              Keep it
            </button>
          </div>
        </form>
      )}

      {mode === "review" && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => marketApi.review(b.id, rating, text), "Thanks for your review.").then(
              (ok) => ok && setMode(null),
            );
          }}
        >
          <fieldset className="field">
            <span>Rating</span>
            <div className="chips pick" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  className={rating === n ? "chip toggle on" : "chip toggle"}
                  onClick={() => setRating(n)}
                >
                  {"★".repeat(n)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span>Your review (optional)</span>
            <textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="row-wrap">
            <button className="btn dark small" disabled={busy}>
              Post review
            </button>
            <button type="button" className="btn small" onClick={() => setMode(null)}>
              Not now
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function BookingsList({
  bookings,
  me,
  names,
  reviews,
  reload,
  empty,
}: {
  bookings: Booking[];
  me: string;
  names: Record<string, string>;
  reviews: Review[];
  reload: () => Promise<void>;
  empty: string;
}) {
  const now = Date.now();
  const upcoming = bookings
    .filter((b) => Date.parse(b.ends_at) > now && ["requested", "pending", "accepted"].includes(b.status))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const past = bookings.filter((b) => !upcoming.includes(b));
  const reviewed = new Set(reviews.map((r) => r.booking_id));
  if (bookings.length === 0) return <p className="muted">{empty}</p>;
  return (
    <>
      <h3>Upcoming and open</h3>
      {upcoming.length === 0 ? (
        <p className="muted small">Nothing upcoming.</p>
      ) : (
        <ul className="plain-list booking-list">
          {upcoming.map((b) => (
            <BookingCard
              key={b.id}
              b={b}
              me={me}
              names={names}
              reviewed={reviewed.has(b.id)}
              reload={reload}
            />
          ))}
        </ul>
      )}
      <h3>History</h3>
      {past.length === 0 ? (
        <p className="muted small">No past bookings yet.</p>
      ) : (
        <ul className="plain-list booking-list">
          {past.map((b) => (
            <BookingCard
              key={b.id}
              b={b}
              me={me}
              names={names}
              reviewed={reviewed.has(b.id)}
              reload={reload}
            />
          ))}
        </ul>
      )}
    </>
  );
}
