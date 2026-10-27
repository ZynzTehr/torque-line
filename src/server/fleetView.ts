import "server-only";
import type { BoardEquipment, BoardSchedule } from "@/domain/workboard";
import type { EquipmentRow } from "./equipmentStore";
import type { ScheduleRow } from "./scheduleStore";

/** Plain, serializable shapes for passing rows from server components into client components. */
export const toBoardEquipment = (e: EquipmentRow): BoardEquipment => ({
  id: e.id, unitNumber: e.unitNumber, type: e.type, currentMileage: e.currentMileage, currentHours: e.currentHours,
  readingUpdatedAt: e.readingUpdatedAt?.toISOString() ?? null, year: e.year, make: e.make, model: e.model,
});

export const toBoardSchedule = (s: ScheduleRow): BoardSchedule => ({
  id: s.id, equipmentId: s.equipmentId, name: s.name, category: s.category, enabled: s.enabled,
  mileageInterval: s.mileageInterval, timeIntervalDays: s.timeIntervalDays,
  lastServiceMileage: s.lastServiceMileage, lastServiceDate: s.lastServiceDate,
});
