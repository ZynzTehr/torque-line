import { describe, expect, it } from "vitest";
import { csv, csvCell, dateInZone, money, photoName, uniqueNames } from "@/domain/exportFormat";

describe("csvCell: RFC 4180 quoting", () => {
  it("leaves plain values bare and empties nulls", () => {
    expect(csvCell("Oil change")).toBe("Oil change");
    expect(csvCell(482150)).toBe("482150");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("yes");
    expect(csvCell(false)).toBe("no");
  });
  it("quotes commas, quotes and line breaks, doubling inner quotes", () => {
    expect(csvCell("Pilot, Exit 12")).toBe('"Pilot, Exit 12"');
    expect(csvCell('22.5" steer tire')).toBe('"22.5"" steer tire"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });
});

describe("csvCell: a cell never runs as a spreadsheet formula", () => {
  it("prefixes cells that start with = + - @ tab or CR with a quote", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+1 555 0100")).toBe("'+1 555 0100");
    expect(csvCell("-5 psi")).toBe("'-5 psi");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("\rcmd")).toBe('"\'\rcmd"');
  });
  it("leaves the same characters alone when they are not first", () => {
    expect(csvCell("A=B")).toBe("A=B");
  });
});

describe("csv", () => {
  it("writes a BOM, a header row, CRLF line ends and a final CRLF", () => {
    expect(csv(["unit", "notes"], [["101", "a, b"], ["R12", null]])).toBe('﻿unit,notes\r\n101,"a, b"\r\nR12,\r\n');
  });
});

describe("money", () => {
  it("formats numeric columns as fixed decimal strings, null stays null", () => {
    expect(money(150)).toBe("150.00");
    expect(money(12.5)).toBe("12.50");
    expect(money(3.459, 3)).toBe("3.459");
    expect(money(null)).toBeNull();
  });
});

describe("photo names", () => {
  it("reads as date, unit, and what it is, with a safe extension", () => {
    expect(photoName({ date: "2026-10-14", units: ["101"], label: "Oil Change", contentType: "image/jpeg" })).toBe("2026-10-14 101 oil change.jpg");
    expect(photoName({ date: "2026-10-14", units: ["101", "R12"], label: "fuel Pilot #4", contentType: "image/png" })).toBe("2026-10-14 101 R12 fuel pilot #4.png");
  });
  it("strips path separators and characters that file systems reject", () => {
    expect(photoName({ date: "2026-10-14", units: ["../T/1"], label: 'brakes: "rear" <axle>?*|', contentType: "image/webp" }))
      .toBe("2026-10-14 T 1 brakes rear axle.webp");
  });
  it("keeps long labels short", () => {
    const name = photoName({ date: "2026-10-14", units: ["101"], label: "x".repeat(300), contentType: "image/jpeg" });
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith(".jpg")).toBe(true);
  });
  it("numbers duplicates so no file overwrites another", () => {
    expect(uniqueNames(["a.jpg", "a.jpg", "b.jpg", "A.jpg"])).toEqual(["a.jpg", "a (2).jpg", "b.jpg", "A (3).jpg"]);
  });
});

describe("dateInZone", () => {
  it("gives the calendar date in the fleet's time zone", () => {
    expect(dateInZone(new Date("2026-10-15T03:00:00Z"), "America/Chicago")).toBe("2026-10-14");
    expect(dateInZone(new Date("2026-10-15T03:00:00Z"), "Not/AZone")).toBe("2026-10-15");
  });
});
