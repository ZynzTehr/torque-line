import { Suspense } from "react";
import type { Metadata } from "next";
import { getDb } from "@/db";
import { formatCurrency, formatDate } from "@/domain/format";
import { AddFuelStopButton } from "@/components/fleet/AddFuelStopSheet";
import { FuelStopRow } from "@/components/fleet/FuelStopRow";
import { listEquipment } from "@/server/equipmentStore";
import { requireFleet } from "@/server/fleet";
import { fleetFuelSpend, listFuelStops } from "@/server/fuelStore";

export const metadata: Metadata = { title: "Fuel" };
const PRODUCT = { diesel: "Diesel", def: "DEF", reefer: "Reefer" } as const;

export default function FuelPage() {
  return (
    <>
      <header className="page-header"><h2>Fuel</h2></header>
      <div className="page-body max-w-4xl">
        <Suspense fallback={<p className="text-secondary">Loading fuel stops…</p>}><Fuel /></Suspense>
      </div>
    </>
  );
}

async function Fuel() {
  const { fleetId } = await requireFleet();
  const db = getDb();
  const [units, stops, spend] = await Promise.all([listEquipment(db, fleetId), listFuelStops(db, fleetId), fleetFuelSpend(db, fleetId)]);
  const pick = (t: string) => units.filter((u) => u.type === t).map((u) => ({ id: u.id, unitNumber: u.unitNumber }));
  return (
    <section aria-labelledby="stops-title">
      <div className="section-heading">
        <div><span className="section-eyebrow">Fuel spend {formatCurrency(spend)}</span><h3 id="stops-title">Fuel stops</h3></div>
        <AddFuelStopButton tractors={pick("tractor")} reefers={pick("reefer")} />
      </div>
      {stops.length === 0 ? <p className="text-secondary text-sm">No fuel stops yet. Add one from a receipt.</p> : (
        <ul className="flex flex-col gap-2">
          {stops.map((s) => (
            <li key={s.id} className="card !p-2 md:!p-3">
              <FuelStopRow id={s.id} label={`Fuel stop ${formatDate(s.date)}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
                  <span className="min-w-0">
                    <strong className="block text-sm">{formatDate(s.date)}{s.station ? ` · ${s.station}` : ""}</strong>
                    <span className="text-secondary text-xs">{s.lines.map((l) => `${PRODUCT[l.product]} ${l.unitNumber} ${formatCurrency(l.subtotal)}`).join(" · ")}</span>
                  </span>
                  <span className="font-mono text-sm">{formatCurrency(s.total)}</span>
                </div>
              </FuelStopRow>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
