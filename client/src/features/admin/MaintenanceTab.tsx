import { Wrench } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, ConfirmDialog, EmptyState, Field, Input, Skeleton } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { useMe } from "../auth/use-me";
import { istInputToInstant, formatSpan, maintenanceWarning, validateMaintenance, type MaintenanceDraft, type MaintenanceErrors } from "./maintenance";
import { ResourcePicker } from "./ResourcePicker";
import { AdminPanel, Notice } from "./ui";
import { useAdminResources } from "./use-admin-resources";
import { useCreateMaintenance, useMaintenanceWindows, useOverlapPreview, useRemoveMaintenance, type MaintenanceWindow } from "./use-maintenance";
import { useNamesIn } from "./use-users";

/** Admin › Maintenance: a resource's upcoming windows; create (with a confirm step) and remove. */
export default function MaintenanceTab() {
  const resources = useAdminResources();
  const [resourceId, setResourceId] = useState("");
  const resource = resources.data?.find((r) => r.id === resourceId);
  const windows = useMaintenanceWindows(resourceId);
  const names = useNamesIn(resource?.departmentId);
  const me = useMe();
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-6" aria-label="Maintenance">
      <Field id="mt-resource" label="Resource" className="md:max-w-sm">
        {(control) => (
          <ResourcePicker
            {...control}
            resources={resources.data ?? []}
            value={resourceId}
            onChange={(id) => {
              setResourceId(id);
              setNotice(null);
            }}
          />
        )}
      </Field>
      {notice && <Notice tone="ok">{notice}</Notice>}

      {!resource ? (
        <EmptyState icon={Wrench} title="Choose a resource">
          Its upcoming maintenance windows appear here, and you can schedule a new one.
        </EmptyState>
      ) : (
        <>
          <CreateWindow key={resource.id} resourceId={resource.id} resourceName={resource.name} onCreated={setNotice} />
          <div className="flex flex-col gap-2">
            <h2 className="text-lead font-semibold text-ink">Upcoming windows on {resource.name}</h2>
            {windows.isError ? (
              <Notice tone="error">{describeApiError(windows.error)}</Notice>
            ) : windows.isPending ? (
              <div aria-label="Loading windows" className="flex flex-col gap-2 border-y border-line py-3">
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : windows.data.length === 0 ? (
              <p className="border-y border-line py-3 text-body text-ink-muted">None scheduled.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line border-y border-line">
                {windows.data.map((w) => (
                  <WindowRow
                    key={w.id}
                    window={w}
                    createdBy={w.createdBy === me.data?.id ? "you" : (names.get(w.createdBy)?.fullName ?? "another admin or owner")}
                    onRemoved={() => setNotice("Window removed. Bookings it cancelled stay cancelled.")}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function CreateWindow({ resourceId, resourceName, onCreated }: { resourceId: string; resourceName: string; onCreated: (text: string) => void }) {
  const [draft, setDraft] = useState<MaintenanceDraft>({ resourceId, start: "", end: "", reason: "" });
  const [errors, setErrors] = useState<MaintenanceErrors>({});
  const [confirming, setConfirming] = useState(false);
  const create = useCreateMaintenance();
  const start = istInputToInstant(draft.start);
  const end = istInputToInstant(draft.end);
  const overlapping = useOverlapPreview(resourceId, confirming ? start : null, confirming ? end : null);
  const set = (key: keyof MaintenanceDraft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setConfirming(false);
  };

  const review = (e: FormEvent) => {
    e.preventDefault();
    const found = validateMaintenance(draft, new Date());
    setErrors(found);
    if (Object.keys(found).length === 0) setConfirming(true);
  };

  const back = () => {
    setConfirming(false);
    create.reset();
  };

  const confirm = () => {
    if (!start || !end) return;
    create.mutate(
      { resourceId, start: start.toISOString(), end: end.toISOString(), reason: draft.reason.trim() },
      {
        onSuccess: (created) => {
          const n = created.cancelledBookingIds.length;
          onCreated(`Window created for ${formatSpan(start, end)}. ${n === 0 ? "No bookings were" : n === 1 ? "1 booking was" : `${n} bookings were`} cancelled.`);
          setDraft({ resourceId, start: "", end: "", reason: "" });
          setConfirming(false);
        },
      },
    );
  };

  return (
    <form onSubmit={review} noValidate aria-label="New maintenance window">
      <AdminPanel title="New maintenance window">
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <Field id="mt-start" label="Starts (IST)" error={errors.start}>
            {(control) => <Input {...control} type="datetime-local" value={draft.start} onChange={(e) => set("start", e.target.value)} />}
          </Field>
          <Field id="mt-end" label="Ends (IST)" error={errors.end}>
            {(control) => <Input {...control} type="datetime-local" value={draft.end} onChange={(e) => set("end", e.target.value)} />}
          </Field>
          <Field id="mt-reason" label="Reason (bookers see this)" error={errors.reason} className="md:col-span-2">
            {(control) => <Input {...control} maxLength={500} value={draft.reason} onChange={(e) => set("reason", e.target.value)} />}
          </Field>
        </div>
        <div>
          <Button type="submit" variant="primary">
            Review…
          </Button>
        </div>
      </AdminPanel>

      <ConfirmDialog
        open={confirming && start !== null && end !== null}
        onClose={back}
        title="Create this maintenance window?"
        description={start && end ? maintenanceWarning(resourceName, start, end, overlapping) : ""}
        confirmLabel="Create window and cancel overlapping bookings"
        cancelLabel="Back"
        danger
        busy={create.isPending}
        onConfirm={confirm}
      >
        {create.isError && (
          <p role="alert" className="text-body text-danger-text">
            {describeApiError(create.error)}
          </p>
        )}
      </ConfirmDialog>
    </form>
  );
}

function WindowRow({ window: w, createdBy, onRemoved }: { window: MaintenanceWindow; createdBy: string; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveMaintenance();
  return (
    <li className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="text-body font-medium text-ink tabular-nums">{formatSpan(new Date(w.start), new Date(w.end))}</p>
        <p className="text-body text-ink-muted">
          {w.reason}. Scheduled by {createdBy}.
        </p>
      </div>
      <Button variant="quiet-danger" onClick={() => setConfirming(true)} className="-ml-3 self-start px-3 md:ml-0 md:self-auto">
        Remove…
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          remove.reset();
        }}
        title="Remove this maintenance window?"
        description={`${formatSpan(new Date(w.start), new Date(w.end))}. Bookings it cancelled stay cancelled.`}
        confirmLabel="Remove"
        cancelLabel="Keep"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate(w.id, { onSuccess: onRemoved })}
      >
        {remove.isError && (
          <p role="alert" className="text-body text-danger-text">
            {describeApiError(remove.error)}
          </p>
        )}
      </ConfirmDialog>
    </li>
  );
}
