// Ported from ZynzTehr/fleet-pulse@88e9f01 src/js/utils/utils.js (formatting helpers).

const DAY_MS = 1000 * 60 * 60 * 24;

/** 123456 -> "123,456"; null -> em dash. */
export function formatMileage(n: number | string | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US");
}

/** US currency, e.g. $1,234.56. */
export function formatCurrency(n: number | string | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "$0.00";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "Sep 29, 2026"; empty -> em dash. */
export function formatDate(isoStr: string | null | undefined): string {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Whole days since an ISO date; Infinity when unknown. */
export function daysSince(isoStr: string | null | undefined, now: Date = new Date()): number {
  if (!isoStr) return Infinity;
  return Math.floor((now.getTime() - new Date(isoStr).getTime()) / DAY_MS);
}

export function getStalenessClass(lastUpdated: string | null | undefined, now?: Date): string {
  const days = daysSince(lastUpdated, now);
  if (days <= 7) return "staleness-fresh";
  if (days <= 14) return "staleness-stale";
  return "staleness-old";
}

export function getStalenessLabel(lastUpdated: string | null | undefined, now?: Date): string {
  const days = daysSince(lastUpdated, now);
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days <= 7) return `Updated ${days}d ago`;
  if (days === Infinity) return "Never updated";
  return `${days}d since update`;
}
