// The two renderUnitCosts tests from ZynzTehr/fleet-pulse@88e9f01 tests/fuel.test.js, against the React component.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { UnitCosts } from "@/components/fleet/UnitCosts";
import { unitCosts } from "@/domain/fuel";

const truck = { id: 1, unitNumber: "101", type: "tractor" as const, currentMileage: 500000 };
const entry = { equipmentId: 1, fuelType: "diesel", date: "2026-09-30", totalCost: 450.5, odometer: 499000, receiptImage: "SECRET-RECEIPT" };
const html = (type: "tractor" | "trailer" | "reefer", costs: ReturnType<typeof unitCosts>) => renderToStaticMarkup(createElement(UnitCosts, { type, costs }));

describe("UnitCosts", () => {
  it("shows unit fuel totals without displaying receipts", () => {
    const out = html("tractor", unitCosts(truck, [], [entry]));
    expect(out).toContain("Fuel spend");
    expect(out).toContain("$450.50");
    expect(out).toContain("Cost per mile");
    expect(out).not.toContain("SECRET-RECEIPT");
  });

  it("omits fuel spend from regular trailers but includes it for reefer trailers", () => {
    const serviceRecord = { date: "2026-09-01", cost: 150 };
    const trailerHtml = html("trailer", unitCosts({ id: 3, unitNumber: "T", type: "trailer" }, [serviceRecord], []));
    expect(trailerHtml).toContain("Service spend");
    expect(trailerHtml).toContain("$150.00");
    expect(trailerHtml).toContain("Total spend");
    expect(trailerHtml).not.toContain("Fuel spend");
    expect(trailerHtml).not.toContain("Cost per mile");
    expect(trailerHtml).not.toContain("Cost per hour");

    const reefer = { id: 4, unitNumber: "R", type: "reefer" as const, currentHours: 8500 };
    const reeferHtml = html("reefer", unitCosts(reefer, [serviceRecord], [{ ...entry, equipmentId: 4, fuelType: "reefer", totalCost: 120, hours: 8400 }]));
    expect(reeferHtml).toContain("Service spend");
    expect(reeferHtml).toContain("Fuel spend");
    expect(reeferHtml).toContain("$120.00");
    expect(reeferHtml).toContain("Cost per hour");
  });
});
