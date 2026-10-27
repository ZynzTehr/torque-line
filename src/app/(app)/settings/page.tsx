import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { GearStyleSwitcher } from "@/components/shell/GearStyleSwitcher";
import { SignOutButton } from "@/components/shell/SignOutButton";
import Link from "next/link";
import { getDb } from "@/db";
import { getSessionUser, LOGIN_URL } from "@/lib/auth/server";
import { isPlatformAdmin } from "@/server/adminStore";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <>
      <header className="page-header"><h2>Settings</h2></header>
      <div className="page-body">
        <section className="card max-w-md" aria-labelledby="account-heading">
          <h3 id="account-heading" className="mb-2">Account</h3>
          <Suspense fallback={<p className="text-secondary mb-4 text-sm">Loading…</p>}>
            <SignedInAs />
          </Suspense>
          <SignOutButton className="btn btn-secondary" />
        </section>
        <section className="card mt-4 max-w-md" aria-labelledby="appearance-heading">
          <h3 id="appearance-heading" className="mb-2">Gear style</h3>
          <p className="text-secondary mb-3 text-sm">The finish of the gears behind every page. Light and dark themes are in the sidebar.</p>
          <GearStyleSwitcher />
        </section>
        <Suspense fallback={null}>
          <AdminLink />
        </Suspense>
      </div>
    </>
  );
}

async function SignedInAs() {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_URL);
  return <p className="text-secondary mb-4 text-sm">Signed in as <strong className="text-fg">{user.email}</strong></p>;
}

/** Shown only to platform admins. */
async function AdminLink() {
  await connection();
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(getDb(), user.id))) return null;
  return (
    <section className="card mt-4 max-w-md" aria-labelledby="admin-heading">
      <h3 id="admin-heading" className="mb-2">Platform admin</h3>
      <p className="text-secondary mb-4 text-sm">See every account and turn access on or off.</p>
      <Link className="btn btn-primary" href="/admin">Open admin</Link>
    </section>
  );
}
