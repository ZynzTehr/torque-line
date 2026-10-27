"use client";

import { useState } from "react";

interface PasswordInputProps {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
}

/** A password field with a Show/Hide button, so a long password can be checked before it's saved. */
export function PasswordInput({ id, label, autoComplete, value, onChange }: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>{label}</label>
      <div className="relative">
        <input className="form-input w-full pr-16" id={id} type={shown ? "text" : "password"} required
          autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="text-accent absolute inset-y-0 right-0 px-3 text-sm" aria-controls={id} aria-pressed={shown}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onClick={() => setShown((s) => !s)}>
          {shown ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
