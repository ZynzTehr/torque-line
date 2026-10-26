// Ported from ZynzTehr/fleet-pulse@88e9f01 src/js/services/fuel.js.
// Money is summed in integer cents to avoid floating-point drift.
import { isValidId, type Equipment, type Id } from "./types";

export const FUEL_TYPES = { diesel: "Diesel", def: "DEF", reefer: "Reefer fuel" } as const;
export type FuelType = keyof typeof FUEL_TYPES;

export function isFuelType(value: unknown): value is FuelType {
  return typeof value === "string" && Object.hasOwn(FUEL_TYPES, value);
}

/** Diesel and DEF go to tractors; reefer fuel goes to reefers. */
export function canFuelEquipment(type: unknown, equipment: Pick<Equipment, "type"> | null | undefined): boolean {
  return type === "reefer" ? equipment?.type === "reefer"
    : (type === "diesel" || type === "def") && equipment?.type === "tractor";
}

/** "" / null -> null; non-number/string -> NaN; else Number(value). */
export function optionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return NaN;
  return Number(value);
}

/** Strict YYYY-MM-DD that round-trips through Date. */
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export interface FuelEntry {
  id?: Id | null;
  equipmentId: Id;
  fuelType: FuelType;
  date: string;
  gallons?: number | null;
  pricePerGallon?: number | null;
  totalCost: number;
  odometer?: number | null;
  hours?: number | null;
  [key: string]: unknown;
}

const NUMERIC_FIELDS = ["totalCost", "gallons", "pricePerGallon", "odometer", "hours"] as const;

export function validateFuelEntry(data: Record<string, unknown>, equipment: Equipment | null | undefined): FuelEntry {
  if (!isValidId(data.equipmentId) || (data.id != null && !isValidId(data.id))) {
    throw new Error("Fuel entries must use valid unit and entry IDs.");
  }
  if (!canFuelEquipment(data.fuelType, equipment)) throw new Error("Link diesel and DEF to a truck, and reefer fuel to a reefer.");
  if (!validDate(data.date)) throw new Error("Enter a valid fuel date.");
  const result: Record<string, unknown> = { ...data };
  for (const key of NUMERIC_FIELDS) {
    const n = optionalNumber(data[key]);
    if ((key === "totalCost" && n == null) || (n != null && (!Number.isFinite(n) || n < 0))) {
      throw new Error("Enter a total cost and use valid, non-negative numbers.");
    }
    result[key] = n;
  }
  const total = result.totalCost as number;
  if (!Number.isSafeInteger(Math.round(total * 100))) throw new Error("Total cost is too large.");
  result.totalCost = Math.round(total * 100) / 100;
  result.odometer = equipment!.type === "tractor" ? result.odometer : null;
  result.hours = equipment!.type === "reefer" ? result.hours : null;
  return result as FuelEntry;
}

/** Sum a money field in cents; ignores missing or negative values; tolerates numeric strings. */
export function sumCosts(items: Record<string, unknown>[], field: string): number {
  return items.reduce<number>((sum, item) => {
    const n = optionalNumber(item[field]);
    return sum + (n != null && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0);
  }, 0) / 100;
}

export interface UnitCosts {
  serviceSpend: number;
  fuelSpend: number;
  totalSpend: number;
  /** Cost per mile (tractor) or per hour (reefer); null when the distance basis is not trustworthy. */
  rate: number | null;
  distance: number;
  firstDate: string | undefined;
  baseline: number | null;
  end: number | null;
}

type CostRecord = { date?: string | null; cost?: unknown; mileage?: unknown; hours?: unknown };
type FuelLine = { date?: string | null; totalCost?: unknown; odometer?: unknown; hours?: unknown };

export function unitCosts(equipment: Equipment | null | undefined, records: CostRecord[], fuel: FuelLine[]): UnitCosts {
  const isTrailer = equipment?.type === "trailer";
  const isReefer = equipment?.type === "reefer";
  const serviceSpend = sumCosts(records as Record<string, unknown>[], "cost");
  const fuelSpend = isTrailer ? 0 : sumCosts(fuel as Record<string, unknown>[], "totalCost");
  const totalSpend = Math.round((serviceSpend + fuelSpend) * 100) / 100;
  const expenses = [
    ...records.filter((r) => Number(r.cost) > 0).map((r) => ({ date: r.date, reading: optionalNumber(isReefer ? r.hours : r.mileage) })),
    ...(isTrailer ? [] : fuel.filter((f) => Number(f.totalCost) > 0).map((f) => ({ date: f.date, reading: optionalNumber(isReefer ? f.hours : f.odometer) }))),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const firstDate = expenses[0]?.date ?? undefined;
  const isReading = (n: number | null): n is number => n != null && Number.isFinite(n) && n >= 0;
  const firstReadings = expenses.filter((e) => e.date === firstDate).map((e) => e.reading).filter(isReading);
  const baseline = firstReadings.length ? Math.min(...firstReadings) : null;
  const current = optionalNumber(isReefer ? equipment?.currentHours : equipment?.currentMileage);
  const readings = [current, ...expenses.map((e) => e.reading)].filter(isReading);
  const end = readings.length ? Math.max(...readings) : null;
  const distance = baseline != null && end != null ? end - baseline : 0;
  // Never imply a lifetime rate or divide costs by an unrelated odometer.
  const consistent = baseline != null && expenses.every((e) => e.reading == null || (Number.isFinite(e.reading) && e.reading >= baseline));
  const rate = !isTrailer && expenses.every((e) => validDate(e.date)) && consistent && distance > 0 ? totalSpend / distance : null;
  return { serviceSpend, fuelSpend, totalSpend, rate, distance, firstDate, baseline, end };
}

export interface NormalizedReceipt {
  is_fuel_receipt: boolean;
  confidence: "high" | "medium" | "low";
  date?: string | null;
  fuel_type?: FuelType | null;
  location?: string | null;
  notes?: string | null;
  multiple_fuel_types?: boolean;
  gallons?: number | null;
  price_per_gallon?: number | null;
  total_cost?: number | null;
  odometer?: number | null;
  hours?: number | null;
}

/** Treat model output as untrusted: keep only well-typed, bounded, non-negative fields. */
export function normalizeFuelReceipt(parsed: unknown): NormalizedReceipt {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as Record<string, unknown>).is_fuel_receipt !== true) {
    return { is_fuel_receipt: false, confidence: "low" };
  }
  const p = parsed as Record<string, unknown>;
  const confidence = p.confidence === "high" || p.confidence === "medium" || p.confidence === "low" ? p.confidence : "low";
  const result: NormalizedReceipt = {
    is_fuel_receipt: true,
    confidence,
    date: validDate(p.date) ? p.date : null,
    fuel_type: isFuelType(p.fuel_type) ? p.fuel_type : null,
    location: typeof p.location === "string" ? p.location.slice(0, 300) : null,
    notes: typeof p.notes === "string" ? p.notes.slice(0, 2000) : null,
    multiple_fuel_types: p.multiple_fuel_types === true,
  };
  for (const field of ["gallons", "price_per_gallon", "total_cost", "odometer", "hours"] as const) {
    const n = optionalNumber(p[field]);
    result[field] = n != null && Number.isFinite(n) && n >= 0 ? n : null;
  }
  return result;
}

export interface FuelPurchaseItem {
  equipmentId: Id;
  fuelType: FuelType;
  gallons: number | null;
  pricePerGallon: number | null;
  totalCost: number;
  odometer: number | null;
  hours: number | null;
}

export interface FuelPurchase {
  id?: Id;
  createdAt?: string;
  date: string;
  location: string;
  notes: string;
  receiptImage: string | null;
  items: FuelPurchaseItem[];
  /** Counted once per stop: the sum of its line subtotals. */
  totalCost: number;
}

/**
 * Flatten stops into per-unit lines that carry the stop's id and date, so each unit
 * sees only its own subtotal. Legacy single-product records pass through unchanged.
 */
export function fuelLines(purchases: Record<string, unknown>[]): Record<string, unknown>[] {
  return purchases.flatMap((purchase): Record<string, unknown>[] => Array.isArray(purchase.items)
    ? (purchase.items as Record<string, unknown>[]).map((item) => ({ ...item, id: purchase.id, date: purchase.date, createdAt: purchase.createdAt }))
    : [purchase]);
}

/** One stop, up to one line per product; diesel and DEF must share a truck. */
export function validateFuelPurchase(data: Record<string, unknown>, equipment: Equipment[]): FuelPurchase | FuelEntry {
  if (!Object.hasOwn(data, "items")) return validateFuelEntry(data, equipment.find((eq) => eq.id === data.equipmentId));
  const rawItems = data.items;
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 3) throw new Error("Enter at least one fuel product.");
  if (data.id != null && !isValidId(data.id)) throw new Error("Invalid fuel transaction ID.");
  const types = new Set<unknown>();
  let truckId: Id | null = null;
  const items = rawItems.map((item: Record<string, unknown>) => {
    if (!item || types.has(item.fuelType)) throw new Error("Use one line each for Diesel, DEF, and Reefer.");
    types.add(item.fuelType);
    const v = validateFuelEntry({ ...item, date: data.date }, equipment.find((eq) => eq.id === item.equipmentId));
    if (item.fuelType !== "reefer") {
      if (truckId != null && truckId !== item.equipmentId) throw new Error("Diesel and DEF must belong to the same truck.");
      truckId = item.equipmentId as Id;
    }
    return {
      equipmentId: v.equipmentId, fuelType: v.fuelType,
      gallons: v.gallons ?? null, pricePerGallon: v.pricePerGallon ?? null, totalCost: v.totalCost,
      odometer: v.odometer ?? null, hours: v.hours ?? null,
    };
  });
  return {
    ...(data.id != null ? { id: data.id as Id } : {}), ...(data.createdAt ? { createdAt: String(data.createdAt) } : {}),
    date: data.date as string, location: (data.location as string) || "", notes: (data.notes as string) || "",
    receiptImage: (data.receiptImage as string) || null,
    items, totalCost: sumCosts(items as unknown as Record<string, unknown>[], "totalCost"),
  };
}

export interface NormalizedFuelTransaction extends NormalizedReceipt {
  items: { fuel_type: FuelType | null | undefined; gallons: number | null | undefined; price_per_gallon: number | null | undefined; total_cost: number | null | undefined }[];
}

export function normalizeFuelTransactionReceipt(parsed: unknown): NormalizedFuelTransaction {
  const empty: NormalizedFuelTransaction = { is_fuel_receipt: false, confidence: "low", items: [] };
  const p = parsed as Record<string, unknown> | null;
  if (!p || p.is_fuel_receipt !== true || !Array.isArray(p.items)) return empty;
  const shared = normalizeFuelReceipt(p);
  const types = new Set<string>();
  const items: NormalizedFuelTransaction["items"] = [];
  for (const item of p.items as Record<string, unknown>[]) {
    if (!item || !isFuelType(item.fuel_type) || types.has(item.fuel_type)) return empty;
    types.add(item.fuel_type);
    const n = normalizeFuelReceipt({ ...item, is_fuel_receipt: true });
    items.push({ fuel_type: n.fuel_type, gallons: n.gallons, price_per_gallon: n.price_per_gallon, total_cost: n.total_cost });
  }
  return { ...shared, items };
}
