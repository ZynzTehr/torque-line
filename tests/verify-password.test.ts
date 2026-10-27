import { describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/lib/auth/verifyPassword";

const input = { baseUrl: "https://auth.example.test/neondb/auth/", origin: "https://app.example.test", userId: "u1", email: "a@example.com", password: "Torque-123!" };
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("verifyPassword", () => {
  it("asks the auth service's sign-in endpoint with the app's origin and hands back the session it made", async () => {
    const fetchImpl = answer(200, { token: "tok", user: { id: "u1" } });
    expect(await verifyPassword(input, fetchImpl)).toEqual({ ok: true, sessionToken: "tok" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.example.test/neondb/auth/sign-in/email");
    expect(init.headers).toEqual({ "content-type": "application/json", origin: "https://app.example.test" });
    expect(JSON.parse(String(init.body))).toEqual({ email: "a@example.com", password: "Torque-123!", rememberMe: false });
  });

  it("calls a 401 a wrong password, a 429 a rate limit, and anything else unavailable", async () => {
    expect(await verifyPassword(input, answer(401, { code: "INVALID_EMAIL_OR_PASSWORD" }))).toEqual({ ok: false, reason: "wrong" });
    expect(await verifyPassword(input, answer(429, {}))).toEqual({ ok: false, reason: "rate-limited" });
    expect(await verifyPassword(input, answer(500, {}))).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifyPassword(input, vi.fn(async () => { throw new TypeError("fetch failed"); }))).toEqual({ ok: false, reason: "unavailable" });
  });

  it("refuses a success for a different user", async () => {
    expect(await verifyPassword(input, answer(200, { token: "tok", user: { id: "someone-else" } }))).toEqual({ ok: false, reason: "wrong" });
  });
});
