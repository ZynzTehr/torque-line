"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import type { PlatformRole } from "@/domain/adminPermissions";
import { addPlatformAdmin, removePlatformAdmin, setFleetStatus, setPlatformAdminRole } from "@/server/adminStore";
import { requireAdmin } from "@/server/fleet";
import { guarded } from "@/server/guarded";
import type { FleetStatus } from "@/server/fleetStore";

/*
 * requireAdmin 404s a non-admin before any work; each store function then checks the actor's role with `can`
 * itself, so a support admin calling an admin-management action directly gets "forbidden".
 */

export async function setFleetStatusAction(fleetId: string, status: FleetStatus, note?: string) {
  return guarded("setFleetStatus", async () => {
    const { userId } = await requireAdmin();
    const r = await setFleetStatus(getDb(), userId, { fleetId, status, note });
    if (r.ok) refresh();
    return r;
  });
}

export async function addAdminAction(email: string, role: PlatformRole) {
  return guarded("addAdmin", async () => {
    const { userId } = await requireAdmin();
    const r = await addPlatformAdmin(getDb(), userId, { email, role });
    if (r.ok) refresh();
    return r;
  });
}

export async function setAdminRoleAction(targetUserId: string, role: PlatformRole) {
  return guarded("setAdminRole", async () => {
    const { userId } = await requireAdmin();
    const r = await setPlatformAdminRole(getDb(), userId, { userId: targetUserId, role });
    if (r.ok) refresh();
    return r;
  });
}

export async function removeAdminAction(targetUserId: string) {
  return guarded("removeAdmin", async () => {
    const { userId } = await requireAdmin();
    const r = await removePlatformAdmin(getDb(), userId, { userId: targetUserId });
    if (r.ok) refresh();
    return r;
  });
}
