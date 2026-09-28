import { describe, expect, it } from "vitest";
import { loginPath, safeNext } from "./redirect";

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/resources")).toBe("/resources");
    expect(safeNext("/checkin?r=1&sig=2")).toBe("/checkin?r=1&sig=2");
  });

  it("refuses anything that could leave the site", () => {
    // "/\\evil.example" is the string /\evil.example, which browsers treat like //evil.example.
    for (const value of ["//evil.example", "/\\evil.example", "https://evil.example", "evil", "", null]) {
      expect(safeNext(value)).toBe(safeNext(null));
    }
  });

  it("round-trips through loginPath", () => {
    const path = loginPath("/resources/abc?week=2026-10-05");
    expect(safeNext(new URL(path, "https://labdesk.test").searchParams.get("next"))).toBe("/resources/abc?week=2026-10-05");
  });
});
