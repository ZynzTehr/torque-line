import { describe, expect, it } from "vitest";
import { isValidId } from "@/domain/types";

describe("isValidId", () => {
  it("accepts canonical UUIDs and positive safe integers", () => {
    expect(isValidId("3f2b8c1e-9d4a-4b7e-8f21-0c5d6e7a8b9c")).toBe(true);
    expect(isValidId(42)).toBe(true);
  });
  it("rejects markup, blanks, zero, negatives, floats and oversized integers", () => {
    for (const bad of ['" onclick=bad', "", " ", "not-a-uuid", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, undefined, {}]) {
      expect(isValidId(bad)).toBe(false);
    }
  });
});
