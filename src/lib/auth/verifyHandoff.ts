import { VERIFY_EMAIL_URL } from "./routes";

/**
 * Which address the verify page is for, and when a code last went to it. Kept in this tab (sessionStorage), not in
 * the URL: the address stays out of request logs and history, a reload keeps it, and a shared or cold link to the
 * page can't send anyone a code. When storage is blocked, the copy in memory still covers the client-side hop.
 */
interface PendingVerification { email: string; sentAt: number | null }

const KEY = "torqueline.verify-email";
let memory: PendingVerification | null = null;

function read(): PendingVerification | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as PendingVerification | null;
    if (parsed && typeof parsed.email === "string") return parsed;
  } catch { /* blocked storage or a bad value: fall back to memory */ }
  return memory;
}

function write(value: PendingVerification | null) {
  memory = value;
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch { /* memory only */ }
}

/** Remembers `email` for the verify page and returns the page's URL. A code sent to it recently still counts. */
export function handOffToVerify(email: string): string {
  const previous = read();
  write({ email, sentAt: previous?.email === email ? previous.sentAt : null });
  return VERIFY_EMAIL_URL;
}

/** The address handed to the verify page in this tab, or null when the page was opened some other way. */
export function pendingVerificationEmail(): string | null {
  return read()?.email ?? null;
}

/** Seconds until another code may go to `email`; 0 when none was sent in the last `cooldown` seconds. */
export function secondsUntilResend(email: string, cooldown: number, now = Date.now()): number {
  const pending = read();
  if (pending?.email !== email || pending.sentAt === null) return 0;
  return Math.max(0, Math.ceil(cooldown - (now - pending.sentAt) / 1000));
}

export function markCodeSent(email: string, now = Date.now()) {
  write({ email, sentAt: now });
}

export function clearVerification() {
  write(null);
}
