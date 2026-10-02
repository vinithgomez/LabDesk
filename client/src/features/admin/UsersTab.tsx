import { useState } from "react";
import { describeApiError } from "../../lib/api-errors";
import { ROLE_LABEL, ROLES, useMe, type Role } from "../auth/use-me";
import { useDebounced, useDepartments } from "../resources/use-resources";
import { Notice, control, danger, link } from "./ui";
import { roleChangeWarning } from "./users";
import { USER_LIST_CAP, useChangeRole, useUsers, type UserRow } from "./use-users";

/** Admin › Users: find people (GET /api/users) and change roles, with a confirm step. */
export default function UsersTab() {
  const me = useMe();
  const departments = useDepartments();
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const [role, setRole] = useState<Role | "">("");
  const [departmentId, setDepartmentId] = useState(""); // "" = my department
  const [activeOnly, setActiveOnly] = useState(false);
  const users = useUsers({ q, role: role || undefined, departmentId: departmentId || undefined, activeOnly });
  const [notice, setNotice] = useState<string | null>(null);
  const deptCode = (id: string) => departments.data?.find((d) => d.id === id)?.code ?? "—";

  return (
    <section className="flex flex-col gap-3" aria-label="Users">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-slate-400">
          Name
          <input type="search" className={`${control} w-52`} placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="flex flex-col text-xs text-slate-400">
          Role
          <select className={`${control} w-36`} value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
            <option value="">Any</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-400">
          Department
          <select className={`${control} w-40`} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">My department</option>
            {departments.data
              ?.filter((d) => d.id !== me.data?.departmentId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            <option value="all">All departments</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1 text-sm text-slate-300">
          <input type="checkbox" className="size-4 accent-indigo-500" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
      </div>

      {notice && <Notice tone="ok">{notice}</Notice>}
      {users.isError ? (
        <Notice tone="error">{describeApiError(users.error)}</Notice>
      ) : users.isPending ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : users.data.length === 0 ? (
        <p className="text-sm text-slate-400">Nobody matches.</p>
      ) : (
        <>
          <div className="relative overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">Email</th>
                  <th scope="col" className="px-3 py-2 font-medium">Dept</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {users.data.map((u) => (
                  <UserRowView key={u.id} user={u} deptCode={deptCode(u.departmentId)} isMe={u.id === me.data?.id} onChanged={setNotice} />
                ))}
              </tbody>
            </table>
          </div>
          {users.data.length >= USER_LIST_CAP && (
            <p className="text-xs text-slate-400">Showing the first {USER_LIST_CAP}, by name. Narrow the search to find others.</p>
          )}
        </>
      )}
    </section>
  );
}

function UserRowView({ user, deptCode, isMe, onChanged }: { user: UserRow; deptCode: string; isMe: boolean; onChanged: (text: string) => void }) {
  const [next, setNext] = useState<Role>(user.role);
  const [confirming, setConfirming] = useState(false);
  const change = useChangeRole();

  return (
    <tr className={`align-top ${user.isActive ? "" : "text-slate-500"}`}>
      <td className="px-3 py-1.5 font-medium text-slate-100">{user.fullName}</td>
      <td className="px-3 py-1.5 text-slate-300">{user.email}</td>
      <td className="px-3 py-1.5">{deptCode}</td>
      <td className="px-3 py-1.5">{user.isActive ? "Active" : "Inactive"}</td>
      <td className="px-3 py-1.5">
        {isMe ? (
          <span>
            {ROLE_LABEL[user.role]} <span className="text-xs text-slate-500">(you can't change your own role)</span>
          </span>
        ) : confirming ? (
          <div role="group" aria-label={`Confirm role change for ${user.fullName}`} className="flex max-w-md flex-col gap-1.5">
            <p className="text-xs text-amber-100">{roleChangeWarning(user, next)}</p>
            <div className="flex gap-2">
              <button
                type="button"
                autoFocus
                disabled={change.isPending}
                className={danger}
                onClick={() =>
                  change.mutate(
                    { user, role: next },
                    {
                      onSuccess: () => {
                        onChanged(`${user.fullName} is now ${ROLE_LABEL[next].toLowerCase()}.`);
                        setConfirming(false);
                      },
                    },
                  )
                }
              >
                {change.isPending ? "Changing…" : `Make ${ROLE_LABEL[next].toLowerCase()}`}
              </button>
              <button type="button" className={link} onClick={() => { setConfirming(false); setNext(user.role); }}>
                Cancel
              </button>
            </div>
            {change.isError && <p className="text-xs text-rose-300">{describeApiError(change.error, { roleChange: { ownAccount: isMe } })}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              className={`${control} w-36`}
              aria-label={`Role for ${user.fullName}`}
              value={next}
              onChange={(e) => setNext(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button type="button" className={link} disabled={next === user.role} onClick={() => setConfirming(true)}>
              Change…
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
