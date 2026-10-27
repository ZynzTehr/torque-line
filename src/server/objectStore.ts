import "server-only";

/** The slice of object storage the app uses; the Neon bucket in production, memory in tests. */
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
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
  const [{ Files }, { neon }] = await Promise.all([import("files-sdk"), import("files-sdk/neon")]);
  const files = new Files({ adapter: neon({ bucket: ATTACHMENTS_BUCKET }) });
  neonStore = {
    async put(key, bytes, contentType) { await files.upload(key, bytes, { contentType }); },
    async get(key) {
      if (!(await files.exists(key))) return null;
      const file = await files.download(key);
      return { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.contentType };
    },
    async delete(key) { await files.delete(key); },
  };
  return neonStore;
}

export function memoryObjectStore(): ObjectStore & { keys(): string[] } {
  const map = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    async put(key, bytes, contentType) { map.set(key, { bytes, contentType }); },
    async get(key) { return map.get(key) ?? null; },
    async delete(key) { map.delete(key); },
    keys: () => [...map.keys()],
  };
}
