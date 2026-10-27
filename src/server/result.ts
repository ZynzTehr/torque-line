/** Expected outcomes are data, not exceptions. `not-found` also covers "belongs to another fleet". */
export type Failure =
  | { ok: false; code: "not-found"; message: string }
  | { ok: false; code: "invalid"; message: string }
  | { ok: false; code: "duplicate-unit"; message: string };

export const notFound = (what = "That record"): Failure => ({ ok: false, code: "not-found", message: `${what} wasn't found.` });
export const invalid = (message: string): Failure => ({ ok: false, code: "invalid", message });

export interface Actor { fleetId: string; userId: string }
