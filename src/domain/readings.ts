/**
 * A new meter reading is either accepted or needs the user's explicit review.
 * Lower readings usually mean an entry error; corrections and odometer rollovers are confirmed, never silent.
 */
export type ReadingCheck =
  | { kind: "ok" }
  | { kind: "lower-than-current"; current: number; next: number }
  | { kind: "invalid"; message: string };

export const MAX_ODOMETER = 9_999_999;
export const MAX_HOURS = 999_999;

export function checkReading(
  current: number | null | undefined,
  next: number,
  meter: "odometer" | "hours" = "odometer",
): ReadingCheck {
  const max = meter === "hours" ? MAX_HOURS : MAX_ODOMETER;
  if (!Number.isFinite(next) || next < 0) return { kind: "invalid", message: "Enter a reading of zero or more." };
  if (next > max) return { kind: "invalid", message: `Readings above ${max.toLocaleString("en-US")} are not supported.` };
  if (current != null && current > 0 && next < current) return { kind: "lower-than-current", current, next };
  return { kind: "ok" };
}
