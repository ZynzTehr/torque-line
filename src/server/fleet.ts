import "server-only";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db";
import { getSessionUser, LOGIN_URL } from "@/lib/auth/server";
import { CLOSED_URL, PAUSED_URL } from "@/lib/auth/routes";
import { accountStateOf } from "./accountStore";
import { can, type AdminAction, type PlatformRole } from "@/domain/adminPermissions";
import { platformRoleOf } from "./adminStore";
import { resolveFleetForUser, type FleetContext } from "./fleetStore";

export type { FleetContext };

/**
 * The one entry point for fleet-scoped server code: the signed-in user's active fleet, a redirect
 * to sign in, a redirect to the closed page when the user closed the account or scheduled its deletion,
 * or a redirect to the paused page when an admin has deactivated the fleet.
 * `allowClosedAccount` is only for "Download my data", which a closed account can still use.
 * Never accepts a fleet id from the client.
 */
export async function requireFleet(options?: { allowClosedAccount?: boolean }): Promise<FleetContext> {
  await connection(); // per-user data: always render at request time, never at build
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_URL);
  const fleet = await resolveFleetForUser(getDb(), user);
  if (fleet.account && !options?.allowClosedAccount) redirect(CLOSED_URL);
  if (fleet.status !== "active") redirect(PAUSED_URL);
  return fleet;
}

/** For route handlers: the signed-in user's active fleet on an open account, or null (respond 401) instead of redirecting. */
export async function fleetForRequest(): Promise<FleetContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const fleet = await resolveFleetForUser(getDb(), user);
  return fleet.status === "active" && !fleet.account ? fleet : null;
}

/** The signed-in user's fleet whatever its status or the account's, for the paused and closed pages. */
export async function currentFleetAnyStatus(): Promise<FleetContext | null> {
  await connection();
  const user = await getSessionUser();
  return user ? resolveFleetForUser(getDb(), user) : null;
}

/**
 * A platform admin's identity and role, or a 404 for everyone else (and for an admin whose role doesn't allow
 * `action`) so the admin area doesn't advertise itself. Store functions re-check the role for every change.
 */
export async function requireAdmin(action: AdminAction = "viewAccounts"): Promise<{ userId: string; email: string; role: PlatformRole }> {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_URL);
  const role = await platformRoleOf(getDb(), user.id);
  if (!role || !can({ role }, action)) notFound();
  if (await accountStateOf(getDb(), user.id)) redirect(CLOSED_URL);
  return { userId: user.id, email: user.email, role };
}
