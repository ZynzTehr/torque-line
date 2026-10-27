import { describe, expect, it } from "vitest";
import { ADMIN_ACTIONS, PLATFORM_ROLES, can, type AdminAction, type PlatformRole } from "@/domain/adminPermissions";

/** Every role against every action. A new action or role fails this test until it is given an answer here. */
const MATRIX: Record<PlatformRole, Record<AdminAction, boolean>> = {
  super: { viewAccounts: true, setFleetStatus: true, manageAdmins: true },
  support: { viewAccounts: true, setFleetStatus: true, manageAdmins: false },
};

describe("can", () => {
  it("covers exactly the known roles and actions", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PLATFORM_ROLES].sort());
    for (const role of PLATFORM_ROLES) expect(Object.keys(MATRIX[role]).sort()).toEqual([...ADMIN_ACTIONS].sort());
  });

  for (const role of PLATFORM_ROLES) {
    for (const action of ADMIN_ACTIONS) {
      it(`${role} ${MATRIX[role][action] ? "may" : "may not"} ${action}`, () => {
        expect(can({ role }, action)).toBe(MATRIX[role][action]);
      });
    }
  }

  it("refuses everything to someone who isn't an admin", () => {
    for (const action of ADMIN_ACTIONS) expect(can(null, action)).toBe(false);
  });
});
