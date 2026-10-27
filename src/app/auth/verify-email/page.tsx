import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { VerifyEmail } from "@/components/auth/VerifyEmailForm";

export const metadata: Metadata = { title: "Verify your email" };

/** Reached from sign-up or sign-in when the account's email still needs verifying; the address comes with the tab. */
export default function VerifyEmailPage() {
  return (
    <AuthCard title="Check your email">
      <VerifyEmail />
    </AuthCard>
  );
}
