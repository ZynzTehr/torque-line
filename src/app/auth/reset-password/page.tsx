import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Set a new password" };

/** The emailed link lands here as ?token=…, or as ?error=INVALID_TOKEN when the auth service already rejected it. */
export default function ResetPasswordPage({ searchParams }: PageProps<"/auth/reset-password">) {
  return (
    <AuthCard title="Set a new password">
      <Suspense fallback={<p className="text-secondary text-sm">Loading…</p>}>
        <Reset searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function Reset({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={typeof token === "string" && token && !error ? token : null} />;
}
