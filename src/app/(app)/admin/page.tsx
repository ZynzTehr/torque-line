import { Suspense } from "react";
import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { FleetStatusControl } from "@/components/admin/FleetStatusControl";
import { listFleetsForAdmin, type AdminFleetRow } from "@/server/adminStore";
import { requireAdmin } from "@/server/fleet";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <>
      <header className="page-header"><h2>Platform admin</h2></header>
      <div className="page-body">
        <Suspense fallback={<p className="text-secondary">Loading accounts…</p>}>
          <AdminBoard />
        </Suspense>
      </div>
    </>
  );
}

/** Accounts in Neon Auth, including people who signed up but never opened the app. Null where the schema is absent. */
async function countAuthAccounts(): Promise<number | null> {
  try {
    const r = await getDb().execute(sql`select count(*)::int as n from neon_auth."user"`);
    return Number((r.rows[0] as { n: number }).n);
  } catch {
    return null;
  }
}

const fmtDate = (d: Date | null) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never";

async function AdminBoard() {
  const { userId } = await requireAdmin();
  const [rows, accounts] = await Promise.all([listFleetsForAdmin(getDb()), countAuthAccounts()]);
  const active7d = rows.filter((r) => r.seenLast7d).length;
  const inactive = rows.filter((r) => r.status === "inactive").length;
  const stats = [
    { label: "Accounts", value: accounts ?? rows.length, sub: "signed up" },
    { label: "Fleets", value: rows.length, sub: `${rows.length - inactive} active` },
    { label: "Deactivated", value: inactive, sub: "can't use the app" },
    { label: "Active this week", value: active7d, sub: "opened the app in 7 days" },
  ];

  return (
    <>
      <div className="stat-grid mb-6">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>
      <section aria-labelledby="accounts-title">
        <h3 id="accounts-title" className="mb-3">Accounts</h3>
        {rows.length === 0 ? <p className="text-secondary">No fleets yet.</p> : (
          <ul className="flex flex-col gap-2" aria-label="Accounts">
            {rows.map((r) => <AccountRow key={r.fleetId} row={r} isSelf={r.ownerUserId === userId} />)}
          </ul>
        )}
      </section>
    </>
  );
}

function AccountRow({ row, isSelf }: { row: AdminFleetRow; isSelf: boolean }) {
  return (
    <li className="card !p-3" data-testid="admin-account">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{row.ownerEmail ?? "Unknown email"}</span>
            <span className={`badge ${row.status === "active" ? "badge-green" : "badge-red"}`}>{row.status === "active" ? "Active" : "Inactive"}</span>
            {row.account?.state === "closed" && <span className="badge badge-yellow">Closed by owner</span>}
            {row.account?.state === "deletion_scheduled" && <span className="badge badge-red">Deletes {fmtDate(row.account.purgeAfter)}</span>}
            {isSelf && <span className="badge badge-neutral">You</span>}
          </div>
          <div className="text-secondary mt-1 text-xs">
            {row.fleetName} · joined {fmtDate(row.createdAt)} · last seen {fmtDate(row.lastSeenAt)} · {row.unitCount} {row.unitCount === 1 ? "unit" : "units"} · {row.aiRequests30d} AI requests in 30 days
          </div>
          {row.status === "inactive" && row.statusNote && <div className="text-danger mt-1 text-xs">Note: {row.statusNote}</div>}
        </div>
        {!isSelf && <FleetStatusControl fleetId={row.fleetId} email={row.ownerEmail ?? "this account"} status={row.status} />}
      </div>
    </li>
  );
}
