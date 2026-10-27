"use client";

import { useOptimistic, useState, useTransition, type FormEvent } from "react";
import { addAdminAction, removeAdminAction, setAdminRoleAction } from "@/app/(app)/admin/actions";
import { Sheet } from "@/components/ui/Sheet";
import { isPlatformRole, type PlatformRole } from "@/domain/adminPermissions";

export interface AdminView { userId: string; email: string | null; role: PlatformRole }

const ROLE_LABEL: Record<PlatformRole, string> = { super: "Super", support: "Support" };

function RoleSelect({ id, value, disabled, onChange, label }: {
  id: string; value: PlatformRole; disabled?: boolean; onChange: (role: PlatformRole) => void; label?: string;
}) {
  return (
    <select id={id} className="form-select" aria-label={label} value={value} disabled={disabled}
      onChange={(e) => { if (isPlatformRole(e.target.value)) onChange(e.target.value); }}>
      <option value="support">Support</option>
      <option value="super">Super</option>
    </select>
  );
}

/** One admin. Your own row has no controls: nobody can demote or remove themselves. */
function AdminRow({ admin, isSelf }: { admin: AdminView; isSelf: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shows the chosen role while it saves; the server's role comes back with the refresh, or stays if it failed.
  const [role, showRole] = useOptimistic(admin.role);
  const [saving, startSaving] = useTransition();
  const email = admin.email ?? "Unknown email";

  async function run(action: () => ReturnType<typeof removeAdminAction>) {
    setPending(true);
    setError(null);
    const r = await action();
    setPending(false);
    if (!r.ok) { setError(r.message); return; }
    setConfirming(false);
  }

  return (
    <li className="card !p-3" data-testid="platform-admin">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-2">
          <span className="font-semibold break-all">{email}</span>
          {isSelf && <><span className="badge badge-blue">{ROLE_LABEL[admin.role]}</span><span className="badge badge-neutral">You</span></>}
        </div>
        {!isSelf && (
          <div className="flex items-center gap-2">
            <RoleSelect id={`role-${admin.userId}`} label={`Role for ${email}`} value={role} disabled={pending || saving}
              onChange={(next) => startSaving(async () => {
                showRole(next);
                await run(() => setAdminRoleAction(admin.userId, next));
              })} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(true)}>Remove</button>
          </div>
        )}
      </div>
      {error && !confirming && <p role="alert" className="text-danger mt-2 text-xs">{error}</p>}
      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Remove admin?"
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => run(() => removeAdminAction(admin.userId))}>
            {pending ? "Removing…" : "Remove"}
          </button>
        </>}>
        <p className="text-secondary text-sm">
          <strong className="text-fg">{email}</strong> loses admin access. Their own account and fleet stay as they are.
        </p>
        {error && <p role="alert" className="text-danger mt-2 text-sm">{error}</p>}
      </Sheet>
    </li>
  );
}

function AddAdmin() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PlatformRole>("support");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const r = await addAdminAction(email, role);
    setPending(false);
    if (!r.ok) { setError(r.message); return; }
    setEmail("");
    setRole("support");
  }

  return (
    <form onSubmit={submit} className="card mt-3 !p-3" aria-labelledby="add-admin-title">
      <h4 id="add-admin-title" className="mb-1 font-semibold">Add an admin</h4>
      <p className="text-secondary mb-3 text-xs">They need a Torqueline account first. Support can see and pause accounts; super can also manage admins.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <label className="form-label" htmlFor="add-admin-email">Email</label>
          <input id="add-admin-email" className="form-input" type="email" required autoComplete="off" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="form-label" htmlFor="add-admin-role">Role</label>
          <RoleSelect id="add-admin-role" value={role} onChange={setRole} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending || !email.trim()}>{pending ? "Adding…" : "Add admin"}</button>
      </div>
      {error && <p role="alert" className="text-danger mt-2 text-sm">{error}</p>}
    </form>
  );
}

/** Super admins only: the page renders it after checking can(…, "manageAdmins"), and every action re-checks. */
export function AdminsPanel({ admins, selfId }: { admins: AdminView[]; selfId: string }) {
  return (
    <section className="mt-8" aria-labelledby="admins-title">
      <h3 id="admins-title" className="mb-3">Admins</h3>
      <ul className="flex flex-col gap-2" aria-label="Admins">
        {admins.map((a) => <AdminRow key={a.userId} admin={a} isSelf={a.userId === selfId} />)}
      </ul>
      <AddAdmin />
    </section>
  );
}
