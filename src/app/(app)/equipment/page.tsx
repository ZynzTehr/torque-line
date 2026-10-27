import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { getStalenessLabel } from "@/domain/format";
import { equipmentReading } from "@/domain/maintenance";
import { buildWorkboard } from "@/domain/workboard";
import { AddEquipmentButton, UnitRow } from "@/components/fleet/UnitActions";
import { listEquipment } from "@/server/equipmentStore";
import { requireFleet } from "@/server/fleet";
import { toBoardEquipment, toBoardSchedule } from "@/server/fleetView";
import { listFleetSchedules } from "@/server/scheduleStore";

export const metadata: Metadata = { title: "Equipment" };

export default function EquipmentPage() {
  return (
    <>
      <header className="page-header"><h2>Equipment</h2></header>
      <div className="page-body">
        <Suspense fallback={<p className="text-secondary">Loading units…</p>}><EquipmentList /></Suspense>
      </div>
    </>
  );
}

async function EquipmentList() {
  const { fleetId } = await requireFleet();
  const db = getDb();
  const [rows, scheduleRows] = await Promise.all([listEquipment(db, fleetId), listFleetSchedules(db, fleetId)]);
  const units = rows.map(toBoardEquipment);
  const schedules = scheduleRows.map(toBoardSchedule);
  const statusById = new Map(buildWorkboard(units, schedules).register.map((r) => [r.equipment.id, r.status]));

  return (
    <section aria-labelledby="units-title">
      <div className="section-heading">
        <div><span className="section-eyebrow">{units.length} active {units.length === 1 ? "unit" : "units"}</span><h3 id="units-title">Your units</h3></div>
        <AddEquipmentButton />
      </div>
      {units.length === 0 ? (
        <p className="text-secondary">No units yet. Add a tractor, trailer, or reefer to start tracking service.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Units">
          {units.map((u) => {
            const status = statusById.get(u.id)!;
            return (
              <li key={u.id} className="card !p-2 md:!p-3">
                <UnitRow unit={u} schedules={schedules}>
                  <Link href={`/equipment/${u.id}`} className="flex min-w-0 items-center gap-3 px-1 py-1">
                    <span className="font-mono text-lg font-bold">{u.unitNumber}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{[u.year, u.make, u.model].filter(Boolean).join(" ") || u.type}</span>
                      <span className="text-secondary block truncate text-xs">
                        {equipmentReading(u)}{u.type !== "trailer" ? ` · ${getStalenessLabel(u.readingUpdatedAt)}` : ""}
                      </span>
                    </span>
                    <span className={`badge ${status.className} shrink-0`}>{status.label}</span>
                  </Link>
                </UnitRow>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
