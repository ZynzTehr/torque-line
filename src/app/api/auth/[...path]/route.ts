import { getAuth } from "@/lib/auth/server";

type Handler = (request: Request, context: { params: Promise<{ path: string[] }> }) => Promise<Response>;
const method = (name: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"): Handler =>
  (request, context) => (getAuth().handler()[name] as Handler)(request, context);

export const GET = method("GET");
export const POST = method("POST");
export const PUT = method("PUT");
export const DELETE = method("DELETE");
export const PATCH = method("PATCH");
