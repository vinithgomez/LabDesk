import { describe, expect, it } from "vitest";
import { MAX_TABS, navItems, pageTitle, phoneTabs, type NavItem } from "./nav";

const ids = (items: readonly (NavItem | "more")[]) => items.map((i) => (i === "more" ? "more" : i.id));

describe("navItems: the same role gating as before", () => {
  it("gives students the Book group only", () => {
    expect(ids(navItems("student"))).toEqual(["resources", "bookings", "scan"]);
  });

  it("adds Approvals and Analytics for faculty and lab in-charges, not Admin", () => {
    expect(ids(navItems("faculty"))).toEqual(["resources", "bookings", "scan", "approvals", "analytics"]);
    expect(ids(navItems("lab_incharge"))).toEqual(["resources", "bookings", "scan", "approvals", "analytics"]);
  });

  it("gives admins everything", () => {
    expect(ids(navItems("admin"))).toEqual(["resources", "bookings", "scan", "approvals", "analytics", "admin"]);
  });

  it("shows only the Book group while the role is still loading", () => {
    expect(ids(navItems(undefined))).toEqual(["resources", "bookings", "scan"]);
  });
});

describe("phoneTabs", () => {
  it("puts Scan in the centre", () => {
    expect(ids(phoneTabs(navItems("student")).tabs)).toEqual(["resources", "scan", "bookings"]);
    expect(ids(phoneTabs(navItems("faculty")).tabs)).toEqual(["resources", "bookings", "scan", "approvals", "analytics"]);
  });

  it("never shows more than five, moving the rest into More", () => {
    const admin = phoneTabs(navItems("admin"));
    expect(admin.tabs).toHaveLength(MAX_TABS);
    expect(ids(admin.tabs)).toEqual(["resources", "bookings", "scan", "approvals", "more"]);
    expect(ids(admin.more)).toEqual(["analytics", "admin"]);
    for (const role of ["student", "faculty", "lab_incharge"] as const) {
      expect(phoneTabs(navItems(role)).tabs.length).toBeLessThanOrEqual(MAX_TABS);
      expect(phoneTabs(navItems(role)).more).toEqual([]);
    }
  });
});

describe("pageTitle", () => {
  it("names each area, including nested routes", () => {
    expect(pageTitle("/resources/abc")).toBe("Resources");
    expect(pageTitle("/series/s1")).toBe("My bookings");
    expect(pageTitle("/admin/users")).toBe("Admin");
    expect(pageTitle("/checkin")).toBe("Check in");
  });
});
