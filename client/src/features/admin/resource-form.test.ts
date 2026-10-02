import { describe, expect, it } from "vitest";
import type { Resource } from "../resources/use-resources";
import {
  emptyResourceForm,
  formFromResource,
  missingOwnerLevels,
  ownersChanged,
  toCreateBody,
  toPatchBody,
  toUpdateBody,
  validateResourceForm,
  type OwnerDraft,
  type ResourceFormValues,
} from "./resource-form";

const valid = (over: Partial<ResourceFormValues> = {}): ResourceFormValues => ({
  ...emptyResourceForm("d1"),
  name: "Systems Lab",
  location: "Block A",
  capacity: "40",
  ...over,
});
const A1: OwnerDraft = { userId: "a", approvalLevel: 1 };
const B2: OwnerDraft = { userId: "b", approvalLevel: 2 };

const resource: Resource = {
  id: "r1",
  departmentId: "d1",
  name: "Systems Lab",
  type: "lab",
  location: "Block A",
  capacity: 40,
  description: "",
  requiresApproval: true,
  approvalLevels: 2,
  minSlotMinutes: 30,
  maxSlotMinutes: 180,
  bookingHorizonDays: 14,
  businessHoursStart: "08:00",
  businessHoursEnd: "18:00",
  businessDays: [1, 2, 3, 4, 5],
  isActive: true,
  ownerIds: ["a", "b"],
  owners: [A1, B2],
};

describe("validateResourceForm", () => {
  it("accepts a complete form", () => {
    expect(validateResourceForm(valid(), [])).toEqual({});
  });

  it("requires a department, name and location", () => {
    const errors = validateResourceForm(valid({ departmentId: "", name: "  ", location: "" }), []);
    expect(Object.keys(errors).sort()).toEqual(["departmentId", "location", "name"]);
  });

  it.each([
    ["capacity", "-1"],
    ["capacity", "10001"],
    ["capacity", "4.5"],
    ["capacity", "forty"],
    ["minSlotMinutes", "0"],
    ["maxSlotMinutes", "1441"],
    ["bookingHorizonDays", "0"],
    ["bookingHorizonDays", "366"],
  ] as const)("rejects %s = %s", (field, value) => {
    expect(validateResourceForm(valid({ [field]: value }), [])[field]).toBeDefined();
  });

  it("accepts the edges of each range", () => {
    expect(validateResourceForm(valid({ capacity: "0", minSlotMinutes: "1", maxSlotMinutes: "1440", bookingHorizonDays: "365" }), [])).toEqual({});
  });

  it("refuses a shortest booking longer than the longest", () => {
    expect(validateResourceForm(valid({ minSlotMinutes: "120", maxSlotMinutes: "60" }), []).minSlotMinutes).toBe(
      "The shortest booking can't be longer than the longest.",
    );
  });

  it("refuses business hours that close at or before they open", () => {
    expect(validateResourceForm(valid({ businessHoursStart: "18:00", businessHoursEnd: "08:00" }), []).businessHoursEnd).toBe(
      "The closing time must be later than the opening time.",
    );
    expect(validateResourceForm(valid({ businessHoursStart: "09:00", businessHoursEnd: "09:00" }), []).businessHoursEnd).toBeDefined();
    expect(validateResourceForm(valid({ businessHoursStart: "9am" }), []).businessHoursStart).toBeDefined();
    expect(validateResourceForm(valid({ businessHoursStart: "00:00", businessHoursEnd: "23:59" }), [])).toEqual({});
  });

  it("requires an owner at every approval level in use", () => {
    expect(validateResourceForm(valid({ requiresApproval: true }), []).owners).toBe(
      "Bookings here need approval, so add an owner at level 1.",
    );
    expect(validateResourceForm(valid({ requiresApproval: true, approvalLevels: 2 }), [A1]).owners).toBe(
      "Bookings here need approval, so add an owner at level 2.",
    );
    expect(validateResourceForm(valid({ requiresApproval: true, approvalLevels: 2 }), []).owners).toBe(
      "Bookings here need approval, so add an owner at level 1 and 2.",
    );
    expect(validateResourceForm(valid({ requiresApproval: true, approvalLevels: 2 }), [A1, B2])).toEqual({});
    // Without approval, owners are optional.
    expect(validateResourceForm(valid({ requiresApproval: false, approvalLevels: 2 }), [])).toEqual({});
  });

  it("refuses owners at a level the resource doesn't use, and duplicates", () => {
    expect(validateResourceForm(valid({ approvalLevels: 1 }), [B2]).owners).toBe(
      "This resource uses one approval level, so every owner must be at level 1.",
    );
    expect(validateResourceForm(valid(), [A1, { userId: "a", approvalLevel: 2 }]).owners).toBe("Each person can be an owner once.");
  });

  it("lists missing levels only when approval is required", () => {
    expect(missingOwnerLevels({ requiresApproval: false, approvalLevels: 2 }, [])).toEqual([]);
    expect(missingOwnerLevels({ requiresApproval: true, approvalLevels: 2 }, [B2])).toEqual([1]);
  });
});

describe("request bodies", () => {
  it("creates with trimmed text, numbers and sorted days", () => {
    const body = toCreateBody(valid({ name: " Systems Lab ", businessDays: [5, 1, 3] }), [A1]);
    expect(body).toMatchObject({ departmentId: "d1", name: "Systems Lab", capacity: 40, minSlotMinutes: 30, businessDays: [1, 3, 5], owners: [A1] });
  });

  it("patches only what changed, and nothing when nothing did", () => {
    const form = formFromResource(resource);
    expect(toPatchBody(form, resource)).toBeNull();
    expect(toPatchBody({ ...form, capacity: "45", businessDays: [5, 4, 3, 2, 1] }, resource)).toEqual({ capacity: 45 });
    expect(toPatchBody({ ...form, requiresApproval: false }, resource)).toEqual({ requiresApproval: false });
  });

  it("notices owner changes regardless of order", () => {
    expect(ownersChanged([A1, B2], [B2, A1])).toBe(false);
    expect(ownersChanged([A1, B2], [A1, { userId: "b", approvalLevel: 1 }])).toBe(true);
    expect(ownersChanged([A1], [])).toBe(true);
  });
});

describe("toUpdateBody", () => {
  const form = formFromResource(resource); // two levels, owners a@1 and b@2

  it("is null when nothing changed, owners included (in any order)", () => {
    expect(toUpdateBody(form, resource, [A1, B2])).toBeNull();
    expect(toUpdateBody(form, resource, [B2, A1])).toBeNull();
  });

  it("sends only changed settings when the owners are unchanged", () => {
    expect(toUpdateBody({ ...form, capacity: "12" }, resource, [A1, B2])).toEqual({ capacity: 12 });
  });

  it("sends only the owners when only they changed", () => {
    expect(toUpdateBody(form, resource, [A1, { userId: "c", approvalLevel: 2 }])).toEqual({
      owners: [A1, { userId: "c", approvalLevel: 2 }],
    });
  });

  it("sends a change of approval levels and the owners for it together, in one body", () => {
    // Two levels down to one: dropping the level-2 owner in the same request.
    expect(toUpdateBody({ ...form, approvalLevels: 1 }, resource, [A1])).toEqual({ approvalLevels: 1, owners: [A1] });
    // One level up to two, with the new level-2 owner.
    const oneLevel = { ...resource, approvalLevels: 1, owners: [A1] };
    expect(toUpdateBody({ ...formFromResource(oneLevel), approvalLevels: 2 }, oneLevel, [A1, B2])).toEqual({
      approvalLevels: 2,
      owners: [A1, B2],
    });
  });

  it("never switches approval off on its own", () => {
    const oneLevel = { ...resource, approvalLevels: 1, owners: [A1] };
    const body = toUpdateBody({ ...formFromResource(oneLevel), approvalLevels: 2 }, oneLevel, [A1, B2]);
    expect(body).not.toHaveProperty("requiresApproval");
  });
});
