import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, readTheme, THEME_KEY } from "./theme";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

/** Stand-in for <html>: only the attribute methods applyTheme uses. */
function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    el: {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    } as unknown as HTMLElement,
  };
}

describe("theme choice", () => {
  beforeEach(() => store.clear());

  it("defaults to following the device", () => {
    expect(readTheme()).toBe("system");
  });

  it("applies and remembers light or dark", () => {
    const r = fakeRoot();
    applyTheme("dark", r.el);
    expect(r.attrs.get("data-theme")).toBe("dark");
    expect(store.get(THEME_KEY)).toBe("dark");
    expect(readTheme()).toBe("dark");
    applyTheme("light", r.el);
    expect(r.attrs.get("data-theme")).toBe("light");
  });

  it("system clears the override", () => {
    const r = fakeRoot();
    applyTheme("dark", r.el);
    applyTheme("system", r.el);
    expect(r.attrs.has("data-theme")).toBe(false);
    expect(store.has(THEME_KEY)).toBe(false);
  });

  it("ignores junk in storage", () => {
    store.set(THEME_KEY, "neon");
    expect(readTheme()).toBe("system");
  });

  it("still works when storage is blocked", () => {
    const saved = globalThis.localStorage;
    Object.assign(globalThis, {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    const r = fakeRoot();
    expect(readTheme()).toBe("system");
    applyTheme("dark", r.el);
    expect(r.attrs.get("data-theme")).toBe("dark");
    Object.assign(globalThis, { localStorage: saved });
  });
});
