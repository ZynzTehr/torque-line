import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearVerification, handOffToVerify, markCodeSent, pendingVerificationEmail, secondsUntilResend,
} from "@/lib/auth/verifyHandoff";

function fakeSessionStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

describe.each([
  ["with sessionStorage", () => vi.stubGlobal("sessionStorage", fakeSessionStorage())],
  ["with storage blocked", () => vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); }, removeItem: () => { throw new Error("SecurityError"); } })],
])("verify-email handoff %s", (_, setup) => {
  beforeEach(() => { setup(); clearVerification(); });
  afterEach(() => vi.unstubAllGlobals());

  it("has nothing pending until sign-in or sign-up hands an address over, and keeps it out of the URL", () => {
    expect(pendingVerificationEmail()).toBeNull();
    expect(handOffToVerify("ann@example.com")).toBe("/auth/verify-email");
    expect(pendingVerificationEmail()).toBe("ann@example.com");
  });

  it("counts down from the last code sent, so a reload or a second sign-in doesn't send another", () => {
    handOffToVerify("ann@example.com");
    expect(secondsUntilResend("ann@example.com", 60)).toBe(0);
    markCodeSent("ann@example.com", 1_000_000);
    expect(secondsUntilResend("ann@example.com", 60, 1_000_000 + 15_000)).toBe(45);
    handOffToVerify("ann@example.com");
    expect(secondsUntilResend("ann@example.com", 60, 1_000_000 + 15_000)).toBe(45);
    expect(secondsUntilResend("ann@example.com", 60, 1_000_000 + 61_000)).toBe(0);
  });

  it("starts fresh for a different address, and forgets everything once verified", () => {
    markCodeSent("ann@example.com", 1_000_000);
    handOffToVerify("bob@example.com");
    expect(secondsUntilResend("bob@example.com", 60, 1_000_000)).toBe(0);
    clearVerification();
    expect(pendingVerificationEmail()).toBeNull();
  });
});
