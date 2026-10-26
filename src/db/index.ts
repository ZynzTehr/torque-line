import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Run `neon env pull` or add it to .env.local.");

/** Pooled WebSocket driver: needed for interactive transactions (reading + projection in one commit). */
export const db = drizzle({ client: new Pool({ connectionString: url }), schema });
export type Db = typeof db;
export { schema };
