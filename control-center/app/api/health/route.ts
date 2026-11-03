import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  try {
    const pool=db();
    const [servers,commands]=await Promise.all([
      pool.query("SELECT count(*)::int AS count FROM rimuru_servers"),
      pool.query("SELECT count(*)::int AS count FROM rimuru_command_catalog")
    ]);
    return NextResponse.json({status:"ok",database:"connected",servers:servers.rows[0].count,commands:commands.rows[0].count},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({status:"error",database:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}