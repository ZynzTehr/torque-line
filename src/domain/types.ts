/**
 * Domain types shared by server code, UI, and tests.
 * IDs are opaque: UUID strings in the hosted app, positive integers in legacy data and tests.
 */
export type Id = string | number;

export type EquipmentType = "tractor" | "trailer" | "reefer";

export interface Equipment {
  id: Id;
  unitNumber: string;
  type: EquipmentType;
  year?: string | null;
  make?: string | null;
  model?: string | null;
  engineSize?: string | null;
  vin?: string | null;
  currentMileage?: number | null;
  currentHours?: number | null;
  readingUpdatedAt?: string | null;
  notes?: string | null;
}

export type PmCategory = "PM-A" | "PM-B" | "PM-C" | "Annual";

export interface MaintenanceItem {
  id?: Id;
  equipmentId?: Id;
  name: string;
  category?: PmCategory | string;
  enabled: boolean;
  mileageInterval?: number | null;
  /** Days between services. */
  timeInterval?: number | null;
  lastServiceMileage?: number | null;
  lastServiceDate?: string | null;
}

export type PmStatus = "ok" | "due-soon" | "overdue";

export interface StatusResult {
  status: PmStatus | "disabled" | "unknown";
  reason: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Positive safe integers (legacy data) or canonical UUIDs (hosted rows). Anything else is rejected. */
export function isValidId(id: unknown): id is Id {
  return (typeof id === "number" && Number.isSafeInteger(id) && id > 0)
    || (typeof id === "string" && UUID.test(id));
}
