/** Server-side account deletion (P2-05): the API removes the photos and then the account. */

export type ServerDeletion = "deleted" | "unreachable";

/**
 * Asks the RentMate API to delete the signed-in account. Returns "unreachable" only when no API with this endpoint
 * answers (network failure, 404 from an older API, 503 when not configured), so the caller may fall back to removing
 * photos from the browser; the database still refuses to delete an account that has photos left. Any other failure
 * is thrown with the server's message, and nothing more is tried.
 */
export async function deleteAccountViaServer(
  token: string,
  base: string,
  fetchFn: typeof fetch = fetch,
): Promise<ServerDeletion> {
  let res: Response;
  try {
    res = await fetchFn(`${base}/api/v1/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
  } catch {
    return "unreachable";
  }
  if (res.ok) return "deleted";
  if (res.status === 404 || res.status === 503) return "unreachable";
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(json?.error ?? `Couldn't delete your account (${res.status}). Please try again.`);
}
