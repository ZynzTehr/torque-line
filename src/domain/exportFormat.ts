/** Pure helpers for the owner data export: CSV cells, decimal strings, and readable photo file names. */

type Cell = string | number | boolean | null | undefined;

// A spreadsheet treats a cell starting with one of these as a formula (OWASP "CSV injection").
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** One RFC 4180 field. Booleans read as yes/no; text that could run as a formula gets a leading quote. */
export function csvCell(value: Cell): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole CSV file: UTF-8 BOM (so Excel reads accents and symbols), CRLF line ends, final CRLF. */
export function csv(header: readonly string[], rows: readonly Cell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",") + "\r\n").join("");
}

/** Numeric columns as fixed decimal strings ("150.00"), so no reader sees float noise. */
export function money(n: number | null | undefined, places = 2): string | null {
  return n == null ? null : n.toFixed(places);
}

/** The calendar date (YYYY-MM-DD) of an instant in the fleet's time zone; UTC if the zone is unknown. */
export function dateInZone(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX_NAME = 100;

/** Characters no common file system or zip tool accepts in a name, collapsed to single spaces. */
function clean(s: string): string {
  return s.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .split(/\s+/).filter((w) => w && !/^\.+$/.test(w)).join(" ");
}

/** "2026-10-14 101 oil change.jpg": date, unit number(s), then what the photo is, in lower case. */
export function photoName(p: { date: string; units: string[]; label: string; contentType: string }): string {
  const ext = EXTENSION[p.contentType] ?? "bin";
  const base = clean([p.date, ...p.units, p.label.toLowerCase()].join(" ")).slice(0, MAX_NAME - ext.length - 1).trim();
  return `${base}.${ext}`;
}

/** Number repeats ("a (2).jpg"), case-insensitively, since Windows and macOS treat A.jpg and a.jpg as one file. */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    let n = seen.get(key) ?? 0;
    let candidate = name;
    while (taken.has(candidate.toLowerCase())) {
      n += 1;
      const dot = name.lastIndexOf(".");
      candidate = dot > 0 ? `${name.slice(0, dot)} (${n + 1})${name.slice(dot)}` : `${name} (${n + 1})`;
    }
    seen.set(key, n);
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}
