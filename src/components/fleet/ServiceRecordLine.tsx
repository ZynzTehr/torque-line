import { formatCurrency, formatDate, formatMileage } from "@/domain/format";

/** The text of one service record: what, when, at what reading, where, cost, and notes. */
export function ServiceRecordLine({ record: r, unitLabel }: {
  record: { serviceType: string; date: string; mileage: number | null; hours: number | null; shop: string | null; cost: number | null; notes: string | null };
  unitLabel?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1">
      <span className="min-w-0">
        <strong className="block text-sm">{unitLabel}{unitLabel && " · "}{r.serviceType}</strong>
        <span className="text-secondary text-xs">
          {formatDate(r.date)}{r.mileage != null ? ` · ${formatMileage(r.mileage)} mi` : ""}{r.hours != null ? ` · ${formatMileage(r.hours)} hrs` : ""}{r.shop ? ` · ${r.shop}` : ""}
        </span>
        {r.notes && <span className="text-secondary mt-0.5 line-clamp-2 block text-xs">{r.notes}</span>}
      </span>
      {r.cost != null && <span className="font-mono text-sm">{formatCurrency(r.cost)}</span>}
    </div>
  );
}
