export type PasswordCheck =
  | { ok: true; sessionToken: string | null }
  | { ok: false; reason: "wrong" | "rate-limited" | "unavailable" };

/**
 * Whether `password` is the signed-in user's current password, asked of Neon Auth's own sign-in endpoint from
 * the server. The answer's cookies are dropped, so the browser's session is untouched; the session a correct
 * password creates is handed back for the caller to end. The auth service keeps its password hashes and its
 * rate limit to itself: the app never reads or re-implements them.
 */
export async function verifyPassword(
  input: { baseUrl: string; origin: string; userId: string; email: string; password: string },
  fetchImpl: typeof fetch = fetch,
): Promise<PasswordCheck> {
  let res: Response;
  try {
    res = await fetchImpl(`${input.baseUrl.replace(/\/$/, "")}/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: input.origin },
      body: JSON.stringify({ email: input.email, password: input.password, rememberMe: false }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (res.status === 429) return { ok: false, reason: "rate-limited" };
  if (res.status === 401) return { ok: false, reason: "wrong" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const body = (await res.json().catch(() => null)) as { token?: unknown; user?: { id?: unknown } } | null;
  // The ids must match too, so only this user's own password can pass.
  if (body?.user?.id !== input.userId) return { ok: false, reason: "wrong" };
  return { ok: true, sessionToken: typeof body.token === "string" ? body.token : null };
}
