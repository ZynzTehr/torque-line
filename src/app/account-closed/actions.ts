"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getSessionUser, LOGIN_URL } from "@/lib/auth/server";
import { reopenAccount } from "@/server/accountStore";
import { guarded } from "@/server/guarded";

/** "Reopen account" and "Restore my account": the signed-in user lifts their own closure or scheduled deletion. */
export async function reopenAccountAction() {
  return guarded("reopenAccountAction", async () => {
    const user = await getSessionUser();
    if (!user) redirect(LOGIN_URL);
    return reopenAccount(getDb(), user.id);
  });
}
