import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { makeSession, verifyPassword, verifySessionToken } from "@/lib/auth";
export const runtime = "nodejs";
export async function GET() {
  try {
    const pool=db();
    const [servers,commands]=await Promise.all([
      pool.query("SELECT count(*)::int AS count FROM rimuru_servers"),
      pool.query("SELECT count(*)::int AS count FROM rimuru_command_catalog")
    ]);
    const authConfigured=Boolean(process.env.RIMURU_ADMIN_PASSWORD)&&Boolean(process.env.RIMURU_SESSION_SECRET)&&verifyPassword(process.env.RIMURU_ADMIN_PASSWORD||"")&&verifySessionToken(makeSession());
    return NextResponse.json({status:"ok",database:"connected",auth:authConfigured?"configured":"misconfigured",servers:servers.rows[0].count,commands:commands.rows[0].count},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({status:"error",database:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}