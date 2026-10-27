import { normalizeServiceType } from "./serviceRecords";
import { DEFAULT_TEMPLATES } from "./templates";

/*
 * Rules for the anonymized statistics kept after an account is purged (accountPurge.ts). Free text the owner typed
 * is either mapped onto a fixed vocabulary or dropped, so nothing they wrote about a person or place survives.
 */

/** Every standard service name, normalized: the only service types the statistics keep. */
const STANDARD_SERVICES = new Set(Object.values(DEFAULT_TEMPLATES).flat().map((t) => normalizeServiceType(t.name)));

/** The normalized standard service name the owner logged, or "other" for anything they worded themselves. */
export function standardServiceType(serviceType: string | null | undefined): string {
  const normalized = normalizeServiceType(serviceType);
  return STANDARD_SERVICES.has(normalized) ? normalized : "other";
}

/** A model year, or null when the field holds anything but a plausible year. */
export function modelYear(year: string | null | undefined): number | null {
  const n = Number(String(year ?? "").trim());
  return Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null;
}

/** Make, model or engine as a short descriptor: trimmed, whitespace collapsed, at most 40 characters, null when blank. */
export function descriptor(text: string | null | undefined): string | null {
  const clean = String(text ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return clean || null;
}

/** The first day of the date's month (UTC), as YYYY-MM-01: the only date precision the statistics keep. */
export function monthOf(date: string | Date): string {
  const iso = typeof date === "string" ? date : date.toISOString();
  return `${iso.slice(0, 7)}-01`;
}
