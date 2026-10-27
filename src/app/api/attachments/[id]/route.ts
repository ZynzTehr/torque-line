import { getDb } from "@/db";
import { readAttachment } from "@/server/attachmentsStore";
import { fleetForRequest } from "@/server/fleet";
import { neonObjectStore } from "@/server/objectStore";

/**
 * Streams a private attachment to its own fleet only. Authorization is checked on every request;
 * there are no reusable public links. Unknown and foreign ids both return 404.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/attachments/[id]">) {
  const fleet = await fleetForRequest();
  if (!fleet) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const file = await readAttachment(getDb(), await neonObjectStore(), fleet.fleetId, id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
