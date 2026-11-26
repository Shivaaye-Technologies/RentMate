import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Expires unanswered booking requests whose start time has passed; the database refunds their token holds. */
export interface BookingJobs {
  expire(limit: number): Promise<number>;
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
}

/**
 * Runs the expiry job on a timer. Never overlaps itself; errors are logged without the secret and retried next tick.
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
      const n = await jobs.expire(500);
      if (n > 0) log(`[api] expired ${n} unanswered booking request(s)`);
    } catch (err) {
      log(`[api] booking expiry failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
