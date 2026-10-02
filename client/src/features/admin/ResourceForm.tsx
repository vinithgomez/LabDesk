import { useState, type FormEvent } from "react";
import { RESOURCE_TYPES, type Department, type Resource, type ResourceType } from "../resources/use-resources";
import { OwnersEditor } from "./OwnersEditor";
import {
  emptyResourceForm,
  formFromResource,
  hasErrors,
  validateResourceForm,
  type FormErrors,
  type OwnerDraft,
  type ResourceFormValues,
} from "./resource-form";
import { Field, Notice, WEEKDAYS, control, primary, secondary } from "./ui";
import { describeSaveError, ownersOf, useSaveResource } from "./use-admin-resources";

/** Create (original = null) or edit a resource, including its owners. */
export function ResourceForm({
  original,
  departments,
  defaultDepartmentId,
  onClose,
}: {
  original: Resource | null;
  departments: Department[];
  defaultDepartmentId: string;
  /** Called with the saved resource, or null when cancelled. */
  onClose: (saved: Resource | null) => void;
}) {
  const [values, setValues] = useState<ResourceFormValues>(() =>
    original ? formFromResource(original) : emptyResourceForm(defaultDepartmentId),
  );
  const [owners, setOwners] = useState<OwnerDraft[]>(() => (original ? ownersOf(original) : []));
  const [errors, setErrors] = useState<FormErrors>({});
  const save = useSaveResource();

  const set = <K extends keyof ResourceFormValues>(key: K, value: ResourceFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const toggleDay = (day: number) =>
    set("businessDays", values.businessDays.includes(day) ? values.businessDays.filter((d) => d !== day) : [...values.businessDays, day]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateResourceForm(values, owners);
    setErrors(found);
    if (hasErrors(found)) return;
    save.mutate({ original, values, owners }, { onSuccess: (saved) => onClose(saved) });
  };

  const text = (key: "name" | "location" | "capacity" | "minSlotMinutes" | "maxSlotMinutes" | "bookingHorizonDays", label: string, hint?: string, inputMode?: "numeric") => (
    <Field id={`rf-${key}`} label={label} hint={hint} error={errors[key]}>
      {(a11y) => (
        <input {...a11y} className={control} inputMode={inputMode} value={values[key]} onChange={(e) => set(key, e.target.value)} />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate aria-label={original ? `Edit ${original.name}` : "New resource"} className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
      <h2 className="text-sm font-semibold text-white">{original ? `Edit ${original.name}` : "New resource"}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field id="rf-departmentId" label="Department" error={errors.departmentId} hint={original ? "Can't be changed after creation." : undefined}>
          {(a11y) => (
            <select {...a11y} className={control} value={values.departmentId} disabled={original !== null} onChange={(e) => set("departmentId", e.target.value)}>
              <option value="">Choose…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            </select>
          )}
        </Field>
        {text("name", "Name")}
        <Field id="rf-type" label="Type">
          {(a11y) => (
            <select {...a11y} className={control} value={values.type} onChange={(e) => set("type", e.target.value as ResourceType)}>
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t[0]?.toUpperCase()}
                  {t.slice(1)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {text("location", "Location")}
        {text("capacity", "Capacity (people)", "0 = no limit", "numeric")}
        {text("minSlotMinutes", "Shortest booking (min)", undefined, "numeric")}
        {text("maxSlotMinutes", "Longest booking (min)", undefined, "numeric")}
        {text("bookingHorizonDays", "Bookable ahead (days)", undefined, "numeric")}
        <Field id="rf-businessHoursStart" label="Opens (IST)" error={errors.businessHoursStart}>
          {(a11y) => <input {...a11y} type="time" className={control} value={values.businessHoursStart} onChange={(e) => set("businessHoursStart", e.target.value)} />}
        </Field>
        <Field id="rf-businessHoursEnd" label="Closes (IST)" error={errors.businessHoursEnd}>
          {(a11y) => <input {...a11y} type="time" className={control} value={values.businessHoursEnd} onChange={(e) => set("businessHoursEnd", e.target.value)} />}
        </Field>
        <fieldset className="col-span-2 flex flex-col gap-1">
          <legend className="text-xs text-slate-400">Open days</legend>
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1 text-sm text-slate-200">
                <input type="checkbox" className="size-4 accent-indigo-500" checked={values.businessDays.includes(d.value)} onChange={() => toggleDay(d.value)} />
                <abbr title={d.long} className="no-underline">
                  {d.short}
                </abbr>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <Field id="rf-description" label="Description (optional)" error={errors.description}>
        {(a11y) => <textarea {...a11y} rows={2} className={`${control} py-1`} value={values.description} onChange={(e) => set("description", e.target.value)} />}
      </Field>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" className="size-4 accent-indigo-500" checked={values.requiresApproval} onChange={(e) => set("requiresApproval", e.target.checked)} />
          Bookings need approval
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          Approval levels
          <select className={`${control} w-16`} value={values.approvalLevels} onChange={(e) => set("approvalLevels", e.target.value === "2" ? 2 : 1)}>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      </div>

      <OwnersEditor departmentId={values.departmentId} owners={owners} levels={values.approvalLevels} error={errors.owners} onChange={setOwners} />

      {hasErrors(errors) && <Notice tone="error">Fix the highlighted fields first.</Notice>}
      {save.isError && <Notice tone="error">{describeSaveError(save.error)}</Notice>}

      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className={primary}>
          {save.isPending ? "Saving…" : original ? "Save changes" : "Create resource"}
        </button>
        <button type="button" disabled={save.isPending} onClick={() => onClose(null)} className={secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
