import { formatCurrency, formatMileage } from "@/domain/format";
import type { UnitCosts as Costs } from "@/domain/fuel";
import type { EquipmentType } from "@/domain/types";

/**
 * Spend panel for one unit. Ported from FleetPulse renderUnitCosts: trailers show service spend only;
 * tractors show cost per mile and reefers cost per hour, over tracked distance, never lifetime mileage.
 * Receipt images are never rendered here.
 */
export function UnitCosts({ type, costs }: { type: EquipmentType; costs: Costs }) {
  const showFuel = type !== "trailer";
  const rateLabel = type === "reefer" ? "Cost per hour" : "Cost per mile";
  const unit = type === "reefer" ? "hrs" : "mi";
  return (
    <dl className="fleet-summary" aria-label="Unit spending">
      <div><dt>Service spend</dt><dd>{formatCurrency(costs.serviceSpend)}</dd></div>
      {showFuel && <div><dt>Fuel spend</dt><dd>{formatCurrency(costs.fuelSpend)}</dd></div>}
      <div><dt>Total spend</dt><dd>{formatCurrency(costs.totalSpend)}</dd></div>
      {showFuel && (
        <div>
          <dt>{rateLabel}</dt>
          <dd>{costs.rate != null ? formatCurrency(costs.rate) : "Not enough readings"}</dd>
          {costs.rate != null && <span className="text-secondary text-xs">over {formatMileage(costs.distance)} {unit} tracked</span>}
        </div>
      )}
    </dl>
  );
}
