import { describe, expect, it } from "vitest";
import { checkReading, MAX_ODOMETER } from "@/domain/readings";
import { normalizeUnitNumber } from "@/domain/units";
import { equipmentStatus } from "@/domain/maintenance";

describe("checkReading: a lower reading never silently replaces the one on file", () => {
  it("accepts a first reading and an increase", () => {
    expect(checkReading(null, 482150)).toEqual({ kind: "ok" });
    expect(checkReading(482150, 482150)).toEqual({ kind: "ok" });
    expect(checkReading(482150, 483000)).toEqual({ kind: "ok" });
  });
  it("flags a lower reading for explicit review instead of accepting it", () => {
    expect(checkReading(482150, 481150)).toEqual({ kind: "lower-than-current", current: 482150, next: 481150 });
  });
  it("applies to reefer hour meters too", () => {
    expect(checkReading(8420, 8400, "hours")).toMatchObject({ kind: "lower-than-current" });
  });
  it("rejects negative, non-finite and out-of-range values", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, MAX_ODOMETER + 1]) {
      expect(checkReading(100, bad).kind).toBe("invalid");
    }
  });
});

describe("normalizeUnitNumber", () => {
  it("makes unit identity case- and whitespace-insensitive", () => {
    expect(normalizeUnitNumber("  trk-101 ")).toBe("TRK-101");
    expect(normalizeUnitNumber("R  301")).toBe("R 301");
    expect(normalizeUnitNumber(null)).toBe("");
  });
});

describe("equipmentStatus", () => {
  const truck = { id: 1, unitNumber: "101", type: "tractor" as const, currentMileage: 482150 };
  const now = new Date("2026-10-26T12:00:00Z");
  it("reports overdue when either trigger is past due", () => {
    const items = [{ name: "Oil", enabled: true, mileageInterval: 15000, lastServiceMileage: 460000 }];
    expect(equipmentStatus(truck, items, now).label).toBe("Overdue");
  });
  it("never reports on track when the service baseline is missing", () => {
    const items = [{ name: "Oil", enabled: true, mileageInterval: 15000, lastServiceMileage: null }];
    expect(equipmentStatus(truck, items, now).label).toBe("Service history needed");
  });
  it("reports no schedule when nothing is enabled", () => {
    expect(equipmentStatus(truck, [{ name: "Oil", enabled: false }], now).label).toBe("No schedule set");
  });
});
