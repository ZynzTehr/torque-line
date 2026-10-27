"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { setFleetStatus } from "@/server/adminStore";
import { requireAdmin } from "@/server/fleet";
import { guarded } from "@/server/guarded";
import type { FleetStatus } from "@/server/fleetStore";

/** setFleetStatus re-checks platform_admins itself; requireAdmin also 404s a non-admin before any work. */
export async function setFleetStatusAction(fleetId: string, status: FleetStatus, note?: string) {
  return guarded("setFleetStatus", async () => {
    const { userId } = await requireAdmin();
    const r = await setFleetStatus(getDb(), userId, { fleetId, status, note });
    if (r.ok) refresh();
    return r;
  });
}
