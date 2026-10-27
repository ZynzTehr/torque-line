// Ported from ZynzTehr/fleet-pulse@88e9f01 src/js/components/dashboard.js (renderWorkboard data logic).
import { daysSince } from "./format";
import { equipmentStatus, serviceStatus } from "./maintenance";
import type { Equipment, EquipmentType, MaintenanceItem, StatusResult } from "./types";

export interface BoardEquipment {
  id: string;
  unitNumber: string;
  type: EquipmentType;
  currentMileage: number | null;
  currentHours: number | null;
  readingUpdatedAt: string | null;
  year?: string | null;
  make?: string | null;
  model?: string | null;
}

/** Schedule row shape as stored (time interval in days). */
export interface BoardSchedule {
  id: string;
  equipmentId: string;
  name: string;
  category: string;
  enabled: boolean;
  mileageInterval: number | null;
  timeIntervalDays: number | null;
  lastServiceMileage: number | null;
  lastServiceDate: string | null;
}

export interface AttentionItem { equipment: BoardEquipment; schedule: BoardSchedule; status: StatusResult["status"]; reason: string }

/** Meter readings older than this many days need an update. */
export const STALE_AFTER_DAYS = 14;

const toItem = (s: BoardSchedule): MaintenanceItem => ({
  id: s.id, equipmentId: s.equipmentId, name: s.name, category: s.category, enabled: s.enabled,
  mileageInterval: s.mileageInterval, timeInterval: s.timeIntervalDays,
  lastServiceMileage: s.lastServiceMileage, lastServiceDate: s.lastServiceDate,
});
const toEquipment = (e: BoardEquipment): Equipment => ({ ...e });
const RANK: Record<string, number> = { overdue: 0, "due-soon": 1, unknown: 2 };

export function buildWorkboard(equipment: BoardEquipment[], schedules: BoardSchedule[], now: Date = new Date()) {
  const byUnit = new Map<string, BoardSchedule[]>();
  for (const s of schedules) byUnit.set(s.equipmentId, [...(byUnit.get(s.equipmentId) ?? []), s]);

  const attention: AttentionItem[] = equipment
    .flatMap((eq) => (byUnit.get(eq.id) ?? []).filter((s) => s.enabled).map((schedule) => {
      const { status, reason } = serviceStatus(toItem(schedule), toEquipment(eq), now);
      return { equipment: eq, schedule, status, reason };
    }))
    .filter((a) => a.status in RANK)
    .sort((x, y) => RANK[x.status] - RANK[y.status]);

  const noSchedule = equipment.filter((eq) => !(byUnit.get(eq.id) ?? []).some((s) => s.enabled));
  const stale = equipment.filter((eq) => eq.type !== "trailer" && daysSince(eq.readingUpdatedAt, now) > STALE_AFTER_DAYS);
  const register = equipment.map((eq) => ({
    equipment: eq,
    status: equipmentStatus(toEquipment(eq), (byUnit.get(eq.id) ?? []).map(toItem), now),
  }));

  return {
    counts: {
      units: equipment.length,
      overdue: attention.filter((a) => a.status === "overdue").length,
      dueSoon: attention.filter((a) => a.status === "due-soon").length,
    },
    attention,
    noSchedule,
    stale,
    register,
  };
}

export type Workboard = ReturnType<typeof buildWorkboard>;
