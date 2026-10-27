import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { formatCurrency } from "@/domain/format";
import { ServiceRecordItem } from "@/components/fleet/ServiceRecordItem";
import { ServiceRecordLine } from "@/components/fleet/ServiceRecordLine";
import { latestAttachmentIds } from "@/server/attachmentsStore";
import { listEquipment } from "@/server/equipmentStore";
import { requireFleet } from "@/server/fleet";
import { toBoardEquipment, toBoardSchedule } from "@/server/fleetView";
import { listFleetSchedules } from "@/server/scheduleStore";
import { listFleetServiceRecords } from "@/server/serviceStore";

export const metadata: Metadata = { title: "Service records" };
const PAGE = 100;

export default function RecordsPage({ searchParams }: PageProps<"/records">) {
  return (
    <>
      <header className="page-header"><h2>Service records</h2></header>
      <div className="page-body max-w-4xl">
        <Suspense fallback={<p className="text-secondary">Loading service records…</p>}><Records searchParams={searchParams} /></Suspense>
      </div>
    </>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

async function Records({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filter = { equipmentId: one(params.unit), from: one(params.from), to: one(params.to) };
  const limit = Math.min(Number(one(params.limit)) || PAGE, 1000);
  const { fleetId } = await requireFleet();
  const db = getDb();
  const [units, scheduleRows, records] = await Promise.all([
    listEquipment(db, fleetId), listFleetSchedules(db, fleetId), listFleetServiceRecords(db, fleetId, { ...filter, limit: limit + 1 }),
  ]);
  const more = records.length > limit;
  const shown = records.slice(0, limit);
  const receipts = await latestAttachmentIds(db, fleetId, "service_receipt", shown.map((r) => r.id));
  const board = new Map(units.map((u) => [u.id, toBoardEquipment(u)]));
  const schedules = scheduleRows.map(toBoardSchedule);
  const total = shown.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const filtered = Boolean(filter.equipmentId || filter.from || filter.to);
  const moreHref = `/records?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)), limit: String(limit + PAGE) } as Record<string, string>)}`;

  return (
    <section aria-labelledby="records-title">
      {(filtered || shown.length > 0) && <form className="card mb-4 grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end" method="get" role="search" aria-label="Filter service records">
        <div className="form-group col-span-2 md:col-span-1">
          <label className="form-label" htmlFor="f-unit">Unit</label>
          <select id="f-unit" name="unit" className="form-select" defaultValue={filter.equipmentId ?? ""}>
            <option value="">All units</option>
            {units.map((u) => <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="f-from">From</label>
          <input id="f-from" name="from" type="date" className="form-input" defaultValue={filter.from} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="f-to">To</label>
          <input id="f-to" name="to" type="date" className="form-input" defaultValue={filter.to} />
        </div>
        <div className="col-span-2 flex gap-2 md:col-span-1">
          <button type="submit" className="btn btn-secondary btn-sm">Filter</button>
          {filtered && <Link href="/records" className="btn btn-ghost btn-sm">Clear filters</Link>}
        </div>
      </form>}

      <div className="section-heading">
        <div>
          <span className="section-eyebrow">{shown.length} {shown.length === 1 ? "record" : "records"} · {formatCurrency(total)}{more ? " shown so far" : ""}</span>
          <h3 id="records-title">{filtered ? "Matching services" : "All services, newest first"}</h3>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-secondary text-sm">
          {filtered ? <>No services match these filters. <Link href="/records" className="text-accent">Clear filters</Link></> : "No services logged yet. Log one from a unit's page or the dashboard."}
        </p>
      ) : (
        <ul className="attention-list">
          {shown.map((r) => {
            const unit = board.get(r.equipmentId) ?? null;
            return (
              <li key={r.id} className="border-b border-line px-2 py-2 last:border-b-0">
                <ServiceRecordItem unit={unit} schedules={schedules} record={{ ...r, receiptId: receipts.get(r.id) ?? null }}>
                  <ServiceRecordLine record={r} unitLabel={unit
                    ? <Link href={`/equipment/${r.equipmentId}`} className="text-accent font-mono">Unit {r.unitNumber}</Link>
                    : <span className="font-mono">Unit {r.unitNumber} (removed)</span>} />
                </ServiceRecordItem>
              </li>
            );
          })}
        </ul>
      )}
      {more && <Link href={moreHref} className="btn btn-secondary btn-sm mt-4" scroll={false}>Show more</Link>}
    </section>
  );
}
