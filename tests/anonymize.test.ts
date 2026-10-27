import { describe, expect, it } from "vitest";
import { descriptor, modelYear, monthOf, standardServiceType } from "@/domain/anonymize";

describe("anonymized statistics rules", () => {
  it("keeps a standard service name, normalized, and turns the owner's own wording into 'other'", () => {
    expect(standardServiceType("Oil & Filter Change")).toBe("oil and filter change");
    expect(standardServiceType("  dot annual   INSPECTION ")).toBe("dot annual inspection");
    expect(standardServiceType("Oil change at Bob's, call 555-0100")).toBe("other");
    expect(standardServiceType("")).toBe("other");
    expect(standardServiceType(null)).toBe("other");
  });

  it("keeps only a plausible model year", () => {
    expect(modelYear("2019")).toBe(2019);
    expect(modelYear(" 2019 ")).toBe(2019);
    expect(modelYear("19")).toBeNull();
    expect(modelYear("2019 Cascadia")).toBeNull();
    expect(modelYear(null)).toBeNull();
  });

  it("shortens make and model to a trimmed descriptor", () => {
    expect(descriptor("  Freightliner   Cascadia ")).toBe("Freightliner Cascadia");
    expect(descriptor("x".repeat(60))).toHaveLength(40);
    expect(descriptor("   ")).toBeNull();
  });

  it("keeps the month, never the day", () => {
    expect(monthOf("2026-10-14")).toBe("2026-10-01");
    expect(monthOf(new Date("2026-03-31T23:00:00Z"))).toBe("2026-03-01");
  });
});
