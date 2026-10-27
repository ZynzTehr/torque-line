import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password" };
export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password" lead="Enter the email you sign in with. We'll send you a link to set a new password.">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
