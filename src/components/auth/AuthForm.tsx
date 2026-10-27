"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { authFailureMessage } from "@/lib/auth/errors";
import { BRAND } from "@/lib/brand";

type Mode = "sign-in" | "sign-up";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const result = mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: name || email.split("@")[0] })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "That didn't work. Check your details and try again.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      console.error("Auth request failed", caught);
      setError(authFailureMessage(caught));
    } finally {
      setPending(false);
    }
  }

  const isSignUp = mode === "sign-up";
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <form onSubmit={onSubmit} className="card w-full max-w-sm" aria-describedby={error ? "auth-error" : undefined}>
        <h1 className="mb-1">{isSignUp ? "Create your fleet" : `Sign in to ${BRAND.name}`}</h1>
        <p className="text-secondary mb-6 text-sm">
          {isSignUp ? "One account per fleet owner. You can add trucks right after." : "Welcome back."}
        </p>
        {isSignUp && (
          <div className="form-group">
            <label className="form-label" htmlFor="name">Your name</label>
            <input className="form-input" id="name" name="name" autoComplete="name" />
          </div>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor="email">Email</label>
          <input className="form-input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="password">Password</label>
          <input className="form-input" id="password" name="password" type="password" minLength={8} required
            autoComplete={isSignUp ? "new-password" : "current-password"} />
        </div>
        {error && <p id="auth-error" role="alert" className="text-danger mb-4 text-sm">{error}</p>}
        <button className="btn btn-primary w-full" type="submit" disabled={pending}>
          {pending ? "Working…" : isSignUp ? "Create account" : "Sign in"}
        </button>
        <p className="text-secondary mt-4 text-center text-sm">
          {isSignUp ? "Already have an account? " : "New here? "}
          <Link className="text-accent" href={isSignUp ? "/auth/sign-in" : "/auth/sign-up"}>
            {isSignUp ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </form>
    </main>
  );
}
