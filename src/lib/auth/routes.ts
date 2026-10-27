/** Where signed-out visitors go. Shared by server redirects and the client sign-out. */
export const LOGIN_URL = "/auth/sign-in";
/** Where the owner of a deactivated fleet lands. */
export const PAUSED_URL = "/account-paused";
/** Where a user who closed their account, or asked for it to be deleted, lands; it offers to reopen or restore it. */
export const CLOSED_URL = "/account-closed";
export const FORGOT_PASSWORD_URL = "/auth/forgot-password";
export const RESET_PASSWORD_URL = "/auth/reset-password";

/** Where an unverified owner enters the emailed code. The address is handed over in the tab (verifyHandoff.ts). */
export const VERIFY_EMAIL_URL = "/auth/verify-email";

/** One-line notices the sign-in page shows after another auth page sends the user there (?notice=…). */
export const SIGN_IN_NOTICES = {
  "password-reset": "Password updated and all devices signed out. Sign in with your new password.",
  verified: "Email verified. Sign in to continue.",
  "account-closed": "Your account is closed and you're signed out. Sign in any time to reopen it.",
  "deletion-scheduled": "Your account will be deleted in 30 days and you're signed out. Sign in before then to restore it.",
} as const;
export type SignInNotice = keyof typeof SIGN_IN_NOTICES;
