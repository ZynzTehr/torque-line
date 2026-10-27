import { describe, expect, it } from "vitest";
import { AuthApiError } from "@neondatabase/auth/next";
import {
  authFailureMessage, checkNewPassword, codeFailureMessage, isInvalidResetLink, needsEmailVerification, NETWORK_MESSAGE,
  orThrow, passwordFailureMessage,
} from "@/lib/auth/errors";

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
      .toBe("Something went wrong. Please try again. (SyntaxError: The string did not match the expected pattern.)");
  });
});

// The SDK normalizes server errors before they reach us: these mirror what it throws for each case.
const wrongCurrent = new AuthApiError("Invalid email or password", 401, "invalid_credentials");
const tooShort = new AuthApiError("Password does not meet security requirements", 400, "weak_password");
const throttled = new AuthApiError("Too many requests. Please try again later.", 429, "over_request_rate_limit");
const badLink = new AuthApiError("Invalid or expired session token", 401, "bad_jwt");

describe("needsEmailVerification", () => {
  it("is true only for the unverified-email error", () => {
    expect(needsEmailVerification(new AuthApiError("Email verification required", 422, "email_not_confirmed"))).toBe(true);
    expect(needsEmailVerification(wrongCurrent)).toBe(false);
    expect(needsEmailVerification(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("isInvalidResetLink", () => {
  it("recognizes the expired or used reset token error", () => {
    expect(isInvalidResetLink(badLink)).toBe(true);
    expect(isInvalidResetLink(tooShort)).toBe(false);
  });
});

describe("passwordFailureMessage", () => {
  it("says the current password is wrong instead of blaming the email", () => {
    expect(passwordFailureMessage(wrongCurrent)).toBe("Your current password is wrong.");
  });

  it("states the length rule and the rate limit plainly", () => {
    expect(passwordFailureMessage(tooShort)).toBe("Use 8 to 128 characters.");
    expect(passwordFailureMessage(throttled)).toBe("Too many tries. Wait a minute and try again.");
  });

  it("falls back to the general message for anything else", () => {
    expect(passwordFailureMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_MESSAGE);
  });
});

describe("codeFailureMessage", () => {
  it("explains a wrong, expired, or locked code", () => {
    expect(codeFailureMessage(new AuthApiError("Invalid OTP", 400, "validation_failed"))).toBe("That code is wrong. Check the email and try again.");
    expect(codeFailureMessage(new AuthApiError("OTP expired", 400, "validation_failed"))).toBe("That code has expired. Send a new one.");
    expect(codeFailureMessage(new AuthApiError("Too many attempts", 403, "feature_not_supported"))).toBe("Too many wrong codes. Send a new one.");
    expect(codeFailureMessage(throttled)).toBe("Too many tries. Wait a minute and try again.");
  });
});

describe("checkNewPassword", () => {
  it("returns a message when the new password is too short, too long, or unconfirmed", () => {
    expect(checkNewPassword("short", "short")).toBe("Use 8 to 128 characters.");
    expect(checkNewPassword("x".repeat(129), "x".repeat(129))).toBe("Use 8 to 128 characters.");
    expect(checkNewPassword("long-enough", "long-enouhg")).toBe("The two passwords don't match.");
    expect(checkNewPassword("long-enough", "long-enough")).toBeNull();
  });
});

describe("orThrow", () => {
  it("passes a success through and turns a returned error into a thrown one", () => {
    expect(orThrow({ data: { status: true }, error: null }).data).toEqual({ status: true });
    expect(() => orThrow({ data: null, error: { message: "Invalid OTP", status: 400, statusText: "Bad Request" } }))
      .toThrow(new AuthApiError("Invalid OTP", 400, undefined));
  });
});
