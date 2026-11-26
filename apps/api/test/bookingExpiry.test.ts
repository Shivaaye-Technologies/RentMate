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
});
