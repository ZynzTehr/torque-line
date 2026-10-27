import type { ReactNode } from "react";

/** The centered card the password and verification pages share with the sign-in form. */
export function AuthCard({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <section className="card w-full max-w-sm" aria-labelledby="auth-card-title">
        <h1 id="auth-card-title" className="mb-1">{title}</h1>
        {lead && <p className="text-secondary mb-6 text-sm">{lead}</p>}
        {children}
      </section>
    </main>
  );
}
