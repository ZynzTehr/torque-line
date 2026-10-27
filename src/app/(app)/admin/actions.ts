"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { can, type AdminAction, type PlatformRole } from "@/domain/adminPermissions";
import { addPlatformAdmin, removePlatformAdmin, setFleetStatus, setPlatformAdminRole } from "@/server/adminStore";
import { requireAdmin } from "@/server/fleet";
import { guarded } from "@/server/guarded";
import type { FleetStatus } from "@/server/fleetStore";
import { forbidden } from "@/server/result";

/*
 * requireAdmin 404s a non-admin before any work, and `actorFor` refuses an admin whose role doesn't allow the action,
 * so a support admin calling an admin-management action directly gets "forbidden" without reaching the store. Each
 * store function re-checks the role with `can` inside its transaction, after taking the admin lock: that is the
 * check that holds when roles change mid-request.
 */
async function actorFor(action: AdminAction): Promise<string | null> {
  const { userId, role } = await requireAdmin();
  return can({ role }, action) ? userId : null;
}

export async function setFleetStatusAction(fleetId: string, status: FleetStatus, note?: string) {
  return guarded("setFleetStatus", async () => {
    const userId = await actorFor("setFleetStatus");
    if (!userId) return forbidden();
    const r = await setFleetStatus(getDb(), userId, { fleetId, status, note });
    if (r.ok) refresh();
    return r;
  });
}

export async function addAdminAction(email: string, role: PlatformRole) {
  return guarded("addAdmin", async () => {
    const userId = await actorFor("manageAdmins");
    if (!userId) return forbidden();
    const r = await addPlatformAdmin(getDb(), userId, { email, role });
    if (r.ok) refresh();
    return r;
  });
}

export async function setAdminRoleAction(targetUserId: string, role: PlatformRole) {
  return guarded("setAdminRole", async () => {
    const userId = await actorFor("manageAdmins");
    if (!userId) return forbidden();
    const r = await setPlatformAdminRole(getDb(), userId, { userId: targetUserId, role });
    if (r.ok) refresh();
    return r;
  });
}

export async function removeAdminAction(targetUserId: string) {
  return guarded("removeAdmin", async () => {
    const userId = await actorFor("manageAdmins");
    if (!userId) return forbidden();
    const r = await removePlatformAdmin(getDb(), userId, { userId: targetUserId });
    if (r.ok) refresh();
    return r;
  });
}
