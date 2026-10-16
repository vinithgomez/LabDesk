import { Download, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Checkbox, ConfirmDialog, Skeleton, StatusPill, Table, type Column } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { useMe } from "../auth/use-me";
import { useDepartments, type Resource } from "../resources/use-resources";
import { ResourceForm } from "./ResourceForm";
import { Notice } from "./ui";
import { useAdminResources, useDownloadQr, useSetResourceActive } from "./use-admin-resources";

type Editing = { kind: "new" } | { kind: "edit"; resource: Resource } | null;

const TYPE_LABEL: Record<Resource["type"], string> = { lab: "Lab", room: "Room", equipment: "Equipment" };
const approvalText = (r: Resource) => (r.requiresApproval ? `${r.approvalLevels} level${r.approvalLevels === 2 ? "s" : ""}` : "None");

/** Admin › Resources: list, create, edit (with owners), deactivate, QR codes. */
export default function ResourcesTab() {
  const me = useMe();
  const resources = useAdminResources();
  const departments = useDepartments();
  const [editing, setEditing] = useState<Editing>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<Resource | null>(null);
  const setActive = useSetResourceActive();
  const deptCode = (id: string) => departments.data?.find((d) => d.id === id)?.code ?? "—";
  const rows = (resources.data ?? []).filter((r) => showInactive || r.isActive);

  const close = (saved: Resource | null) => {
    if (saved) setNotice(`Saved ${saved.name}.`);
    setEditing(null);
  };
  const edit = (r: Resource) => {
    setNotice(null);
    setEditing({ kind: "edit", resource: r });
  };

  const columns: Column<Resource>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink">{r.name}</span>
          <span className="text-small text-ink-muted">
            {TYPE_LABEL[r.type]}, {deptCode(r.departmentId)}
          </span>
        </span>
      ),
    },
    { key: "location", header: "Location", cell: (r) => <span className="text-ink-muted">{r.location}</span>, hideBelowXl: true },
    { key: "approval", header: "Approval", nowrap: true, cell: (r) => approvalText(r) },
    { key: "owners", header: "Owners", align: "right", numeric: true, cell: (r) => r.owners.length },
    {
      key: "status",
      header: "Status",
      nowrap: true,
      cell: (r) => (r.isActive ? <Badge tone="cobalt">Active</Badge> : <StatusPill status="cancelled" label="Deactivated" />),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) => (
        <RowActions
          resource={r}
          editing={editing !== null}
          onEdit={() => edit(r)}
          onDeactivate={() => setDeactivating(r)}
          onReactivate={() => setActive.mutate({ resource: r, active: true }, { onSuccess: () => setNotice(`Reactivated ${r.name}.`) })}
          reactivating={setActive.isPending}
        />
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-4" aria-label="Resources">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox label="Show deactivated" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        <Button
          variant="primary"
          icon={Plus}
          disabled={editing !== null}
          onClick={() => {
            setNotice(null);
            setEditing({ kind: "new" });
          }}
        >
          New resource
        </Button>
      </div>

      {notice && <Notice tone="ok">{notice}</Notice>}
      {setActive.isError && <Notice tone="error">{describeApiError(setActive.error)}</Notice>}
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
        <div aria-label="Loading resources" className="flex flex-col gap-3 border-y border-line py-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : (
        <Table
          caption="Resources"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          mobileRow={(r) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                {columns[0]?.cell(r)}
                {columns[4]?.cell(r)}
              </div>
              <p className="text-body text-ink-muted">
                {r.location}. Approval: {approvalText(r).toLowerCase()}; {r.owners.length} owner{r.owners.length === 1 ? "" : "s"}.
              </p>
              <div className="-ml-3">{columns[5]?.cell(r)}</div>
            </div>
          )}
        />
      )}

      <ConfirmDialog
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title={deactivating ? `Deactivate ${deactivating.name}?` : "Deactivate?"}
        description="New bookings will be refused; existing ones stay. You can reactivate it later."
        confirmLabel="Deactivate"
        cancelLabel="Keep it active"
        danger
        busy={setActive.isPending}
        onConfirm={() => {
          const r = deactivating;
          if (!r) return;
          setActive.mutate(
            { resource: r, active: false },
            { onSuccess: () => setNotice(`Deactivated ${r.name}.`), onSettled: () => setDeactivating(null) },
          );
        }}
      />
    </section>
  );
}

function RowActions({
  resource: r,
  editing,
  onEdit,
  onDeactivate,
  onReactivate,
  reactivating,
}: {
  resource: Resource;
  editing: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  reactivating: boolean;
}) {
  const qr = useDownloadQr();
  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <div className="flex flex-wrap items-center gap-x-1 md:justify-end">
        <Button variant="quiet" icon={Pencil} disabled={editing} onClick={onEdit} className="px-3">
          Edit
        </Button>
        <Button variant="quiet" icon={Download} disabled={qr.isPending} onClick={() => qr.mutate(r)} className="px-3">
          {qr.isPending ? "Preparing…" : "Download QR code"}
        </Button>
        {r.isActive ? (
          <Button variant="quiet-danger" onClick={onDeactivate} className="px-3">
            Deactivate…
          </Button>
        ) : (
          <Button variant="quiet" disabled={reactivating} onClick={onReactivate} className="px-3">
            Reactivate
          </Button>
        )}
      </div>
      {qr.isError && <p className="text-small text-danger-text">{describeApiError(qr.error)}</p>}
    </div>
  );
}
