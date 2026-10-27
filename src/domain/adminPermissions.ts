/*
 * What each platform admin role may do. Every admin check on the server goes through `can`, so the matrix in
 * tests/admin-permissions.test.ts is the whole policy.
 */

export const PLATFORM_ROLES = ["super", "support"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ADMIN_ACTIONS = ["viewAccounts", "setFleetStatus", "manageAdmins"] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

const ALLOWED: Record<PlatformRole, ReadonlySet<AdminAction>> = {
  super: new Set(ADMIN_ACTIONS),
  support: new Set(["viewAccounts", "setFleetStatus"]),
};

/** Whether this admin may take the action. `null` is someone who isn't an admin and may do nothing. */
export function can(admin: { role: PlatformRole } | null, action: AdminAction): boolean {
  return admin ? ALLOWED[admin.role].has(action) : false;
}

export const isPlatformRole = (value: unknown): value is PlatformRole => PLATFORM_ROLES.includes(value as PlatformRole);
