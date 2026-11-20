/**
 * Account deletion (P2-05). Only the RentMate API deletes an account: it removes the member's photos and then the
 * account, with the member's own session. The browser never removes photos or calls delete_my_account itself, so a
 * failure leaves the account (and its photos) untouched and the member simply tries again.
 */

/** Shown whenever the server could not be reached or did not confirm the deletion. */
export const DELETION_RETRY_MESSAGE =
  "We couldn't reach RentMate to delete your account, so nothing was deleted. Please check your connection and try again in a few minutes.";

/** How long to wait for the server before giving up (deleting many photos can take a while). */
export const DELETION_TIMEOUT_MS = 60_000;

export class AccountDeletionError extends Error {}

/**
 * Asks the RentMate API to delete the signed-in account. Resolves only when the server confirms the deletion.
 * Every other outcome (network failure, timeout, 404, 503, any error status) throws AccountDeletionError with a
 * message for the member; the server's own message is used when it gives one.
 */
export async function deleteAccountViaServer(
  token: string,
  base: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = DELETION_TIMEOUT_MS,
): Promise<"deleted"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(`${base}/api/v1/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirm: "DELETE" }),
      signal: controller.signal,
    });
  } catch {
    throw new AccountDeletionError(DELETION_RETRY_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) {
    const json = (await res.json().catch(() => null)) as { deleted?: boolean } | null;
    if (json?.deleted === true) return "deleted";
    throw new AccountDeletionError(DELETION_RETRY_MESSAGE);
  }
  if (res.status === 404 || res.status === 503) throw new AccountDeletionError(DELETION_RETRY_MESSAGE);
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new AccountDeletionError(
    json?.error ?? `Couldn't delete your account (${res.status}), so nothing was deleted. Please try again.`,
  );
}
