import { useState } from "react";
import { describeApiError } from "../../lib/api-errors";
import { useMe } from "../auth/use-me";
import { useDepartments, type Resource } from "../resources/use-resources";
import { ResourceForm } from "./ResourceForm";
import { Notice, danger, link, secondary } from "./ui";
import { useAdminResources, useDownloadQr, useSetResourceActive } from "./use-admin-resources";

type Editing = { kind: "new" } | { kind: "edit"; resource: Resource } | null;

/** Admin › Resources: list, create, edit (with owners), deactivate, QR codes. */
export default function ResourcesTab() {
  const me = useMe();
  const resources = useAdminResources();
  const departments = useDepartments();
  const [editing, setEditing] = useState<Editing>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const deptCode = (id: string) => departments.data?.find((d) => d.id === id)?.code ?? "—";
  const rows = (resources.data ?? []).filter((r) => showInactive || r.isActive);

  const close = (saved: Resource | null) => {
    if (saved) setNotice(`Saved ${saved.name}.`);
    setEditing(null);
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Resources">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="size-4 accent-indigo-500" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show deactivated
        </label>
        <button
          type="button"
          className={secondary}
          disabled={editing !== null}
          onClick={() => {
            setNotice(null);
            setEditing({ kind: "new" });
          }}
        >
          New resource
        </button>
      </div>

      {notice && <Notice tone="ok">{notice}</Notice>}
      {editing && departments.data && (
        <ResourceForm
          key={editing.kind === "edit" ? editing.resource.id : "new"}
          original={editing.kind === "edit" ? editing.resource : null}
          departments={departments.data}
          defaultDepartmentId={me.data?.departmentId ?? ""}
          onClose={close}
        />
      )}

      {resources.isError ? (
        <Notice tone="error">{describeApiError(resources.error)}</Notice>
      ) : resources.isPending ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Dept</th>
                <th scope="col" className="px-3 py-2 font-medium">Type</th>
                <th scope="col" className="px-3 py-2 font-medium">Approval</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Owners</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => (
                <ResourceRow
                  key={r.id}
                  resource={r}
                  deptCode={deptCode(r.departmentId)}
                  editing={editing !== null}
                  onEdit={() => {
                    setNotice(null);
                    setEditing({ kind: "edit", resource: r });
                  }}
                  onNotice={setNotice}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ResourceRow({
  resource: r,
  deptCode,
  editing,
  onEdit,
  onNotice,
}: {
  resource: Resource;
  deptCode: string;
  editing: boolean;
  onEdit: () => void;
  onNotice: (text: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const setActive = useSetResourceActive();
  const qr = useDownloadQr();

  return (
    <tr className={`align-top ${r.isActive ? "" : "text-slate-500"}`}>
      <td className="px-3 py-1.5 font-medium text-slate-100">{r.name}</td>
      <td className="px-3 py-1.5">{deptCode}</td>
      <td className="px-3 py-1.5 capitalize">{r.type}</td>
      <td className="px-3 py-1.5">{r.requiresApproval ? `${r.approvalLevels} level${r.approvalLevels === 2 ? "s" : ""}` : "None"}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{r.owners.length}</td>
      <td className="px-3 py-1.5">{r.isActive ? "Active" : "Deactivated"}</td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <button type="button" className={link} disabled={editing} onClick={onEdit}>
            Edit
          </button>
          <button type="button" className={link} disabled={qr.isPending} onClick={() => qr.mutate(r)}>
            {qr.isPending ? "Preparing…" : "Download QR code"}
          </button>
          {r.isActive ? (
            confirming ? (
              <span role="group" aria-label={`Confirm deactivating ${r.name}`} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-300">New bookings will be refused; existing ones stay.</span>
                <button
                  type="button"
                  autoFocus
                  disabled={setActive.isPending}
                  className={danger}
                  onClick={() =>
                    setActive.mutate(
                      { resource: r, active: false },
                      { onSuccess: () => onNotice(`Deactivated ${r.name}.`), onSettled: () => setConfirming(false) },
                    )
                  }
                >
                  Deactivate
                </button>
                <button type="button" className={link} onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className={link} onClick={() => setConfirming(true)}>
                Deactivate…
              </button>
            )
          ) : (
            <button
              type="button"
              className={link}
              disabled={setActive.isPending}
              onClick={() => setActive.mutate({ resource: r, active: true }, { onSuccess: () => onNotice(`Reactivated ${r.name}.`) })}
            >
              Reactivate
            </button>
          )}
        </div>
        {qr.isError && <p className="mt-1 text-xs text-rose-300">{describeApiError(qr.error)}</p>}
        {setActive.isError && <p className="mt-1 text-xs text-rose-300">{describeApiError(setActive.error)}</p>}
      </td>
    </tr>
  );
}
