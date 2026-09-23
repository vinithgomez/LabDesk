import { describe, expect, it } from "vitest";

describe("toolchain sanity", () => {
  it("runs the test suite at all", () => {
    expect(1 + 1).toBe(2);
  });

  it("has strict TypeScript available", () => {
    const value: string = "labdesk";
    expect(value.length).toBeGreaterThan(0);
  });
});
