import { useState, type FormEvent } from "react";
import { describeApiError } from "../../lib/api-errors";
import { useMe } from "../auth/use-me";
import { istInputToInstant, formatSpan, maintenanceWarning, validateMaintenance, type MaintenanceDraft, type MaintenanceErrors } from "./maintenance";
import { ResourcePicker } from "./ResourcePicker";
import { Field, Notice, control, danger, link, primary, secondary } from "./ui";
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
    <section className="flex flex-col gap-3" aria-label="Maintenance">
      <div className="max-w-sm">
        <label htmlFor="mt-resource" className="text-xs text-slate-400">
          Resource
        </label>
        <ResourcePicker id="mt-resource" resources={resources.data ?? []} value={resourceId} onChange={(id) => { setResourceId(id); setNotice(null); }} />
      </div>
      {notice && <Notice tone="ok">{notice}</Notice>}

      {resource && (
        <>
          <CreateWindow key={resource.id} resourceId={resource.id} resourceName={resource.name} onCreated={setNotice} />
          <h2 className="text-sm font-semibold text-white">Upcoming windows on {resource.name}</h2>
          {windows.isError ? (
            <Notice tone="error">{describeApiError(windows.error)}</Notice>
          ) : windows.isPending ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : windows.data.length === 0 ? (
            <p className="text-sm text-slate-400">None scheduled.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-800 rounded-lg border border-slate-800">
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
    <form onSubmit={review} noValidate aria-label="New maintenance window" className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
      <h2 className="text-sm font-semibold text-white">New maintenance window</h2>
      <div className="grid gap-2 sm:grid-cols-[12rem_12rem_1fr]">
        <Field id="mt-start" label="Starts (IST)" error={errors.start}>
          {(a11y) => <input {...a11y} type="datetime-local" className={control} value={draft.start} onChange={(e) => set("start", e.target.value)} />}
        </Field>
        <Field id="mt-end" label="Ends (IST)" error={errors.end}>
          {(a11y) => <input {...a11y} type="datetime-local" className={control} value={draft.end} onChange={(e) => set("end", e.target.value)} />}
        </Field>
        <Field id="mt-reason" label="Reason (bookers see this)" error={errors.reason}>
          {(a11y) => <input {...a11y} className={control} maxLength={500} value={draft.reason} onChange={(e) => set("reason", e.target.value)} />}
        </Field>
      </div>
      {confirming && start && end ? (
        <div role="group" aria-label="Confirm maintenance window" className="flex flex-col gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-2">
          <p className="text-sm text-amber-100">{maintenanceWarning(resourceName, start, end, overlapping)}</p>
          {create.isError && <p className="text-sm text-rose-300">{describeApiError(create.error)}</p>}
          <div className="flex gap-2">
            <button type="button" autoFocus disabled={create.isPending} onClick={confirm} className={danger}>
              {create.isPending ? "Creating…" : "Create window and cancel overlapping bookings"}
            </button>
            <button type="button" disabled={create.isPending} onClick={() => setConfirming(false)} className={secondary}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="submit" className={primary}>
            Review…
          </button>
        </div>
      )}
    </form>
  );
}

function WindowRow({ window: w, createdBy, onRemoved }: { window: MaintenanceWindow; createdBy: string; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveMaintenance();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
      <div className="min-w-0">
        <span className="tabular-nums text-slate-100">{formatSpan(new Date(w.start), new Date(w.end))}</span>
        <span className="text-slate-300"> · {w.reason}</span>
        <span className="text-xs text-slate-500"> · by {createdBy}</span>
      </div>
      {confirming ? (
        <span role="group" aria-label="Confirm removal" className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-300">Remove it? Bookings it cancelled stay cancelled.</span>
          <button type="button" autoFocus disabled={remove.isPending} className={danger} onClick={() => remove.mutate(w.id, { onSuccess: onRemoved })}>
            Remove
          </button>
          <button type="button" className={link} onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button type="button" className={link} onClick={() => setConfirming(true)}>
          Remove…
        </button>
      )}
      {remove.isError && <p className="w-full text-xs text-rose-300">{describeApiError(remove.error)}</p>}
    </li>
  );
}
