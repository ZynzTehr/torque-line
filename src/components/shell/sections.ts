import type { IconName } from "@/components/icons";

/** Main sections in swipe order. Settings sits outside the swipe ring. */
export const SECTIONS: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/equipment", label: "Equipment", icon: "truck" },
  { href: "/fuel", label: "Fuel", icon: "fuel" },
  { href: "/diagnostics", label: "Diagnostics", icon: "wrench" },
];

export function sectionIndex(pathname: string): number {
  return SECTIONS.findIndex((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
}

/** Direction of the most recent section change, read by the page transition. */
export const navDirection = { current: 0 };

export interface SwipeSample { dx: number; dy: number; ms: number }

/**
 * A deliberate horizontal flick: far enough, mostly horizontal, and quick.
 * Returns -1 for a swipe left (next section), 1 for right (previous), 0 otherwise.
 */
export function classifySwipe({ dx, dy, ms }: SwipeSample, minDistance = 70): -1 | 0 | 1 {
  if (Math.abs(dx) < minDistance) return 0;
  if (Math.abs(dy) > Math.abs(dx) * 0.5) return 0;
  if (ms > 700) return 0;
  return dx < 0 ? -1 : 1;
}
