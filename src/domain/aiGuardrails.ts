// Ported from ZynzTehr/fleet-pulse@88e9f01 src/js/services/ai.js (guardrails) and src/js/utils/utils.js (sanitizePromptInput).
// AI output is untrusted: these checks flag suspicious values; nothing is saved without the user's confirmation.

export const ALLOWED_CATEGORIES = ["PM-A", "PM-B", "PM-C", "Annual"] as const;

type Bounds = { min: number | null; max: number | null };

/** Hard min/max values that catch obvious hallucinations. Mileage in miles, time in days. */
export const SANITY_BOUNDS = {
  mileage: {
    min: 2000,
    max: 500000,
    "PM-A": { min: 5000, max: 30000 },
    "PM-B": { min: 15000, max: 75000 },
    "PM-C": { min: 50000, max: 300000 },
    Annual: { min: null, max: null },
  },
  time: {
    min: 14,
    max: 1095,
    "PM-A": { min: 30, max: 120 },
    "PM-B": { min: 90, max: 365 },
    "PM-C": { min: 180, max: 730 },
    Annual: { min: 330, max: 400 },
  },
} as const;

export interface IntervalItem {
  name: string;
  category: string;
  mileageInterval: number | null;
  timeInterval: number | null;
  [key: string]: unknown;
}

function categoryBounds(kind: "mileage" | "time", category: string): Partial<Bounds> {
  const table = SANITY_BOUNDS[kind] as unknown as Record<string, Bounds | number>;
  const entry = table[category];
  return typeof entry === "object" && entry !== null ? entry : {};
}

/** Attach warnings for intervals outside per-category or global bounds, or with no trigger at all. */
export function validateMaintenanceItem<T extends IntervalItem>(item: T): T & { warnings: string[] } {
  const warnings: string[] = [];

  if (item.mileageInterval != null) {
    const b = categoryBounds("mileage", item.category);
    const min = b.min ?? SANITY_BOUNDS.mileage.min;
    const max = b.max ?? SANITY_BOUNDS.mileage.max;
    if (min != null && item.mileageInterval < min) {
      warnings.push(`Mileage interval (${item.mileageInterval.toLocaleString()} mi) is unusually LOW for ${item.category}. Expected at least ${min.toLocaleString()} mi.`);
    }
    if (max != null && item.mileageInterval > max) {
      warnings.push(`Mileage interval (${item.mileageInterval.toLocaleString()} mi) is unusually HIGH for ${item.category}. Expected at most ${max.toLocaleString()} mi.`);
    }
  }

  if (item.timeInterval != null) {
    const b = categoryBounds("time", item.category);
    const min = b.min ?? SANITY_BOUNDS.time.min;
    const max = b.max ?? SANITY_BOUNDS.time.max;
    if (min != null && item.timeInterval < min) {
      warnings.push(`Time interval (${item.timeInterval}d) is unusually SHORT for ${item.category}. Expected at least ${min}d.`);
    }
    if (max != null && item.timeInterval > max) {
      warnings.push(`Time interval (${item.timeInterval}d) is unusually LONG for ${item.category}. Expected at most ${max}d.`);
    }
  }

  if (item.mileageInterval == null && item.timeInterval == null) {
    warnings.push("No mileage or time interval specified — this item has no trigger.");
  }

  return { ...item, warnings };
}

/** PM-A average mileage must be below PM-B, and PM-B below PM-C. */
export function checkMonotonicity(items: Pick<IntervalItem, "category" | "mileageInterval">[]): string[] {
  const warnings: string[] = [];
  const avg = (cat: string): number | null => {
    const values = items.filter((i) => i.category === cat && i.mileageInterval != null).map((i) => i.mileageInterval as number);
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  };
  const a = avg("PM-A"), b = avg("PM-B"), c = avg("PM-C");
  if (a != null && b != null && a >= b) {
    warnings.push(`PM-A average mileage interval (${Math.round(a).toLocaleString()} mi) should be SHORTER than PM-B (${Math.round(b).toLocaleString()} mi). This looks suspicious.`);
  }
  if (b != null && c != null && b >= c) {
    warnings.push(`PM-B average mileage interval (${Math.round(b).toLocaleString()} mi) should be SHORTER than PM-C (${Math.round(c).toLocaleString()} mi). This looks suspicious.`);
  }
  return warnings;
}

/** Sound effects and roleplay words that should never appear in a maintenance schedule. */
export const PERSONA_LEAK = /\b(woof|bark|meow|quack|arrr|ahoy|matey|doggo|puppy)\b/i;

/**
 * Strip common instruction-override, persona, and prefix/suffix injection phrasings from user text
 * before it is placed in a prompt, while keeping real vehicle data (e.g. "Mack Bulldog"). 500-char cap.
 */
export function sanitizePromptInput(str: unknown): string {
  if (str == null) return "";
  return String(str)
    .replace(/ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/gi, "")
    .replace(/system\s*:\s*/gi, "")
    .replace(/\bdo\s+not\s+follow\b/gi, "")
    .replace(/\breturn\s+only\b/gi, "")
    .replace(/\b(you\s+are\s+(now\s+)?|act\s+as\s+|pretend\s+to\s+be\s+|adopt\s+(the\s+)?(persona|character|role)\s+of\s+|roleplay\s+as\s+|speak\s+like\s+|talk\s+like\s+)(a\s+|an\s+)?[\w\s]{1,30}/gi, "")
    .replace(/\b(start|begin|end|conclude|respond|prefix|suffix)\s+(with|by\s+saying|with\s+the\s+phrase|with\s+the\s+word|with\s+the\s+sound)\s+["'“]?[^"'”\n]{1,50}["'”]?/gi, "")
    .replace(/\b(bark|meow|woof)\s+(and\s+say\s+[\w\s]+|like\s+a\s+\w+)?/gi, "")
    .trim()
    .slice(0, 500);
}
