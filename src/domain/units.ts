/** Unit numbers are unique per fleet after trimming and uppercasing; the display value is kept as typed. */
export function normalizeUnitNumber(unitNumber: string | null | undefined): string {
  return String(unitNumber ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}
