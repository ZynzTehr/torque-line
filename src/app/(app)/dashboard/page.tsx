import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { formatCurrency, getStalenessClass, getStalenessLabel } from "@/domain/format";
import { equipmentReading } from "@/domain/maintenance";
import { buildWorkboard } from "@/domain/workboard";
import { AddEquipmentButton, ApplyScheduleButton, UnitActions } from "@/components/fleet/UnitActions";
import { listEquipment } from "@/server/equipmentStore";
import { requireFleet } from "@/server/fleet";
import { toBoardEquipment, toBoardSchedule } from "@/server/fleetView";
import { listFleetSchedules } from "@/server/scheduleStore";
import { fleetServiceSpend } from "@/server/serviceStore";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <>
      <header className="page-header workboard-header">
        <h2>Fleet workboard</h2>
      </header>
      <div className="page-body workboard">
        <Suspense fallback={<p className="text-secondary">Loading your fleet…</p>}>
          <Workboard />
        </Suspense>
      </div>
    </>
  );
}

async function Workboard() {
  const { fleetId } = await requireFleet();
  const db = getDb();
  const [equipmentRows, scheduleRows, spend] = await Promise.all([
    listEquipment(db, fleetId), listFleetSchedules(db, fleetId), fleetServiceSpend(db, fleetId),
  ]);
  const units = equipmentRows.map(toBoardEquipment);
  const schedules = scheduleRows.map(toBoardSchedule);
  const board = buildWorkboard(units, schedules);
  const hasAttention = board.attention.length + board.noSchedule.length + board.stale.length > 0;

  if (!units.length) {
    return (
      <section className="workboard-welcome">
        <span className="section-eyebrow">Your fleet starts here</span>
        <h3>Add your first unit.</h3>
        <p>Start with a truck, trailer, or reefer. Then record its last service so the next due date has a useful starting point.</p>
        <AddEquipmentButton label="Add equipment" primary />
      </section>
    );
  }

  return (
    <>
      <dl className="fleet-summary" aria-label="Fleet summary">
        <div><dt>Units</dt><dd>{board.counts.units}</dd></div>
        <div><dt>Overdue services</dt><dd className={board.counts.overdue ? "text-red" : ""}>{board.counts.overdue}</dd></div>
        <div><dt>Due soon</dt><dd className={board.counts.dueSoon ? "text-yellow" : ""}>{board.counts.dueSoon}</dd></div>
        <div><dt>Service spend</dt><dd>{spend > 0 ? formatCurrency(spend) : "$0"}</dd></div>
      </dl>

      <section className="workboard-section" aria-labelledby="attention-title">
        <div className="section-heading">
          <div><span className="section-eyebrow">Service &amp; follow-up</span><h3 id="attention-title">Needs attention</h3></div>
          <span className="text-secondary text-sm">{hasAttention ? "Overdue services first" : "Nothing due right now"}</span>
        </div>
        <div className="attention-list">
          {board.attention.map(({ equipment: eq, schedule, status, reason }) => (
            <div key={schedule.id} className="attention-row max-md:!grid-cols-[3px_1fr] max-md:!gap-y-2">
              <span className={`attention-marker ${status === "overdue" ? "is-overdue" : status === "due-soon" ? "is-due" : ""}`} aria-hidden="true" />
              <Link className="unit-link" href={`/equipment/${eq.id}`}>Unit {eq.unitNumber}</Link>
              <div className="attention-description max-md:col-start-2">
                <strong>{schedule.name}</strong>
                <span className={status === "overdue" ? "text-red" : "text-secondary"}>{reason}</span>
              </div>
              <div className="max-md:col-start-2"><UnitActions unit={eq} schedules={schedules} scheduleId={schedule.id} show={["service"]} /></div>
            </div>
          ))}
          {board.noSchedule.map((eq) => (
            <div key={`ns-${eq.id}`} className="attention-row max-md:!grid-cols-[3px_1fr] max-md:!gap-y-2">
              <span className="attention-marker" aria-hidden="true" />
              <Link className="unit-link" href={`/equipment/${eq.id}`}>Unit {eq.unitNumber}</Link>
              <div className="attention-description max-md:col-start-2"><strong>No schedule set</strong><span className="text-secondary">Add a schedule to start tracking service.</span></div>
              <div className="max-md:col-start-2"><ApplyScheduleButton equipmentId={eq.id} /></div>
            </div>
          ))}
          {board.stale.map((eq) => (
            <div key={`st-${eq.id}`} className="attention-row max-md:!grid-cols-[3px_1fr] max-md:!gap-y-2">
              <span className="attention-marker" aria-hidden="true" />
              <Link className="unit-link" href={`/equipment/${eq.id}`}>Unit {eq.unitNumber}</Link>
              <div className="attention-description max-md:col-start-2">
                <strong>{eq.type === "reefer" ? "Hour meter" : "Mileage"} needs an update</strong>
                <span className="text-secondary">{getStalenessLabel(eq.readingUpdatedAt)}. Confirm the latest reading.</span>
              </div>
              <div className="max-md:col-start-2"><UnitActions unit={eq} schedules={schedules} show={["reading"]} /></div>
            </div>
          ))}
          {!hasAttention && <p className="workboard-clear">No services are due based on the saved schedules and readings.</p>}
        </div>
      </section>

      <section className="workboard-section" aria-labelledby="fleet-title">
        <div className="section-heading">
          <div><span className="section-eyebrow">Equipment register</span><h3 id="fleet-title">Your fleet</h3></div>
          <AddEquipmentButton />
        </div>
        <div className="fleet-register-wrap" tabIndex={0} role="region" aria-label="Fleet equipment table" data-no-swipe>
          <table className="fleet-register">
            <thead><tr><th>Unit</th><th>Equipment</th><th>Latest reading</th><th>Maintenance</th><th><span className="sr-only">Details</span></th></tr></thead>
            <tbody>
              {board.register.map(({ equipment: eq, status }) => (
                <tr key={eq.id}>
                  <td><Link className="unit-link unit-identity" href={`/equipment/${eq.id}`}><strong>{eq.unitNumber}</strong></Link></td>
                  <td>
                    <strong>{[eq.year, eq.make, eq.model].filter(Boolean).join(" ") || eq.type}</strong>
                    <span className="register-sub">{eq.type === "reefer" ? "Refrigeration unit" : eq.type === "trailer" ? "Trailer" : "Tractor"}</span>
                  </td>
                  <td>
                    <span className="reading-value">{equipmentReading(eq)}</span>
                    {eq.type !== "trailer" && (
                      <span className={`staleness ${getStalenessClass(eq.readingUpdatedAt)}`}><span className="staleness-dot" />{getStalenessLabel(eq.readingUpdatedAt)}</span>
                    )}
                  </td>
                  <td><span className={`badge ${status.className}`}>{status.label}</span></td>
                  <td><Link className="btn btn-ghost btn-sm" href={`/equipment/${eq.id}`} aria-label={`Open unit ${eq.unitNumber}`}>View →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
