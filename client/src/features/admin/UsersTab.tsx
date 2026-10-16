import { Users } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, Table, type Column } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { ROLE_LABEL, ROLES, useMe, type Role } from "../auth/use-me";
import { useDebounced, useDepartments } from "../resources/use-resources";
import { Notice } from "./ui";
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

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      cell: (u) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink">{u.fullName}</span>
          <span className="text-small break-all text-ink-muted">{u.email}</span>
        </span>
      ),
    },
    { key: "dept", header: "Dept", nowrap: true, cell: (u) => deptCode(u.departmentId) },
    {
      key: "status",
      header: "Status",
      nowrap: true,
      cell: (u) => (u.isActive ? <Badge tone="cobalt">Active</Badge> : <Badge>Inactive</Badge>),
    },
    {
      key: "role",
      header: "Role",
      cell: (u) => <RoleControl user={u} isMe={u.id === me.data?.id} onChanged={setNotice} />,
    },
  ];

  return (
    <section className="flex flex-col gap-4" aria-label="Users">
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1fr)_10rem_11rem_auto] md:items-end">
        <Field label="Name">
          {(control) => <Input {...control} type="search" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />}
        </Field>
        <Field label="Role">
          {(control) => (
            <Select {...control} value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
              <option value="">Any</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Department">
          {(control) => (
            <Select {...control} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">My department</option>
              {departments.data
                ?.filter((d) => d.id !== me.data?.departmentId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code}
                  </option>
                ))}
              <option value="all">All departments</option>
            </Select>
          )}
        </Field>
        <Checkbox label="Active only" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
      </div>

      {notice && <Notice tone="ok">{notice}</Notice>}
      {users.isError ? (
        <Notice tone="error">{describeApiError(users.error)}</Notice>
      ) : users.isPending ? (
        <div aria-label="Loading people" className="flex flex-col gap-3 border-y border-line py-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/5" />
        </div>
      ) : users.data.length === 0 ? (
        <EmptyState icon={Users} title="Nobody matches.">
          Try a shorter name, another role, or all departments.
        </EmptyState>
      ) : (
        <>
          <Table
            caption="People"
            columns={columns}
            rows={users.data}
            rowKey={(u) => u.id}
            mobileRow={(u) => (
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  {columns[0]?.cell(u)}
                  {columns[2]?.cell(u)}
                </div>
                <p className="text-small text-ink-muted">{deptCode(u.departmentId)}</p>
                {columns[3]?.cell(u)}
              </div>
            )}
          />
          {users.data.length >= USER_LIST_CAP && (
            <p className="text-small text-ink-muted">Showing the first {USER_LIST_CAP}, by name. Narrow the search to find others.</p>
          )}
        </>
      )}
    </section>
  );
}

/** A person's role: a select and Change…, which asks first in a ConfirmDialog. Never on your own account. */
function RoleControl({ user, isMe, onChanged }: { user: UserRow; isMe: boolean; onChanged: (text: string) => void }) {
  const [next, setNext] = useState<Role>(user.role);
  const [confirming, setConfirming] = useState(false);
  const change = useChangeRole();

  if (isMe) {
    return (
      <span className="text-body text-ink">
        {ROLE_LABEL[user.role]} <span className="text-small text-ink-muted">(you can't change your own role)</span>
      </span>
    );
  }
  const close = () => {
    setConfirming(false);
    change.reset();
  };
  return (
    <div className="flex items-center gap-2">
      <Select className="w-40" aria-label={`Role for ${user.fullName}`} value={next} onChange={(e) => setNext(e.target.value as Role)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </Select>
      <Button variant="quiet" disabled={next === user.role} onClick={() => setConfirming(true)} className="px-3">
        Change…
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          close();
          setNext(user.role);
        }}
        title={`Change ${user.fullName}'s role?`}
        description={roleChangeWarning(user, next)}
        confirmLabel={change.isPending ? "Changing…" : `Make ${ROLE_LABEL[next].toLowerCase()}`}
        cancelLabel="Cancel"
        busy={change.isPending}
        onConfirm={() =>
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
        {change.isError && (
          <p role="alert" className="text-body text-danger-text">
            {describeApiError(change.error, { roleChange: { ownAccount: isMe } })}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
