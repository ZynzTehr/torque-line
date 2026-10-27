import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { formatCurrency, formatDate } from "@/domain/format";
import { AddFuelStopButton } from "@/components/fleet/AddFuelStopSheet";
import { FuelStopRow } from "@/components/fleet/FuelStopRow";
import { latestAttachmentIds } from "@/server/attachmentsStore";
import { listEquipment } from "@/server/equipmentStore";
import { requireFleet } from "@/server/fleet";
import { fuelSpendByProduct, fuelYears, listFuelStops, type FuelFilter } from "@/server/fuelStore";

export const metadata: Metadata = { title: "Fuel" };
const PRODUCT = { diesel: "Diesel", def: "DEF", reefer: "Reefer" } as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PAGE = 50;

export default function FuelPage({ searchParams }: PageProps<"/fuel">) {
  return (
    <>
      <header className="page-header"><h2>Fuel</h2></header>
      <div className="page-body max-w-4xl">
        <Suspense fallback={<p className="text-secondary">Loading fuel stops…</p>}><Fuel searchParams={searchParams} /></Suspense>
      </div>
    </>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const gallons = (g: number | null) => (g == null ? null : `${g.toLocaleString("en-US", { maximumFractionDigits: 3 })} gal`);

async function Fuel({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const year = Number(one(params.year)) || undefined;
  const month = Number(one(params.month)) || undefined;
  const filter: FuelFilter = { equipmentId: one(params.unit), year, month: month && month >= 1 && month <= 12 ? month : undefined, date: one(params.date) };
  const limit = Math.min(Number(one(params.limit)) || PAGE, 1000);
  const { fleetId } = await requireFleet();
  const db = getDb();
  const [units, stops, spend, years] = await Promise.all([
    listEquipment(db, fleetId), listFuelStops(db, fleetId, { ...filter, limit: limit + 1 }), fuelSpendByProduct(db, fleetId, filter), fuelYears(db, fleetId),
  ]);
  const more = stops.length > limit;
  const shown = stops.slice(0, limit);
  const receipts = await latestAttachmentIds(db, fleetId, "fuel_receipt", shown.map((s) => s.id));
  const pick = (t: string) => units.filter((u) => u.type === t).map((u) => ({ id: u.id, unitNumber: u.unitNumber }));
  const tractors = pick("tractor");
  const reefers = pick("reefer");
  const filtered = Boolean(filter.equipmentId || filter.year || filter.month || filter.date);
  const active = Object.fromEntries(Object.entries({ unit: filter.equipmentId, year: filter.year, month: filter.month, date: filter.date }).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
  const moreHref = `/fuel?${new URLSearchParams({ ...active, limit: String(limit + PAGE) })}`;

  if (!tractors.length && !reefers.length && !stops.length && !filtered) {
    return (
      <div className="card">
        <p className="text-secondary text-sm">Add a tractor or reefer to start tracking fuel. <Link href="/equipment" className="text-accent">Go to equipment</Link></p>
      </div>
    );
  }

  return (
    <section aria-labelledby="stops-title">
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Diesel", spend.diesel], ["DEF", spend.def], ["Reefer fuel", spend.reefer], ["Total", spend.total]] as const).map(([label, value]) => (
          <div key={label} className="card !p-3">
            <dt className="section-eyebrow">{label}</dt>
            <dd className={`font-mono ${label === "Total" ? "text-lg font-semibold" : ""}`}>{formatCurrency(value)}</dd>
          </div>
        ))}
      </dl>

      {(filtered || stops.length > 0) && (
        <form className="card mb-4 grid grid-cols-2 gap-3 md:grid-cols-[1.2fr_1fr_1fr_1.2fr_auto] md:items-end" method="get" role="search" aria-label="Filter fuel stops">
          <div className="form-group col-span-2 md:col-span-1">
            <label className="form-label" htmlFor="f-unit">Unit</label>
            <select id="f-unit" name="unit" className="form-select" defaultValue={filter.equipmentId ?? ""}>
              <option value="">All units</option>
              {[...tractors, ...reefers].map((u) => <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="f-year">Year</label>
            <select id="f-year" name="year" className="form-select" defaultValue={filter.year ?? ""}>
              <option value="">Any</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="f-month">Month</label>
            <select id="f-month" name="month" className="form-select" defaultValue={filter.month ?? ""}>
              <option value="">Any</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="form-group col-span-2 md:col-span-1">
            <label className="form-label" htmlFor="f-date">Specific date</label>
            <input id="f-date" name="date" type="date" className="form-input" defaultValue={filter.date} />
          </div>
          <div className="col-span-2 flex gap-2 md:col-span-1">
            <button type="submit" className="btn btn-secondary btn-sm">Filter</button>
            {filtered && <Link href="/fuel" className="btn btn-ghost btn-sm">Clear filters</Link>}
          </div>
        </form>
      )}

      <div className="section-heading">
        <div><span className="section-eyebrow">{shown.length} {shown.length === 1 ? "stop" : "stops"}{more ? " shown so far" : ""}</span><h3 id="stops-title">{filtered ? "Matching fuel stops" : "Fuel stops"}</h3></div>
        <AddFuelStopButton tractors={tractors} reefers={reefers} />
      </div>
      {shown.length === 0 ? (
        <p className="text-secondary text-sm">
          {filtered ? <>No fuel stops match these filters. <Link href="/fuel" className="text-accent">Clear filters</Link></> : "No fuel stops yet. Add one from a receipt."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((s) => (
            <li key={s.id} className="card !p-2 md:!p-3">
              <FuelStopRow total={s.total} editable={s.lines.every((l) => !l.unitRemoved)} tractors={tractors} reefers={reefers}
                stop={{ id: s.id, date: s.date, station: s.station, notes: s.notes, receiptId: receipts.get(s.id) ?? null,
                  lines: s.lines.map((l) => ({ equipmentId: l.equipmentId, product: l.product, gallons: l.gallons, pricePerGallon: l.pricePerGallon, subtotal: l.subtotal, odometer: l.odometer, hours: l.hours })) }}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
                  <span className="min-w-0">
                    <strong className="block text-sm">{formatDate(s.date)}{s.station ? ` · ${s.station}` : ""}</strong>
                    {s.lines.map((l) => (
                      <span key={l.product} className="text-secondary block text-xs">
                        {[`${PRODUCT[l.product]} · Unit ${l.unitNumber}${l.unitRemoved ? " (removed)" : ""}`, gallons(l.gallons),
                          l.pricePerGallon != null ? `${formatCurrency(l.pricePerGallon)}/gal` : null, formatCurrency(l.subtotal)].filter(Boolean).join(" · ")}
                      </span>
                    ))}
                    {s.notes && <span className="text-secondary mt-0.5 line-clamp-2 block text-xs">{s.notes}</span>}
                  </span>
                  <span className="font-mono text-sm">{formatCurrency(s.total)}</span>
                </div>
              </FuelStopRow>
            </li>
          ))}
        </ul>
      )}
      {more && <Link href={moreHref} className="btn btn-secondary btn-sm mt-4" scroll={false}>Show more</Link>}
    </section>
  );
}
