import { describe, expect, it } from "vitest";
import type { Resource } from "../resources/use-resources";
import {
  emptyResourceForm,
  formFromResource,
  missingOwnerLevels,
  ownersChanged,
  saveOrder,
  toCreateBody,
  toPatchBody,
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

describe("saveOrder", () => {
  const one = { requiresApproval: true, approvalLevels: 1 };
  const none = { requiresApproval: false, approvalLevels: 1 };
  const two = { requiresApproval: true, approvalLevels: 2 };

  it("sends one request when only one side changed", () => {
    expect(saveOrder(one, [A1], null, null)).toBe("nothing");
    expect(saveOrder(one, [A1], { capacity: 5 }, null)).toBe("fields");
    expect(saveOrder(one, [A1], null, [A1, { userId: "c", approvalLevel: 1 }])).toBe("owners");
  });

  it("adds owners before turning approval on", () => {
    expect(saveOrder(none, [], { requiresApproval: true }, [A1])).toBe("owners-then-fields");
  });

  it("turns approval off before removing the last owners", () => {
    expect(saveOrder(one, [A1], { requiresApproval: false }, [])).toBe("fields-then-owners");
  });

  // The server checks owners against the current levels and levels against
  // the current owners, so changing the level count on a resource that
  // needs approval can't be done in either order.
  it("can't go from one level to two with a new level 2 owner", () => {
    expect(saveOrder(one, [A1], { approvalLevels: 2 }, [A1, B2])).toBe("impossible");
  });

  it("can't drop from two levels to one while level 2 has owners", () => {
    expect(saveOrder(two, [A1, B2], { approvalLevels: 1 }, [A1])).toBe("impossible");
  });

  it("can change levels while approval is off", () => {
    expect(saveOrder(none, [A1], { approvalLevels: 2 }, null)).toBe("fields");
    expect(saveOrder({ requiresApproval: false, approvalLevels: 2 }, [A1, B2], { approvalLevels: 1 }, [A1])).toBe("owners-then-fields");
  });
});
