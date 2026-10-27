import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SignOutButton } from "@/components/shell/SignOutButton";
import { getSessionUser, LOGIN_URL } from "@/lib/auth/server";

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
