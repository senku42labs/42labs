import { Pool } from "@neondatabase/serverless";
declare global { var rimuruPool: Pool | undefined }
export function db() {
  const url = process.env.RIMURU_REGISTRY_DATABASE_URL;
  if (!url) throw new Error("RIMURU_REGISTRY_DATABASE_URL is not configured.");
  if (!global.rimuruPool) global.rimuruPool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
  return global.rimuruPool;
}