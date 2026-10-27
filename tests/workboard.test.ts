import { describe, expect, it } from "vitest";
import { buildWorkboard, type BoardEquipment, type BoardSchedule } from "@/domain/workboard";

const now = new Date("2026-10-26T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const truck = (id: string, over: Partial<BoardEquipment> = {}): BoardEquipment =>
  ({ id, unitNumber: id, type: "tractor", currentMileage: 482150, currentHours: null, readingUpdatedAt: daysAgo(1), ...over });
const item = (id: string, equipmentId: string, over: Partial<BoardSchedule> = {}): BoardSchedule =>
  ({ id, equipmentId, name: id, category: "PM-A", enabled: true, mileageInterval: 15000, timeIntervalDays: null, lastServiceMileage: 470000, lastServiceDate: "2026-09-01", ...over });

describe("buildWorkboard", () => {
  it("lists overdue items before due-soon items, then missing history", () => {
    const board = buildWorkboard(
      [truck("101")],
      [
        item("soon", "101", { lastServiceMileage: 468000 }),       // 14,150 used of 15,000: due soon
        item("late", "101", { lastServiceMileage: 460000 }),       // overdue
        item("unknown", "101", { lastServiceMileage: null }),      // baseline missing
        item("fine", "101", { lastServiceMileage: 480000 }),
      ],
      now,
    );
    expect(board.attention.map((a) => [a.schedule.id, a.status])).toEqual([["late", "overdue"], ["soon", "due-soon"], ["unknown", "unknown"]]);
    expect(board.counts).toMatchObject({ units: 1, overdue: 1, dueSoon: 1 });
  });

  it("flags units without an enabled schedule and stale meters, but never trailers as stale", () => {
    const board = buildWorkboard(
      [truck("101", { readingUpdatedAt: daysAgo(20) }), truck("T-1", { type: "trailer", currentMileage: null, readingUpdatedAt: null })],
      [item("paused", "101", { enabled: false })],
      now,
    );
    expect(board.noSchedule.map((e) => e.id)).toEqual(["101", "T-1"]);
    expect(board.stale.map((e) => e.id)).toEqual(["101"]);
  });

  it("gives every unit a register status badge", () => {
    const board = buildWorkboard([truck("101"), truck("102")], [item("late", "101", { lastServiceMileage: 400000 })], now);
    expect(board.register.map((r) => [r.equipment.id, r.status.label])).toEqual([["101", "Overdue"], ["102", "No schedule set"]]);
  });

  it("uses calendar time for reefers", () => {
    const reefer = truck("R-1", { type: "reefer", currentMileage: null, currentHours: 8420 });
    const board = buildWorkboard([reefer], [item("pm", "R-1", { mileageInterval: null, timeIntervalDays: 90, lastServiceDate: "2026-07-01" })], now);
    expect(board.attention).toEqual([expect.objectContaining({ status: "overdue" })]);
  });
});
