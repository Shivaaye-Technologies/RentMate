import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";

/**
 * Ids of fictional demo profiles. The database returns them only to tester
 * accounts (everyone else never sees demo profiles at all), so the app can
 * label them "Demo".
 */
let ids: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function setDemoIds(list: readonly string[]) {
  ids = new Set(list);
  listeners.forEach((l) => l());
}

export function isDemoId(id: string): boolean {
  return ids.has(id);
}

/** Loads the ids for the signed-in user. Missing function or errors mean "no demo profiles". */
export async function loadDemoIds(): Promise<void> {
  try {
    const { data, error } = await supabase.rpc("demo_profile_ids");
    setDemoIds(!error && Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : []);
  } catch {
    setDemoIds([]);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIsDemo(id: string): boolean {
  return useSyncExternalStore(subscribe, () => ids.has(id));
}
