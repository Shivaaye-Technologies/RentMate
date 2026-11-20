import { describe, expect, it } from "vitest";
import { clearMyPasses, loadActivity } from "./activity";

type Call = { table: string; op: string; filters: [string, unknown][]; opts?: unknown };

/** Minimal stand-in for the Supabase query builder that records each query. */
function fakeDb(
  results: Record<string, { data?: unknown; count?: number; error?: { message: string } | null }>,
) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: "", filters: [] };
      calls.push(call);
      const builder = {
        select(_cols: string, opts?: unknown) {
          call.op = "select";
          call.opts = opts;
          return builder;
        },
        delete(opts?: unknown) {
          call.op = "delete";
          call.opts = opts;
          return builder;
        },
        eq(col: string, val: unknown) {
          call.filters.push([col, val]);
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          const key = `${table}:${call.op}:${call.filters.map(([c]) => c).join(",")}`;
          resolve({ data: null, count: null, error: null, ...results[key] });
        },
      };
      return builder;
    },
  };
  return { db: db as never, calls };
}

describe("loadActivity", () => {
  it("counts likes awaiting a reply from your own rows only", async () => {
    const { db, calls } = fakeDb({
      "likes:select:liker_id": { data: [{ liked_id: "b" }, { liked_id: "c" }, { liked_id: "d" }] },
      "likes:select:liked_id": { data: [{ liker_id: "c" }, { liker_id: "z" }] },
      "passes:select:passer_id": { count: 4 },
    });
    expect(await loadActivity(db, "me")).toEqual({ awaitingReply: 2, passed: 4 });
    for (const c of calls) expect(c.filters[0][1]).toBe("me");
  });

  it("reports database errors instead of hiding them", async () => {
    const { db } = fakeDb({ "passes:select:passer_id": { error: { message: "permission denied" } } });
    await expect(loadActivity(db, "me")).rejects.toThrow(/Could not load your activity: permission denied/);
  });
});

describe("clearMyPasses", () => {
  it("deletes only passes where you are the passer", async () => {
    const { db, calls } = fakeDb({ "passes:delete:passer_id": { count: 3 } });
    expect(await clearMyPasses(db, "me")).toBe(3);
    expect(calls).toEqual([
      { table: "passes", op: "delete", filters: [["passer_id", "me"]], opts: { count: "exact" } },
    ]);
  });

  it("reports failures", async () => {
    const { db } = fakeDb({ "passes:delete:passer_id": { error: { message: "nope" } } });
    await expect(clearMyPasses(db, "me")).rejects.toThrow(/Could not bring back passed profiles: nope/);
  });
});
