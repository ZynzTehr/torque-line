import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { guarded, UNEXPECTED } from "@/server/guarded";

describe("guarded server actions", () => {
  it("passes results through", async () => {
    expect(await guarded("t", async () => ({ ok: true }))).toEqual({ ok: true });
  });
  it("turns unexpected errors into a typed result without leaking the message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await guarded("t", async () => { throw new Error("connection string postgres://secret"); });
    expect(r).toEqual(UNEXPECTED);
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("re-throws Next's redirect so sign-in redirects still work", async () => {
    await expect(guarded("t", async () => redirect("/auth/sign-in"))).rejects.toThrow();
  });
});
