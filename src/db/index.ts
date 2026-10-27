import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Run `neon env pull` or add it to .env.local.");
  // Pooled WebSocket driver: needed for interactive transactions (reading + projection in one commit).
  return drizzle({ client: new Pool({ connectionString: url }), schema });
}

export type Db = ReturnType<typeof connect>;
let instance: Db | null = null;

/** Connects on first use, so `next build` can evaluate modules before deployment env exists. */
export function getDb(): Db {
  return (instance ??= connect());
}

export { schema };
