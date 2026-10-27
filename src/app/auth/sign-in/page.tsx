import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { SIGN_IN_NOTICES, type SignInNotice } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Sign in" };
export default function SignInPage({ searchParams }: PageProps<"/auth/sign-in">) {
  return <AuthForm mode="sign-in" notice={<Suspense fallback={null}><Notice searchParams={searchParams} /></Suspense>} />;
}

async function Notice({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { notice } = await searchParams;
  const text = typeof notice === "string" && Object.hasOwn(SIGN_IN_NOTICES, notice) ? SIGN_IN_NOTICES[notice as SignInNotice] : null;
  return text ? <p role="status" className="text-success mb-4 text-sm">{text}</p> : null;
}
