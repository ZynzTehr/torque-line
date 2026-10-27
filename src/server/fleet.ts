import "server-only";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db";
import { getSessionUser, LOGIN_URL } from "@/lib/auth/server";
import { PAUSED_URL } from "@/lib/auth/routes";
import { isPlatformAdmin } from "./adminStore";
import { resolveFleetForUser, type FleetContext } from "./fleetStore";

export type { FleetContext };

/**
 * The one entry point for fleet-scoped server code: the signed-in user's active fleet, a redirect
 * to sign in, or a redirect to the paused page when an admin has deactivated the fleet.
 * Never accepts a fleet id from the client.
 */
export async function requireFleet(): Promise<FleetContext> {
  await connection(); // per-user data: always render at request time, never at build
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_URL);
  const fleet = await resolveFleetForUser(getDb(), user);
  if (fleet.status !== "active") redirect(PAUSED_URL);
  return fleet;
}

/** For route handlers: the signed-in user's active fleet, or null (respond 401) instead of redirecting. */
export async function fleetForRequest(): Promise<FleetContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const fleet = await resolveFleetForUser(getDb(), user);
  return fleet.status === "active" ? fleet : null;
}

/** The signed-in user's fleet whatever its status, for the paused page. */
export async function currentFleetAnyStatus(): Promise<FleetContext | null> {
  await connection();
  const user = await getSessionUser();
  return user ? resolveFleetForUser(getDb(), user) : null;
}

/** A platform admin's identity, or a 404 for everyone else so the admin area doesn't advertise itself. */
export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_URL);
  if (!(await isPlatformAdmin(getDb(), user.id))) notFound();
  return { userId: user.id, email: user.email };
}
