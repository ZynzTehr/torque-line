/** Where signed-out visitors go. Shared by server redirects and the client sign-out. */
export const LOGIN_URL = "/auth/sign-in";
/** Where the owner of a deactivated fleet lands. */
export const PAUSED_URL = "/account-paused";
export const FORGOT_PASSWORD_URL = "/auth/forgot-password";
export const RESET_PASSWORD_URL = "/auth/reset-password";

/** Where an unverified owner enters the emailed code. The address rides in the URL so a reload keeps it. */
export function verifyEmailHref(email: string): string {
  return `/auth/verify-email?email=${encodeURIComponent(email)}`;
}

/** One-line notices the sign-in page shows after another auth page sends the user there (?notice=…). */
export const SIGN_IN_NOTICES = {
  "password-reset": "Password updated and all devices signed out. Sign in with your new password.",
  verified: "Email verified. Sign in to continue.",
} as const;
export type SignInNotice = keyof typeof SIGN_IN_NOTICES;
