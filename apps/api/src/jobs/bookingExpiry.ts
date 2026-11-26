import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SettleResult {
  completed: number;
  heldForReview: number;
}

/**
 * System-wide booking jobs, each a single guarded database function:
 * - expire: unanswered requests whose start time has passed expire; the database refunds their token holds.
 * - settle: accepted token bookings past the dispute window complete (checked in or member-confirmed) or are
 *   frozen for a moderator. Tokens never move without that evidence.
 */
export interface BookingJobs {
  expire(limit: number): Promise<number>;
  settle(limit: number): Promise<SettleResult>;
}

export class SupabaseBookingJobs implements BookingJobs {
  private db: SupabaseClient;

  constructor(
    url: string,
    publishableKey: string,
    private readonly secret: string,
  ) {
    this.db = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async expire(limit: number) {
    const { data, error } = await this.db.rpc("booking_jobs_expire", {
      p_secret: this.secret,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }

  async settle(limit: number): Promise<SettleResult> {
    const { data, error } = await this.db.rpc("booking_jobs_settle", {
      p_secret: this.secret,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      { completed?: number; held_for_review?: number } | null | undefined;
    return { completed: Number(row?.completed ?? 0), heldForReview: Number(row?.held_for_review ?? 0) };
  }
}

/**
 * Runs the booking jobs on a timer. Never overlaps itself. Each job's errors are logged (without the secret) and do
 * not stop the other job; both are retried next tick.
 * Safe to run in several server processes: the database skips rows another run has locked.
 */
export function startBookingExpiry(
  jobs: BookingJobs,
  everyMs = 60_000,
  log: (msg: string) => void = (m) => console.log(m),
) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      try {
        const n = await jobs.expire(500);
        if (n > 0) log(`[api] expired ${n} unanswered booking request(s)`);
      } catch (err) {
        log(`[api] booking expiry failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        const s = await jobs.settle(200);
        if (s.completed > 0)
          log(`[api] completed ${s.completed} finished booking(s) after the dispute window`);
        if (s.heldForReview > 0) log(`[api] held ${s.heldForReview} booking(s) for moderator review`);
      } catch (err) {
        log(`[api] booking settlement failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
