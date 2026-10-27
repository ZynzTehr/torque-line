import { describe, expect, it } from "vitest";
import { AuthApiError } from "@neondatabase/auth/next";
import { authFailureMessage, NETWORK_MESSAGE } from "@/lib/auth/errors";

describe("authFailureMessage", () => {
  it("shows the service's message when the account already exists", () => {
    expect(authFailureMessage(new AuthApiError("User already exists. Use another email.", 422, "user_already_exists")))
      .toBe("User already exists. Use another email.");
  });

  it("calls a failed fetch a connection problem, in Chrome and Safari wording", () => {
    expect(authFailureMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_MESSAGE);
    expect(authFailureMessage(new TypeError("Load failed"))).toBe(NETWORK_MESSAGE);
  });

  it("keeps any other failure's class and message visible", () => {
    expect(authFailureMessage(new SyntaxError("The string did not match the expected pattern.")))
      .toBe("Something went wrong signing you in. Please try again. (SyntaxError: The string did not match the expected pattern.)");
  });
});
