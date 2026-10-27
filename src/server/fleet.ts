import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db";
import { getSessionUser, LOGIN_URL } from "@/lib/auth/server";
import { resolveFleetForUser, type FleetContext } from "./fleetStore";

export type { FleetContext };

/**
 * The one entry point for fleet-scoped server code: the signed-in user's fleet, or a redirect
 * to sign in. Never accepts a fleet id from the client.
 */
export async function requireFleet(): Promise<FleetContext> {
  await connection(); // per-user data: always render at request time, never at build
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_URL);
  return resolveFleetForUser(getDb(), user);
}

/** For route handlers: the signed-in user's fleet, or null (respond 401) instead of redirecting. */
export async function fleetForRequest(): Promise<FleetContext | null> {
  const user = await getSessionUser();
  return user ? resolveFleetForUser(getDb(), user) : null;
}
