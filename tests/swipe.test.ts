import { describe, expect, it } from "vitest";
import { classifySwipe, sectionIndex } from "@/components/shell/sections";

describe("classifySwipe", () => {
  it("treats a quick, mostly horizontal flick as a section change", () => {
    expect(classifySwipe({ dx: -120, dy: 10, ms: 220 })).toBe(-1);
    expect(classifySwipe({ dx: 140, dy: -30, ms: 300 })).toBe(1);
  });
  it("ignores short drags, vertical scrolling, diagonal drags, and slow drags", () => {
    expect(classifySwipe({ dx: -40, dy: 0, ms: 100 })).toBe(0);
    expect(classifySwipe({ dx: 20, dy: 300, ms: 200 })).toBe(0);
    expect(classifySwipe({ dx: -120, dy: 90, ms: 200 })).toBe(0);
    expect(classifySwipe({ dx: -200, dy: 0, ms: 1200 })).toBe(0);
  });
});

describe("sectionIndex", () => {
  it("matches a section and its detail pages", () => {
    expect(sectionIndex("/dashboard")).toBe(0);
    expect(sectionIndex("/equipment/3f2b8c1e-9d4a-4b7e-8f21-0c5d6e7a8b9c")).toBe(1);
    expect(sectionIndex("/settings")).toBe(-1);
    expect(sectionIndex("/equipmentx")).toBe(-1);
  });
});
