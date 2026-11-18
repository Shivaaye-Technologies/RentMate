// Browser notifications. These only appear while SOULMATE.AI is open in a tab
// (for example in the background). There is no push service yet, so nothing
// arrives when the site is closed, and the app says so.

export type Permission = "unsupported" | "default" | "granted" | "denied";

export function notificationPermission(): Permission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as Permission;
}

/** Asks the browser for permission. Only call this from a button the person pressed. */
export async function requestNotificationPermission(): Promise<Permission> {
  if (notificationPermission() === "unsupported") return "unsupported";
  try {
    return (await Notification.requestPermission()) as Permission;
  } catch {
    return notificationPermission();
  }
}

/** Shows a system notification when allowed and the tab isn't in front. */
export function showAlert(text: string): boolean {
  if (notificationPermission() !== "granted" || typeof document === "undefined" || !document.hidden)
    return false;
  try {
    new Notification("SOULMATE.AI", { body: text, tag: text, icon: "/favicon.svg" });
    return true;
  } catch {
    // Some Android browsers only allow notifications from a service worker.
    return false;
  }
}
