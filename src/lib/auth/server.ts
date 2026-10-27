import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";

type NeonAuthInstance = ReturnType<typeof createNeonAuth>;
let instance: NeonAuthInstance | null = null;

/**
 * Created on first use, not at import: the SDK throws when the cookie secret is missing,
 * and Next evaluates route modules during `next build`, before deployment env exists.
 */
export function getAuth(): NeonAuthInstance {
  if (instance) return instance;
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl) throw new Error("NEON_AUTH_BASE_URL is not set. Enable Neon Auth and run `neon env pull`.");
  if (!secret || secret.length < 32) throw new Error("NEON_AUTH_COOKIE_SECRET must be at least 32 characters (openssl rand -base64 32).");
  instance = createNeonAuth({ baseUrl, cookies: { secret } });
  return instance;
}

export const LOGIN_URL = "/auth/sign-in";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/** The signed-in user, or null. Never throws for an anonymous request. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const { data: session } = await getAuth().getSession();
  const user = session?.user;
  if (!user?.id) return null;
  return { id: user.id, email: user.email, name: user.name ?? null };
}
