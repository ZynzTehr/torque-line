import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import type { AppDb } from "./fleetStore";
import type { ObjectStore } from "./objectStore";
import { invalid, notFound, type Actor, type Failure } from "./result";

export type AttachmentKind = (typeof schema.attachmentKind.enumValues)[number];
export type AttachmentRow = typeof schema.attachments.$inferSelect;

export const MAX_ATTACHMENT_BYTES = 3_000_000;
const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const isUuid = (id: string) => z.uuid().safeParse(id).success;

const PARENT = {
  diagnostic_photo: schema.diagnosticSessions,
  service_receipt: schema.serviceRecords,
  fuel_receipt: schema.fuelStops,
} as const;

async function parentBelongsToFleet(db: AppDb, kind: AttachmentKind, parentId: string, fleetId: string) {
  if (!isUuid(parentId)) return false;
  const table = PARENT[kind];
  const rows = await db.select({ id: table.id }).from(table).where(and(eq(table.fleetId, fleetId), eq(table.id, parentId)));
  return rows.length === 1;
}

/**
 * Upload a file for a record this fleet owns. The object goes in first, then the row; if the row
 * can't be written the object is removed, so storage never holds files the database doesn't know about.
 */
export async function saveAttachment(db: AppDb, store: ObjectStore, actor: Actor, input: {
  kind: AttachmentKind; parentId: string; bytes: Uint8Array; contentType: string;
}): Promise<{ ok: true; attachment: AttachmentRow } | Failure> {
  const ext = EXTENSION[input.contentType];
  if (!ext) return invalid("Only JPEG, PNG, WebP, and GIF images can be attached.");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_ATTACHMENT_BYTES) return invalid("That file is empty or too large.");
  if (!(await parentBelongsToFleet(db, input.kind, input.parentId, actor.fleetId))) return notFound("That record");

  const storageKey = `fleets/${actor.fleetId}/${input.kind}/${input.parentId}/${crypto.randomUUID()}.${ext}`;
  await store.put(storageKey, input.bytes, input.contentType);
  try {
    const [attachment] = await db.insert(schema.attachments).values({
      fleetId: actor.fleetId, kind: input.kind, parentId: input.parentId, storageKey,
      contentType: input.contentType, byteSize: input.bytes.byteLength, createdBy: actor.userId,
    }).returning();
    return { ok: true, attachment };
  } catch (error) {
    await store.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function listAttachments(db: AppDb, fleetId: string, kind: AttachmentKind, parentId: string) {
  if (!isUuid(parentId)) return [];
  return db.select({ id: schema.attachments.id, contentType: schema.attachments.contentType, createdAt: schema.attachments.createdAt })
    .from(schema.attachments)
    .where(and(eq(schema.attachments.fleetId, fleetId), eq(schema.attachments.kind, kind), eq(schema.attachments.parentId, parentId)))
    .orderBy(asc(schema.attachments.createdAt));
}

/** The file's bytes, or null when it is unknown or belongs to another fleet (indistinguishable by design). */
export async function readAttachment(db: AppDb, store: ObjectStore, fleetId: string, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(schema.attachments)
    .where(and(eq(schema.attachments.fleetId, fleetId), eq(schema.attachments.id, id)));
  if (!row) return null;
  const object = await store.get(row.storageKey);
  return object ? { bytes: object.bytes, contentType: row.contentType } : null;
}

/** The newest attachment of `kind` for each parent, as parentId → attachment id. */
export async function latestAttachmentIds(db: AppDb, fleetId: string, kind: AttachmentKind, parentIds: string[]) {
  const ids = parentIds.filter(isUuid);
  const latest = new Map<string, string>();
  if (!ids.length) return latest;
  const rows = await db.select({ id: schema.attachments.id, parentId: schema.attachments.parentId }).from(schema.attachments)
    .where(and(eq(schema.attachments.fleetId, fleetId), eq(schema.attachments.kind, kind), inArray(schema.attachments.parentId, ids)))
    .orderBy(desc(schema.attachments.createdAt));
  for (const r of rows) if (!latest.has(r.parentId)) latest.set(r.parentId, r.id);
  return latest;
}

/**
 * Remove attachments: one by id, or every file of `kind` on one record. Rows go first, then objects;
 * a leftover object is harmless, a row whose object is gone is not.
 */
export async function deleteAttachments(db: AppDb, store: ObjectStore, fleetId: string,
  target: { id: string } | { kind: AttachmentKind; parentId: string }): Promise<number> {
  const where = "id" in target
    ? (isUuid(target.id) ? and(eq(schema.attachments.fleetId, fleetId), eq(schema.attachments.id, target.id)) : null)
    : (isUuid(target.parentId) ? and(eq(schema.attachments.fleetId, fleetId), eq(schema.attachments.kind, target.kind), eq(schema.attachments.parentId, target.parentId)) : null);
  if (!where) return 0;
  const removed = await db.delete(schema.attachments).where(where).returning({ storageKey: schema.attachments.storageKey });
  for (const r of removed) await store.delete(r.storageKey).catch(() => undefined);
  return removed.length;
}
