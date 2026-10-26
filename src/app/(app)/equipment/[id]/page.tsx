import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { formatCurrency, formatDate, formatMileage, getStalenessLabel } from "@/domain/format";
import { equipmentReading, serviceStatus } from "@/domain/maintenance";
import { ApplyScheduleButton, UnitActions } from "@/components/fleet/UnitActions";
import { ScheduleItemRow } from "@/components/fleet/ScheduleItemActions";
import { SuggestIntervals } from "@/components/fleet/SuggestIntervals";
import { getEquipment } from "@/server/equipmentStore";
import { requireFleet } from "@/server/fleet";
import { toBoardEquipment, toBoardSchedule } from "@/server/fleetView";
import { listSchedules } from "@/server/scheduleStore";
import { listServiceRecords } from "@/server/serviceStore";

export const metadata: Metadata = { title: "Unit" };

export default function UnitPage({ params }: PageProps<"/equipment/[id]">) {
  return (
    <div className="page-body">
      <Link href="/equipment" className="text-secondary mb-3 inline-block text-sm">← All equipment</Link>
      <Suspense fallback={<p className="text-secondary">Loading unit…</p>}>
        <UnitDetail params={params} />
      </Suspense>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  overdue: "badge-red", "due-soon": "badge-yellow", ok: "badge-green", unknown: "badge-neutral", disabled: "badge-neutral",
};

async function UnitDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { fleetId } = await requireFleet();
  const db = getDb();
  const row = await getEquipment(db, fleetId, id);
  if (!row) notFound();
  const [scheduleRows, records] = await Promise.all([listSchedules(db, fleetId, id), listServiceRecords(db, fleetId, id)]);
  const unit = toBoardEquipment(row);
  const schedules = scheduleRows.map(toBoardSchedule);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="section-eyebrow">{unit.type === "reefer" ? "Refrigeration unit" : unit.type === "trailer" ? "Trailer" : "Tractor"}</span>
          <h1 className="font-mono">Unit {unit.unitNumber}</h1>
          <p className="text-secondary text-sm">{[row.year, row.make, row.model, row.engineSize].filter(Boolean).join(" · ") || "No details yet"}</p>
          <p className="mt-1 text-sm"><strong>{equipmentReading(unit)}</strong>{unit.type !== "trailer" && <span className="text-secondary"> · {getStalenessLabel(unit.readingUpdatedAt)}</span>}</p>
        </div>
        <UnitActions unit={unit} schedules={schedules} size="md" />
      </header>

      <section className="workboard-section" aria-labelledby="pm-title">
        <div className="section-heading">
          <div><span className="section-eyebrow">Preventive maintenance</span><h3 id="pm-title">Schedule</h3></div>
          <SuggestIntervals equipmentId={unit.id} />
        </div>
        {schedules.length === 0 ? (
          <div className="card flex flex-wrap items-center justify-between gap-3">
            <p className="text-secondary text-sm">No schedule yet. Start from the standard schedule for this unit type.</p>
            <ApplyScheduleButton equipmentId={unit.id} />
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {schedules.map((s) => {
              const st = serviceStatus({ ...s, timeInterval: s.timeIntervalDays }, unit);
              return (
                <li key={s.id} className={`card !p-2 md:!p-3${s.enabled ? "" : " opacity-60"}`}>
                  <ScheduleItemRow unit={unit} schedules={schedules} item={s}>
                    <div className="flex min-w-0 items-center gap-3 px-1">
                      <span className="text-secondary w-12 shrink-0 text-xs font-semibold">{s.category}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{s.name}</span>
                        <span className="text-secondary block truncate text-xs">
                          Every {[s.mileageInterval && `${formatMileage(s.mileageInterval)} mi`, s.timeIntervalDays && `${s.timeIntervalDays} days`].filter(Boolean).join(" or ")}
                          {s.lastServiceDate ? ` · last ${formatDate(s.lastServiceDate)}` : " · no service logged"}
                        </span>
                      </span>
                      <span className={`badge ${STATUS_BADGE[st.status]} shrink-0`}>{st.status === "disabled" ? "Paused" : st.reason}</span>
                    </div>
                  </ScheduleItemRow>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="workboard-section" aria-labelledby="history-title">
        <div className="section-heading"><div><span className="section-eyebrow">History</span><h3 id="history-title">Service records</h3></div></div>
        {records.length === 0 ? <p className="text-secondary text-sm">No services logged yet.</p> : (
          <ul className="attention-list">
            {records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0">
                <span className="min-w-0">
                  <strong className="block text-sm">{r.serviceType}</strong>
                  <span className="text-secondary text-xs">
                    {formatDate(r.date)}{r.mileage != null ? ` · ${formatMileage(r.mileage)} mi` : ""}{r.hours != null ? ` · ${formatMileage(r.hours)} hrs` : ""}{r.shop ? ` · ${r.shop}` : ""}
                  </span>
                </span>
                {r.cost != null && <span className="font-mono text-sm">{formatCurrency(r.cost)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
