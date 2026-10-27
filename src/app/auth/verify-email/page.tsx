import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";
import { LOGIN_URL } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Verify your email" };

/** Reached from sign-up or sign-in when the account's email still needs verifying (?email=…). */
export default function VerifyEmailPage({ searchParams }: PageProps<"/auth/verify-email">) {
  return (
    <AuthCard title="Check your email">
      <Suspense fallback={<p className="text-secondary text-sm">Loading…</p>}>
        <Verify searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function Verify({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { email } = await searchParams;
  if (typeof email !== "string" || !email.includes("@")) {
    return (
      <>
        <p className="text-secondary mb-6 text-sm">Sign in first and we&apos;ll send a code to your email.</p>
        <Link className="btn btn-primary w-full" href={LOGIN_URL}>Go to sign in</Link>
      </>
    );
  }
  return <VerifyEmailForm email={email} />;
}
