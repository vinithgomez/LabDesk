import { useState, type FormEvent } from "react";
import { Button, Checkbox, Field, Input, Select, Textarea } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { WEEKDAYS } from "../calendar/format";
import { RESOURCE_TYPES, type Department, type Resource, type ResourceType } from "../resources/use-resources";
import { OwnersEditor } from "./OwnersEditor";
import {
  emptyResourceForm,
  formFromResource,
  hasErrors,
  ownersOf,
  validateResourceForm,
  type FormErrors,
  type OwnerDraft,
  type ResourceFormValues,
} from "./resource-form";
import { AdminPanel, Notice } from "./ui";
import { useSaveResource } from "./use-admin-resources";

type TextKey = "name" | "location" | "capacity" | "minSlotMinutes" | "maxSlotMinutes" | "bookingHorizonDays";

/** Create (original = null) or edit a resource, including its owners. Two columns from tablet up, one on a phone. */
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

  const text = (key: TextKey, label: string, helper?: string, inputMode?: "numeric") => (
    <Field id={`rf-${key}`} label={label} helper={helper} error={errors[key]}>
      {(control) => <Input {...control} className={inputMode ? "tabular-nums" : undefined} inputMode={inputMode} value={values[key]} onChange={(e) => set(key, e.target.value)} />}
    </Field>
  );

  const title = original ? `Edit ${original.name}` : "New resource";
  return (
    <form onSubmit={submit} noValidate aria-label={title}>
      <AdminPanel title={title}>
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <Field id="rf-departmentId" label="Department" error={errors.departmentId} helper={original ? "Can't be changed after creation." : undefined}>
            {(control) => (
              <Select {...control} value={values.departmentId} disabled={original !== null} onChange={(e) => set("departmentId", e.target.value)}>
                <option value="">Choose…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {text("name", "Name")}
          <Field id="rf-type" label="Type">
            {(control) => (
              <Select {...control} value={values.type} onChange={(e) => set("type", e.target.value as ResourceType)}>
                {RESOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t[0]?.toUpperCase()}
                    {t.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {text("location", "Location")}
          {text("capacity", "Capacity (people)", "0 = no limit", "numeric")}
          {text("bookingHorizonDays", "Bookable ahead (days)", undefined, "numeric")}
          {text("minSlotMinutes", "Shortest booking (min)", undefined, "numeric")}
          {text("maxSlotMinutes", "Longest booking (min)", undefined, "numeric")}
          <Field id="rf-businessHoursStart" label="Opens (IST)" error={errors.businessHoursStart}>
            {(control) => <Input {...control} type="time" value={values.businessHoursStart} onChange={(e) => set("businessHoursStart", e.target.value)} />}
          </Field>
          <Field id="rf-businessHoursEnd" label="Closes (IST)" error={errors.businessHoursEnd}>
            {(control) => <Input {...control} type="time" value={values.businessHoursEnd} onChange={(e) => set("businessHoursEnd", e.target.value)} />}
          </Field>
          <fieldset className="flex flex-col gap-1.5 md:col-span-2">
            <legend className="pb-1.5 text-small font-medium text-ink">Open days</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {WEEKDAYS.map((d) => (
                <label key={d.value} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-body text-ink md:min-h-8">
                  <input type="checkbox" className="size-4 accent-cobalt" checked={values.businessDays.includes(d.value)} onChange={() => toggleDay(d.value)} />
                  <abbr title={d.long} className="no-underline">
                    {d.short}
                  </abbr>
                </label>
              ))}
            </div>
          </fieldset>
          <Field id="rf-description" label="Description (optional)" error={errors.description} className="md:col-span-2">
            {(control) => <Textarea {...control} rows={2} value={values.description} onChange={(e) => set("description", e.target.value)} />}
          </Field>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2 md:col-span-2">
            <Checkbox label="Bookings need approval" checked={values.requiresApproval} onChange={(e) => set("requiresApproval", e.target.checked)} />
            <Field id="rf-approvalLevels" label="Approval levels" className="w-32">
              {(control) => (
                <Select {...control} value={values.approvalLevels} onChange={(e) => set("approvalLevels", e.target.value === "2" ? 2 : 1)}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </Select>
              )}
            </Field>
          </div>
        </div>

        <OwnersEditor departmentId={values.departmentId} owners={owners} levels={values.approvalLevels} error={errors.owners} onChange={setOwners} />

        {hasErrors(errors) && <Notice tone="error">Fix the highlighted fields first.</Notice>}
        {save.isError && <Notice tone="error">{describeApiError(save.error)}</Notice>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : original ? "Save changes" : "Create resource"}
          </Button>
          <Button disabled={save.isPending} onClick={() => onClose(null)}>
            Cancel
          </Button>
        </div>
      </AdminPanel>
    </form>
  );
}
