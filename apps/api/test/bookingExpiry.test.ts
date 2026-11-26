import { describe, expect, it } from "vitest";
import { startBookingExpiry, type BookingJobs } from "../src/jobs/bookingExpiry.js";

describe("booking expiry job", () => {
  it("logs expired requests and never overlaps runs", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const jobs: BookingJobs = {
      expire: () =>
        new Promise((resolve) => {
          calls++;
          release = () => resolve(3);
        }),
      settle: async () => ({ completed: 0, heldForReview: 0 }),
    };
    const logs: string[] = [];
    const job = startBookingExpiry(jobs, 3_600_000, (m) => logs.push(m));
    const first = job.tick();
    await job.tick(); // still running: skipped
    release();
    await first;
    job.stop();
    expect(calls).toBe(1);
    expect(logs).toEqual(["[api] expired 3 unanswered booking request(s)"]);
  });

  it("logs failures and keeps going", async () => {
    const logs: string[] = [];
    let fail = true;
    const job = startBookingExpiry(
      {
        expire: async () => {
          if (fail) throw new Error("db down");
          return 0;
        },
        settle: async () => ({ completed: 0, heldForReview: 0 }),
      },
      3_600_000,
      (m) => logs.push(m),
    );
    await job.tick();
    fail = false;
    await job.tick();
    job.stop();
    expect(logs).toEqual(["[api] booking expiry failed: db down"]);
  });

  it("runs settlement even when expiry fails, and logs its outcome", async () => {
    const logs: string[] = [];
    const job = startBookingExpiry(
      {
        expire: async () => {
          throw new Error("db down");
        },
        settle: async () => ({ completed: 2, heldForReview: 1 }),
      },
      3_600_000,
      (m) => logs.push(m),
    );
    await job.tick();
    job.stop();
    expect(logs).toEqual([
      "[api] booking expiry failed: db down",
      "[api] completed 2 finished booking(s) after the dispute window",
      "[api] held 1 booking(s) for moderator review",
    ]);
  });

  it("logs settlement failures without stopping expiry", async () => {
    const logs: string[] = [];
    const job = startBookingExpiry(
      {
        expire: async () => 1,
        settle: async () => {
          throw new Error("timeout");
        },
      },
      3_600_000,
      (m) => logs.push(m),
    );
    await job.tick();
    job.stop();
    expect(logs).toEqual([
      "[api] expired 1 unanswered booking request(s)",
      "[api] booking settlement failed: timeout",
    ]);
  });
});
