// Ported from ZynzTehr/fleet-pulse@88e9f01 src/js/utils/utils.js (duplicate service detection).
import type { Id } from "./types";

/** Trim, lowercase, & -> and, hyphen/underscore/slash -> space, collapse whitespace. */
export function normalizeServiceType(str: string | null | undefined): string {
  if (str == null) return "";
  return String(str).trim().toLowerCase().replace(/&/g, "and").replace(/[-_/]/g, " ").replace(/\s+/g, " ");
}

export function isSameServiceType(a: string | null | undefined, b: string | null | undefined): boolean {
  const normA = normalizeServiceType(a);
  const normB = normalizeServiceType(b);
  return Boolean(normA && normB) && normA === normB;
}

export interface ServiceLike {
  id?: Id | null;
  equipmentId?: Id | null;
  date?: string | null;
  serviceType?: string | null;
}

/**
 * Existing record on the same unit, same calendar date, same normalized service type; else null.
 * Different dates never match, and distinct services on one shop visit can coexist.
 */
export function findSimilarServiceRecord<T extends ServiceLike>(
  newRecord: ServiceLike | null | undefined,
  existingRecords: (T | null | undefined)[] = [],
  options: { excludeId?: Id | null } = {},
): T | null {
  if (!newRecord || !newRecord.date || !newRecord.serviceType) return null;
  const newDate = String(newRecord.date).slice(0, 10);
  const excludeId = options.excludeId ?? newRecord.id;
  for (const rec of existingRecords) {
    if (!rec) continue;
    if (excludeId != null && rec.id === excludeId) continue;
    if (newRecord.equipmentId != null && rec.equipmentId !== newRecord.equipmentId) continue;
    const recDate = rec.date ? String(rec.date).slice(0, 10) : "";
    if (!recDate || recDate !== newDate) continue;
    if (isSameServiceType(rec.serviceType, newRecord.serviceType)) return rec;
  }
  return null;
}
