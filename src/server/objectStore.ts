import "server-only";

/** The slice of object storage the app uses; the Neon bucket in production, memory in tests. */
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** `signal` aborts the request, including its retries. */
  get(key: string, options?: { signal?: AbortSignal }): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** Removes every object whose key starts with `prefix`, carrying on past a failed one. */
  deletePrefix(prefix: string): Promise<{ deleted: number; failed: number }>;
}

/** Deletes each listed key in turn; a failure is counted, not thrown, so one bad object can't strand the rest. */
async function deleteEach(keys: string[], remove: (key: string) => Promise<void>) {
  let deleted = 0, failed = 0;
  for (const key of keys) {
    try { await remove(key); deleted++; } catch { failed++; }
  }
  return { deleted, failed };
}

export const ATTACHMENTS_BUCKET = "attachments";
let neonStore: ObjectStore | null = null;

/**
 * Neon Object Storage through the Files SDK's neon adapter. Credentials, endpoint, and region come from
 * the AWS_* variables `neon env pull` writes; they are branch-scoped. Created on first use.
 */
export async function neonObjectStore(): Promise<ObjectStore> {
  if (neonStore) return neonStore;
  if (!process.env.AWS_ENDPOINT_URL_S3) throw new Error("Object storage is not configured. Declare the bucket in neon.ts and run `neon deploy`.");
  const [{ Files, FilesError }, { neon }] = await Promise.all([import("files-sdk"), import("files-sdk/neon")]);
  const files = new Files({ adapter: neon({ bucket: ATTACHMENTS_BUCKET }) });
  neonStore = {
    async put(key, bytes, contentType) { await files.upload(key, bytes, { contentType }); },
    async get(key, options) {
      // One round trip: a missing object comes back as NotFound. Transient provider errors are retried.
      try {
        const file = await files.download(key, { retries: 2, signal: options?.signal });
        return { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.contentType };
      } catch (error) {
        if (error instanceof FilesError && error.code === "NotFound") return null;
        throw error;
      }
    },
    async delete(key) { await files.delete(key); },
    async deletePrefix(prefix) {
      // List everything first, so deleting never shifts the listing's pages under it.
      const keys: string[] = [];
      for await (const file of files.listAll({ prefix })) keys.push(file.key);
      return deleteEach(keys, (key) => files.delete(key));
    },
  };
  return neonStore;
}

export function memoryObjectStore(): ObjectStore & { keys(): string[] } {
  const map = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    async put(key, bytes, contentType) { map.set(key, { bytes, contentType }); },
    async get(key) { return map.get(key) ?? null; },
    async delete(key) { map.delete(key); },
    async deletePrefix(prefix) { return deleteEach([...map.keys()].filter((k) => k.startsWith(prefix)), async (k) => { map.delete(k); }); },
    keys: () => [...map.keys()],
  };
}
