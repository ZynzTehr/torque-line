import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/shell/SignOutButton";
import { LOGIN_URL } from "@/lib/auth/routes";
import { BRAND } from "@/lib/brand";
import { currentFleetAnyStatus } from "@/server/fleet";

export const metadata: Metadata = { title: "Account paused" };

export default function AccountPausedPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <section className="card w-full max-w-md" aria-labelledby="paused-title">
        <Suspense fallback={<p className="text-secondary">Loading…</p>}>
          <PausedMessage />
        </Suspense>
      </section>
    </main>
  );
}

async function PausedMessage() {
  const fleet = await currentFleetAnyStatus();
  if (!fleet) redirect(LOGIN_URL);
  if (fleet.status === "active") {
    return (
      <>
        <h1 id="paused-title" className="mb-2">Your account is active</h1>
        <p className="text-secondary mb-6 text-sm">Nothing is blocking you. Head back to your fleet.</p>
        <Link className="btn btn-primary" href="/dashboard">Open dashboard</Link>
      </>
    );
  }
  return (
    <>
      <h1 id="paused-title" className="mb-2">Your account is paused</h1>
      <p className="text-secondary mb-2 text-sm">
        {BRAND.name} access for <strong className="text-fg">{fleet.user.email}</strong> is turned off right now, usually because of billing.
      </p>
      <p className="text-secondary mb-6 text-sm">Your fleet&apos;s records are kept safe and come back as soon as the account is reactivated. Contact the {BRAND.name} team to sort it out.</p>
      <SignOutButton className="btn btn-secondary" />
    </>
  );
}
