import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReopenAccountButton } from "@/components/auth/ReopenAccountButton";
import { SignOutButton } from "@/components/shell/SignOutButton";
import { LOGIN_URL, PAUSED_URL } from "@/lib/auth/routes";
import { BRAND } from "@/lib/brand";
import { currentFleetAnyStatus } from "@/server/fleet";

export const metadata: Metadata = { title: "Account closed" };

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function AccountClosedPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <section className="card w-full max-w-md" aria-labelledby="closed-title">
        <Suspense fallback={<p className="text-secondary">Loading…</p>}>
          <ClosedMessage />
        </Suspense>
      </section>
    </main>
  );
}

async function ClosedMessage() {
  const fleet = await currentFleetAnyStatus();
  if (!fleet) redirect(LOGIN_URL);
  if (!fleet.account) redirect(fleet.status === "active" ? "/dashboard" : PAUSED_URL);
  const paused = fleet.status !== "active";
  const pausedNote = paused && (
    <p className="text-secondary mb-6 text-sm">The {BRAND.name} team has also paused this account, so it stays paused after you reopen it.</p>
  );
  const who = <strong className="text-fg">{fleet.user.email}</strong>;

  if (fleet.account.state === "closed") {
    return (
      <>
        <h1 id="closed-title" className="mb-2">Your account is closed</h1>
        <p className="text-secondary mb-6 text-sm">The account for {who} is closed. Your fleet&apos;s records are all still here: reopen it to pick up where you left off.</p>
        {pausedNote}
        <div className="flex flex-wrap gap-2">
          <ReopenAccountButton label="Reopen account" />
          <SignOutButton className="btn btn-secondary" />
        </div>
      </>
    );
  }
  return (
    <>
      <h1 id="closed-title" className="mb-2">Your account will be deleted</h1>
      <p className="text-secondary mb-2 text-sm">
        The account for {who} and all its data will be erased for good on <strong className="text-fg">{fmtDate(fleet.account.purgeAfter)}</strong>.
      </p>
      <p className="text-secondary mb-6 text-sm">Changed your mind? Restore the account and nothing is lost.</p>
      {pausedNote}
      <div className="flex flex-wrap gap-2">
        <ReopenAccountButton label="Restore my account" />
        {/* No `download` attribute: the route's Content-Disposition saves the zip. A paused account can't export. */}
        {!paused && <a className="btn btn-secondary" href="/api/export">Download my data</a>}
        <SignOutButton className="btn btn-ghost" />
      </div>
    </>
  );
}
