// Ported from ZynzTehr/fleet-pulse@88e9f01:
//   src/js/utils/utils.js getMaintenanceStatus
//   src/js/services/fleetStatus.js equipmentReading, equipmentStatus, serviceStatus
import { formatMileage } from "./format";
import type { Equipment, MaintenanceItem, PmStatus, StatusResult } from "./types";

const DAY_MS = 1000 * 60 * 60 * 24;
/** "Due soon" when 15% or less of the interval remains. */
export const DUE_SOON_FRACTION = 0.15;

/**
 * Dual-trigger PM status: whichever of mileage or time is worse wins.
 * Disabled items report ok here; serviceStatus() distinguishes them.
 */
export function getMaintenanceStatus(
  item: MaintenanceItem,
  currentMileage: number | null | undefined,
  now: Date = new Date(),
): { status: PmStatus; reason: string } {
  if (!item.enabled) return { status: "ok", reason: "Disabled" };

  let mileageStatus: PmStatus = "ok";
  let timeStatus: PmStatus = "ok";
  const reasons: string[] = [];

  if (item.mileageInterval && currentMileage != null) {
    const remaining = item.mileageInterval - (currentMileage - (item.lastServiceMileage || 0));
    if (remaining <= 0) {
      mileageStatus = "overdue";
      reasons.push(`${formatMileage(Math.abs(remaining))} mi overdue`);
    } else if (remaining <= item.mileageInterval * DUE_SOON_FRACTION) {
      mileageStatus = "due-soon";
      reasons.push(`${formatMileage(remaining)} mi remaining`);
    }
  }

  if (item.timeInterval && item.lastServiceDate) {
    const daysSinceLast = Math.floor((now.getTime() - new Date(item.lastServiceDate).getTime()) / DAY_MS);
    const daysRemaining = item.timeInterval - daysSinceLast;
    if (daysRemaining <= 0) {
      timeStatus = "overdue";
      reasons.push(`${Math.abs(daysRemaining)} days overdue`);
    } else if (daysRemaining <= item.timeInterval * DUE_SOON_FRACTION) {
      timeStatus = "due-soon";
      reasons.push(`${daysRemaining} days remaining`);
    }
  }

  const worst: PmStatus =
    mileageStatus === "overdue" || timeStatus === "overdue" ? "overdue"
      : mileageStatus === "due-soon" || timeStatus === "due-soon" ? "due-soon"
        : "ok";

  return { status: worst, reason: reasons.join(" · ") || (worst === "ok" ? "On track" : "") };
}

export function equipmentReading(eq: Equipment): string {
  if (eq.type === "reefer") return eq.currentHours == null ? "Hours not recorded" : `${formatMileage(eq.currentHours)} hrs`;
  if (eq.type === "trailer") return "Tracked by service date";
  return eq.currentMileage == null ? "Mileage not recorded" : `${formatMileage(eq.currentMileage)} mi`;
}

function missingBaseline(item: MaintenanceItem, reading: number | null | undefined): boolean {
  return Boolean((item.timeInterval && !item.lastServiceDate)
    || (item.mileageInterval && (item.lastServiceMileage == null || reading == null)));
}

/** Per-item status that never reports "on track" when the baseline is missing. */
export function serviceStatus(item: MaintenanceItem, eq: Equipment, now?: Date): StatusResult {
  if (!item.enabled) return { status: "disabled", reason: "Paused" };
  const reading = eq.type === "tractor" ? eq.currentMileage : null;
  const known: MaintenanceItem = {
    ...item,
    mileageInterval: item.lastServiceMileage == null || reading == null ? null : item.mileageInterval,
    timeInterval: item.lastServiceDate ? item.timeInterval : null,
  };
  const status = getMaintenanceStatus(known, reading, now);
  if (status.status !== "ok") return status;
  if (missingBaseline(item, reading)) return { status: "unknown", reason: "Add last service details" };
  return status;
}

export type BadgeClass = "badge-neutral" | "badge-red" | "badge-yellow" | "badge-green";

export function equipmentStatus(eq: Equipment, items: MaintenanceItem[], now?: Date): { label: string; className: BadgeClass } {
  const enabled = items.filter((item) => item.enabled);
  if (!enabled.length) return { label: "No schedule set", className: "badge-neutral" };
  const statuses = enabled.map((item) => serviceStatus(item, eq, now));
  if (statuses.some((s) => s.status === "overdue")) return { label: "Overdue", className: "badge-red" };
  if (statuses.some((s) => s.status === "due-soon")) return { label: "Due soon", className: "badge-yellow" };
  const reading = eq.currentMileage;
  if (enabled.some((item) => missingBaseline(item, reading))) return { label: "Service history needed", className: "badge-neutral" };
  return { label: "On track", className: "badge-green" };
}
