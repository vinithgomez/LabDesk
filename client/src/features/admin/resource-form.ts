/**
 * The admin resource form, as pure functions: values, validation that
 * mirrors the server's rules, the request bodies, and the order in which an
 * edit's two requests (fields, owners) can be applied.
 */
import { parseHhmm } from "../calendar/grid";
import type { Resource, ResourceType } from "../resources/use-resources";

export interface OwnerDraft {
  userId: string;
  approvalLevel: 1 | 2;
}

export interface ResourceFormValues {
  departmentId: string;
  name: string;
  type: ResourceType;
  location: string;
  capacity: string;
  description: string;
  requiresApproval: boolean;
  approvalLevels: 1 | 2;
  minSlotMinutes: string;
  maxSlotMinutes: string;
  bookingHorizonDays: string;
  businessHoursStart: string;
  businessHoursEnd: string;
  /** 0 = Sunday. */
  businessDays: number[];
}

export type FormErrors = Partial<Record<keyof ResourceFormValues | "owners", string>>;

/** The server's defaults (createResourceBody). */
export function emptyResourceForm(departmentId: string): ResourceFormValues {
  return {
    departmentId,
    name: "",
    type: "lab",
    location: "",
    capacity: "0",
    description: "",
    requiresApproval: false,
    approvalLevels: 1,
    minSlotMinutes: "30",
    maxSlotMinutes: "180",
    bookingHorizonDays: "14",
    businessHoursStart: "08:00",
    businessHoursEnd: "18:00",
    businessDays: [1, 2, 3, 4, 5],
  };
}

export function formFromResource(r: Resource): ResourceFormValues {
  return {
    departmentId: r.departmentId,
    name: r.name,
    type: r.type,
    location: r.location,
    capacity: String(r.capacity),
    description: r.description,
    requiresApproval: r.requiresApproval,
    approvalLevels: r.approvalLevels === 2 ? 2 : 1,
    minSlotMinutes: String(r.minSlotMinutes),
    maxSlotMinutes: String(r.maxSlotMinutes),
    bookingHorizonDays: String(r.bookingHorizonDays),
    businessHoursStart: r.businessHoursStart,
    businessHoursEnd: r.businessHoursEnd,
    businessDays: [...r.businessDays].sort((a, b) => a - b),
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A whole number in [min, max], or null. */
function intIn(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** Levels 1..n a resource that needs approval must have an owner at, missing from `owners`. */
export function missingOwnerLevels(
  config: { requiresApproval: boolean; approvalLevels: number },
  owners: readonly OwnerDraft[],
): number[] {
  if (!config.requiresApproval) return [];
  const missing: number[] = [];
  for (let level = 1; level <= config.approvalLevels; level += 1) {
    if (!owners.some((o) => o.approvalLevel === level)) missing.push(level);
  }
  return missing;
}

/** Owners at a level the resource doesn't use. */
function ownersOutOfRange(config: { approvalLevels: number }, owners: readonly OwnerDraft[]): OwnerDraft[] {
  return owners.filter((o) => o.approvalLevel > config.approvalLevels);
}

/** Every rule the server applies to these values, as one message per field. */
export function validateResourceForm(v: ResourceFormValues, owners: readonly OwnerDraft[]): FormErrors {
  const errors: FormErrors = {};
  if (!v.departmentId) errors.departmentId = "Choose a department.";
  if (!v.name.trim()) errors.name = "Give it a name.";
  else if (v.name.trim().length > 120) errors.name = "Keep the name to 120 characters.";
  if (!v.location.trim()) errors.location = "Say where it is.";
  else if (v.location.trim().length > 120) errors.location = "Keep the location to 120 characters.";
  if (intIn(v.capacity, 0, 10_000) === null) errors.capacity = "A whole number from 0 (no limit) to 10,000.";
  if (v.description.trim().length > 2000) errors.description = "Keep the description to 2,000 characters.";

  const min = intIn(v.minSlotMinutes, 1, 1440);
  const max = intIn(v.maxSlotMinutes, 1, 1440);
  if (min === null) errors.minSlotMinutes = "Minutes, from 1 to 1,440.";
  if (max === null) errors.maxSlotMinutes = "Minutes, from 1 to 1,440 (bookings are same-day).";
  if (min !== null && max !== null && min > max) errors.minSlotMinutes = "The shortest booking can't be longer than the longest.";
  if (intIn(v.bookingHorizonDays, 1, 365) === null) errors.bookingHorizonDays = "Days, from 1 to 365.";

  const startOk = HHMM.test(v.businessHoursStart);
  const endOk = HHMM.test(v.businessHoursEnd);
  if (!startOk) errors.businessHoursStart = "A time like 08:00.";
  if (!endOk) errors.businessHoursEnd = "A time like 18:00.";
  if (startOk && endOk && parseHhmm(v.businessHoursStart) >= parseHhmm(v.businessHoursEnd)) {
    errors.businessHoursEnd = "The closing time must be later than the opening time.";
  }

  if (new Set(owners.map((o) => o.userId)).size !== owners.length) {
    errors.owners = "Each person can be an owner once.";
  } else if (ownersOutOfRange(v, owners).length > 0) {
    errors.owners = "This resource uses one approval level, so every owner must be at level 1.";
  } else {
    const missing = missingOwnerLevels(v, owners);
    if (missing.length > 0) {
      errors.owners = `Bookings here need approval, so add an owner at level ${missing.join(" and ")}.`;
    }
  }
  return errors;
}

export const hasErrors = (errors: FormErrors): boolean => Object.keys(errors).length > 0;

/** The editable fields, as the API types them. */
function fieldsOf(v: ResourceFormValues) {
  return {
    name: v.name.trim(),
    type: v.type,
    location: v.location.trim(),
    capacity: Number(v.capacity),
    description: v.description.trim(),
    requiresApproval: v.requiresApproval,
    approvalLevels: v.approvalLevels,
    minSlotMinutes: Number(v.minSlotMinutes),
    maxSlotMinutes: Number(v.maxSlotMinutes),
    bookingHorizonDays: Number(v.bookingHorizonDays),
    businessHoursStart: v.businessHoursStart,
    businessHoursEnd: v.businessHoursEnd,
    businessDays: [...v.businessDays].sort((a, b) => a - b),
  };
}
export type ResourceFields = ReturnType<typeof fieldsOf>;

/** POST /api/resources */
export function toCreateBody(v: ResourceFormValues, owners: readonly OwnerDraft[]) {
  return { departmentId: v.departmentId, ...fieldsOf(v), owners: owners.map((o) => ({ ...o })) };
}

/** PATCH /api/resources/:id: only what changed (null when nothing did). */
export function toPatchBody(v: ResourceFormValues, original: Resource): Partial<ResourceFields> | null {
  const next = fieldsOf(v);
  const before = fieldsOf(formFromResource(original));
  const changed = (Object.keys(next) as (keyof ResourceFields)[]).filter(
    (k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]),
  );
  if (changed.length === 0) return null;
  return Object.fromEntries(changed.map((k) => [k, next[k]])) as Partial<ResourceFields>;
}

const ownerKey = (owners: readonly OwnerDraft[]) =>
  JSON.stringify([...owners].sort((a, b) => a.userId.localeCompare(b.userId)).map((o) => [o.userId, o.approvalLevel]));

export function ownersChanged(original: readonly OwnerDraft[], next: readonly OwnerDraft[]): boolean {
  return ownerKey(original) !== ownerKey(next);
}

/** Whether `owners` satisfy `config` the way the server checks them (range, then coverage). */
function ownersFit(config: { requiresApproval: boolean; approvalLevels: number }, owners: readonly OwnerDraft[]): boolean {
  return ownersOutOfRange(config, owners).length === 0 && missingOwnerLevels(config, owners).length === 0;
}

export type SaveOrder = "fields" | "owners" | "fields-then-owners" | "owners-then-fields" | "nothing" | "impossible";

/**
 * Fields and owners are separate requests, and the server checks each
 * against the other's current state. Owners go first when the new owners
 * fit the current settings; otherwise settings go first when the current
 * owners fit the new settings. If neither order works (e.g. dropping from
 * two approval levels to one while level 2 has owners) it can't be saved
 * in two steps without switching approval off in between.
 */
export function saveOrder(
  current: { requiresApproval: boolean; approvalLevels: number },
  currentOwners: readonly OwnerDraft[],
  nextFields: Partial<ResourceFields> | null,
  nextOwners: readonly OwnerDraft[] | null,
): SaveOrder {
  if (!nextFields && !nextOwners) return "nothing";
  if (!nextOwners) return "fields";
  if (!nextFields) return "owners";
  const nextConfig = { ...current, ...nextFields };
  if (ownersFit(current, nextOwners)) return "owners-then-fields";
  if (ownersFit(nextConfig, currentOwners)) return "fields-then-owners";
  return "impossible";
}
